/**
 * Polar Webhook Controller
 *
 * All business logic for processing Polar webhook events. The route file
 * handles only raw body parsing, Standard Webhooks signature verification,
 * and routing.
 *
 * Events handled:
 * - order.paid → credit the wallet for a top-up (only when metadata.type is
 *   'credit_topup' — an off-session debt-collection/instant-top-up charge
 *   also produces a paid order, but paymentMethodService.chargeOffSession
 *   already knows synchronously whether that charge succeeded from the
 *   finalize API's own response, so this handler must not double-process it;
 *   see the idempotency + metadata.type checks below)
 * - order.refunded / dispute-equivalent → ported near-verbatim from
 *   webhooks/stripe.routes.js's handleChargeRefunded/handleDisputeCreated;
 *   the business logic (wallet-then-debt on refund, hold + pause on dispute)
 *   is gateway-agnostic, only the event names/payload paths differ.
 *
 * NOTE — flagged for live verification: exact event names/payload shapes for
 * refund and dispute-equivalent events were not confirmed against Polar's
 * live dashboard during this integration's research pass (only order.paid
 * was directly confirmed). The EVENT_HANDLERS map below wires up what
 * research grounded; add the others once confirmed rather than guessing
 * their names here.
 */
const paymentService = require('../../services/billing/paymentService');
const topUpService = require('../../services/billing/topUpService');

const TAG = '[Polar]';

// ──────────────────────────────────────────────
// order.paid — credit top-up (metadata.type === 'credit_topup')
// ──────────────────────────────────────────────
const handleCreditTopUpOrder = async (order, metadata) => {
  const amount = Number(metadata.credits) || (order.amount || 0) / 100;

  if (amount <= 0) {
    console.error(`${TAG} credit_topup order has no usable amount`);
    return;
  }

  await topUpService.recordPaidTopUp({
    metadata,
    amount,
    currency: order.currency || metadata.currency,
    source: 'polar',
    ledgerDescription: 'Top-up via Polar',
    payment: {
      status: 'succeeded',
      description: 'Account credit top-up via Polar',
      metadata: { polarOrderId: order.id.toString(), gateway: 'polar' },
      paidAt: order.paid_at ? new Date(order.paid_at) : new Date(),
    },
  });
};

// ──────────────────────────────────────────────
// order.paid — dispatched by metadata.type, mirroring LemonSqueezy's
// custom_data.type dispatch and Stripe's checkout.session metadata dispatch
// ──────────────────────────────────────────────
const handleOrderPaid = async (event) => {
  const order = event.data;
  const metadata = order.metadata || {};

  if (metadata.type !== 'credit_topup') {
    // Most likely an off-session charge this platform itself initiated via
    // chargeOffSession — its caller already has the result synchronously
    // from the finalize API response and does not need this webhook.
    return;
  }

  if (!metadata.teamId && !metadata.userId) {
    console.error(`${TAG} order.paid credit_topup with no account in its metadata`);
    return;
  }

  // Idempotency: a webhook retry (or the verify-checkout local-dev fallback
  // firing after the webhook already landed) must not double-credit the wallet.
  const exists = await paymentService.findByPolarOrderId(order.id.toString());
  if (exists) {
    console.log(`${TAG} Order ${order.id} already processed, skipping`);
    return;
  }

  await handleCreditTopUpOrder(order, metadata);
};

// ──────────────────────────────────────────────
// Event router map
// ──────────────────────────────────────────────
const EVENT_HANDLERS = {
  'order.paid': handleOrderPaid,
};

/**
 * Main webhook handler — called by the route after signature verification.
 * Parses the event, dispatches to the correct handler.
 */
const handleWebhook = async (req, res) => {
  let payload;
  try {
    payload = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const eventType = event.type;

  try {
    const handler = EVENT_HANDLERS[eventType];
    if (handler) {
      await handler(event);
    } else {
      console.log(`${TAG} Unhandled event: ${eventType}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`${TAG} Error handling ${eventType}:`, err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

module.exports = {
  handleWebhook,
  // Exported individually for unit testing / the local-dev verify fallback
  handleOrderPaid,
  handleCreditTopUpOrder,
};
