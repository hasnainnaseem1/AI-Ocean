/**
 * Stripe Webhook Handler
 *
 * Processes Stripe webhook events for the credit-wallet payment lifecycle:
 * - checkout.session.completed → credit the wallet for a top-up
 * - charge.dispute.created → hold the account
 * - charge.refunded → reverse the wallet credit (or accrue debt for the shortfall)
 *
 * IMPORTANT: This route must use express.raw() body parser, NOT express.json().
 * It is mounted separately in app.js before JSON middleware.
 */
const express = require('express');
const router = express.Router();
const userService = require('../../../services/user/userService');
const teamService = require('../../../services/team/teamService');
const topUpService = require('../../../services/billing/topUpService');
const paymentService = require('../../../services/billing/paymentService');
const stripeService = require('../../../services/stripe/stripeService');

// @route   POST /api/v1/webhooks/stripe
// @desc    Handle Stripe webhook events
// @access  Public (verified via Stripe signature)
router.post('/', async (req, res) => {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = await stripeService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object);
        break;

      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`[Stripe] Error handling ${event.type}:`, err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

/**
 * Handle checkout.session.completed — every checkout on this platform is a
 * credit top-up (metadata.type === 'credit_topup', set by
 * stripeService.createTopUpSession).
 */
async function handleCheckoutComplete(session) {
  const { type } = session.metadata || {};

  if (type === 'credit_topup') {
    await handleCreditTopUp(session);
    return;
  }

  console.error('[Stripe] checkout.session.completed with unrecognized metadata.type:', type);
}

/**
 * Credit top-up completed — add the credit, record the payment, and resume any
 * deployments that were auto-paused for running out of balance.
 *
 * Exported so billingController.verifyCheckoutSession can reuse it as the
 * local-dev fallback when webhooks can't reach localhost.
 */
async function handleCreditTopUp(session) {
  const { teamId, userId, credits, currency } = session.metadata || {};
  const amount = Number(credits) || (session.amount_total || 0) / 100;

  if ((!teamId && !userId) || amount <= 0) {
    console.error('[Stripe] credit_topup missing account or amount');
    return null;
  }

  // Idempotency — a webhook retry (or the verify-session fallback firing after
  // the webhook already landed) must not double-credit the wallet.
  const paymentIntentId = session.payment_intent || session.id;
  const existing = await paymentService.findByStripePaymentIntentId(paymentIntentId);
  if (existing) {
    console.log(`[Stripe] Top-up ${paymentIntentId} already processed, skipping`);
    return existing;
  }

  return topUpService.recordPaidTopUp({
    metadata: { teamId, userId },
    amount,
    currency: currency || session.currency,
    source: 'stripe',
    ledgerDescription: 'Top-up via Stripe',
    payment: {
      stripePaymentIntentId: paymentIntentId,
      status: 'succeeded',
      description: 'Account credit top-up',
      paidAt: new Date(),
    },
  });
}

/**
 * Handle charge.dispute.created — a chargeback.
 *
 * This is a fraud/trust signal, not an ordinary funding shortfall, so it is
 * acted on immediately rather than waiting for the next debt-collection run:
 * the account is held (fundingService.evaluateFunding refuses everything for
 * it the moment `billingFlags.disputeHold` is set — see its class comment)
 * and whatever of theirs is currently running is paused right now, not left
 * running until someone happens to notice.
 *
 * The hold is lifted only by an admin — a dispute resolved in the customer's
 * favour still deserves a human decision about whether to trust the account
 * again, not an automatic reversal.
 */
async function handleDisputeCreated(dispute) {
  await stripeService.initialize();

  let charge;
  try {
    charge = await stripeService.stripe.charges.retrieve(dispute.charge);
  } catch (err) {
    console.error('[Stripe] Could not retrieve disputed charge:', err.message);
    return;
  }

  // The account whose card was charged — the hold is on the account, since
  // the card, its payments and its deployments all belong to it.
  const team = await teamService.findByStripeCustomerId(charge.customer);
  if (!team) {
    console.error('[Stripe] Dispute on a charge with no matching account:', dispute.charge);
    return;
  }
  const user = await userService.findById(team.createdById);

  const amount = (dispute.amount || 0) / 100;
  const reason = dispute.reason || 'unknown';

  await teamService.update(team, {
    disputeHold: true,
    disputeReason: reason,
    disputedAt: new Date(),
  });

  const deploymentService = require('../../../services/deployment/deploymentService');

  // Deployment's real source of truth is Postgres now (see the migration
  // plan) — this must go through deploymentService rather than querying the
  // model directly, whose write would only ever reach the
  // mirror and leave Postgres (and therefore billing) still showing 'running'.
  const { deployments: running } = await deploymentService.listForTeam(team.id, { status: 'running', limit: 1000 });
  for (const deployment of running) {
    try {
      await deploymentService.transition(deployment, 'paused', {
        note: `Automatically paused — a payment dispute (${reason}) was filed on this account`,
        enforcement: true,
        at: new Date(),
      });
    } catch (err) {
      console.error(`[Stripe] Could not pause ${deployment.id} for dispute hold:`, err.message);
    }
  }

  const { notifyDisputeHold } = require('../../../services/notification/adminNotifier');
  await notifyDisputeHold({ customer: user, amount: `${(charge.currency || 'usd').toUpperCase()} ${amount.toFixed(2)}`, reason }).catch(() => {});

  console.log(`[Stripe] Dispute created: account ${team.id} (${user?.email}), ${amount} (${reason}) — held, ${running.length} deployment(s) paused`);
}

/**
 * Handle charge.refunded.
 *
 * A refund on a past top-up has to come out of the wallet the same top-up
 * added to — but if the customer already spent some of it, the wallet
 * cannot give back money it no longer holds. Whatever the wallet can cover
 * is deducted; whatever it can't becomes debt, the same as any other
 * shortfall this platform tracks (see debtService) — never silently
 * absorbed or ignored.
 */
async function handleChargeRefunded(charge) {
  const refundedAmount = (charge.amount_refunded || 0) / 100;
  if (refundedAmount <= 0) return;

  const team = await teamService.findByStripeCustomerId(charge.customer);
  if (!team) return;

  const prisma = require('../../../lib/prismaClient');
  const alreadyProcessed = await prisma.creditTransaction.findFirst({
    where: {
      teamId: team.id,
      metadata: { path: ['refundedChargeId'], equals: charge.id },
    },
  });
  if (alreadyProcessed) {
    console.log(`[Stripe] Refund for charge ${charge.id} already processed, skipping`);
    return;
  }

  const creditService = require('../../../services/billing/creditService');
  const debtService = require('../../../services/billing/debtService');
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  const wallet = await creditService.getOrCreateWallet(team.id);
  const fromWallet = round2(Math.min(wallet.balance, refundedAmount));
  const shortfall = round2(refundedAmount - fromWallet);

  if (fromWallet > 0) {
    await creditService.adjust(team.id, -fromWallet, {
      type: 'refund',
      referenceModel: 'Payment',
      description: `Refund of a prior top-up (${(charge.currency || 'usd').toUpperCase()} ${refundedAmount.toFixed(2)})`,
      metadata: { refundedChargeId: charge.id },
    });
  }

  if (shortfall > 0) {
    await debtService.accrue(team.id, shortfall, {
      description: `A refunded top-up exceeded the current balance by ${shortfall.toFixed(2)} — `
        + 'the difference is now outstanding',
      metadata: { refundedChargeId: charge.id },
    });
  }

  console.log(
    `[Stripe] Charge refunded: account ${team.id}, ${refundedAmount} `
    + `(${fromWallet} from balance${shortfall > 0 ? `, ${shortfall} became outstanding` : ''})`
  );
}

module.exports = router;
// Reused by billingController.verifyCheckoutSession as the local-dev fallback
module.exports.handleCreditTopUp = handleCreditTopUp;
// Exported purely for testing
module.exports.handleDisputeCreated = handleDisputeCreated;
module.exports.handleChargeRefunded = handleChargeRefunded;
