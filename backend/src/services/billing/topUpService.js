/**
 * Top-up Service
 *
 * What happens once a gateway confirms a top-up was paid — the same for
 * Stripe, Polar and LemonSqueezy. It used to be written out three times, once
 * in each webhook handler; the three copies had to be kept in step by hand,
 * and moving money onto accounts (Teams) would have meant changing all three.
 *
 * Idempotency (a retried webhook must not credit twice) stays with each
 * gateway's handler, because each identifies an already-processed payment by
 * its own reference.
 */
const paymentService = require('./paymentService');
const teamService = require('../team/teamService');
const userService = require('../user/userService');
const emailService = require('../email/emailService');

/**
 * @param {object} args
 * @param {{teamId?: string, userId?: string}} args.metadata  the checkout's own
 *   server-written metadata — decides which account is credited
 * @param {number} args.amount
 * @param {string} args.currency
 * @param {'stripe'|'polar'|'lemonsqueezy'} args.source
 * @param {object} args.payment  gateway-specific Payment fields (reference ids,
 *   status, receiptUrl, metadata, paidAt, description)
 * @param {string} args.ledgerDescription
 * @returns {Promise<object|null>} the Payment, or null if it could not be placed
 */
const recordPaidTopUp = async ({
  metadata, amount, currency, source, payment, ledgerDescription,
}) => {
  const team = await teamService.resolveTopUpAccount(metadata || {});
  if (!team) {
    console.error(`[TopUp] ${source}: no account for teamId=${metadata?.teamId} userId=${metadata?.userId}`);
    return null;
  }
  const payer = metadata?.userId ? await userService.findById(metadata.userId) : null;

  const record = await paymentService.create({
    teamId: team.id,
    userId: payer?.id || team.createdById,
    type: 'topup',
    creditsAdded: amount,
    amount,
    currency: (currency || 'usd').toLowerCase(),
    ...payment,
  });

  const creditService = require('./creditService');
  const deploymentService = require('../deployment/deploymentService');

  const { wallet } = await creditService.topUp(team.id, amount, {
    source,
    referenceId: record.id,
    referenceModel: 'Payment',
    description: ledgerDescription,
    actorUserId: payer?.id || null,
  });

  if (payer) {
    emailService.sendCreditTopUpEmail(payer, {
      amount, balance: wallet.balance, currency: wallet.currency,
    }).catch(() => {});
  }

  // Getting paid should immediately bring back anything paused for
  // non-payment, and re-check anything paused for crossing the debt limit —
  // that one only resumes if this payment brought the account back under it.
  await deploymentService.resumeCreditSuspended(team.id);
  await deploymentService.resumeDebtLimitSuspended(team.id);

  console.log(`[TopUp] ${source}: account ${team.id} +${amount} → balance ${wallet.balance}`);
  return record;
};

module.exports = { recordPaidTopUp };
