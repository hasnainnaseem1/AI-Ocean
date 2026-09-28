/**
 * LemonSqueezy Webhook Controller
 *
 * All business logic for processing LemonSqueezy webhook events.
 * The route file handles only raw body parsing, signature verification, and routing.
 *
 * Events handled:
 * - order_created → credit the wallet for a top-up
 */
const paymentService = require('../../services/billing/paymentService');
const topUpService = require('../../services/billing/topUpService');

const TAG = '[LemonSqueezy]';

// ──────────────────────────────────────────────
// Credit top-up order (custom_data.type === 'credit_topup')
// ──────────────────────────────────────────────
const handleCreditTopUpOrder = async (event, customData) => {
  const attrs = event.data.attributes;
  // Trust the amount we set at checkout; fall back to the order total
  const amount = Number(customData.credits) || (attrs.total || 0) / 100;

  if (amount <= 0) {
    console.error(`${TAG} credit_topup order has no usable amount`);
    return;
  }

  await topUpService.recordPaidTopUp({
    // LemonSqueezy's custom data is snake_case.
    metadata: { teamId: customData.team_id, userId: customData.user_id },
    amount,
    currency: attrs.currency || customData.currency,
    source: 'lemonsqueezy',
    ledgerDescription: 'Top-up via LemonSqueezy',
    payment: {
      status: attrs.status === 'paid' ? 'succeeded' : 'pending',
      description: 'Account credit top-up via LemonSqueezy',
      receiptUrl: attrs.urls?.receipt,
      metadata: { lemonSqueezyOrderId: event.data.id.toString(), gateway: 'lemonsqueezy' },
      paidAt: attrs.created_at ? new Date(attrs.created_at) : new Date(),
    },
  });
};

// ──────────────────────────────────────────────
// order_created — every order on this platform is a credit top-up
// ──────────────────────────────────────────────
const handleOrderCreated = async (event, customData) => {
  if (!customData.team_id && !customData.user_id) return;

  // Idempotency: skip if already recorded
  const exists = await paymentService.findByLemonSqueezyOrderId(event.data.id.toString());
  if (exists) return;

  if (customData.type === 'credit_topup') {
    await handleCreditTopUpOrder(event, customData);
    return;
  }

  console.error(`${TAG} order_created with unrecognized custom_data.type:`, customData.type);
};

// ──────────────────────────────────────────────
// Event router map
// ──────────────────────────────────────────────
const EVENT_HANDLERS = {
  order_created: handleOrderCreated,
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

  const eventName = event.meta?.event_name;
  const customData = event.meta?.custom_data || {};

  try {
    const handler = EVENT_HANDLERS[eventName];
    if (handler) {
      await handler(event, customData);
    } else {
      console.log(`${TAG} Unhandled event: ${eventName}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`${TAG} Error handling ${eventName}:`, err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

module.exports = {
  handleWebhook,
  // Exported individually for unit testing
  handleOrderCreated,
  handleCreditTopUpOrder,
};
