/**
 * Wallet Controller
 *
 * The customer's prepaid credit balance: summary, ledger, top-up checkout and
 * auto-top-up preferences. Only reachable when the billing mode includes
 * credits — enforced by checkBillingMode on the routes.
 */
const { failure } = require('../../utils/helpers/apiError');
const { meta } = require('../../utils/helpers/pagination');
const creditService = require('../../services/billing/creditService');
const topUpService = require('../../services/billing/topUpService');
const billingModeService = require('../../services/billing/billingModeService');
const paymentMethodService = require('../../services/billing/paymentMethodService');
const gatewayRegistry = require('../../services/payments/gatewayRegistry');
const adminSettingsService = require('../../services/admin/adminSettingsService');

const getActiveGateway = async () => {
  const settings = await adminSettingsService.getSettings();
  return settings?.activePaymentGateway || 'stripe';
};

/**
 * GET /api/v1/customer/wallet
 * Balance, burn rate, runway and the top-up settings the UI needs.
 */
const getWallet = async (req, res) => {
  try {
    const summary = await creditService.getWalletSummary(req.team.id);
    res.json({ success: true, wallet: summary });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ success: false, message: 'Error fetching wallet' });
  }
};

/**
 * GET /api/v1/customer/wallet/transactions
 */
const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;

    const { transactions, total } = await creditService.listTransactions(req.team.id, { page, limit, type });

    res.json({
      success: true,
      transactions,
      pagination: meta({ page, limit }, total),
    });
  } catch (error) {
    console.error('Get wallet transactions error:', error);
    res.status(500).json({ success: false, message: 'Error fetching transactions' });
  }
};

/**
 * POST /api/v1/customer/wallet/topup
 * Creates a one-time checkout session with the active gateway. The wallet is
 * credited by the webhook (or verify-session fallback), never here.
 */
const createTopUp = async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const settings = await billingModeService.getBillingSettings();

    if (!amount || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Please enter a valid amount' });
    }
    if (amount < settings.minTopUp) {
      return res.status(400).json({
        success: false,
        message: `The minimum top-up is ${settings.currency} ${settings.minTopUp}`,
      });
    }
    if (amount > settings.maxTopUp) {
      return res.status(400).json({
        success: false,
        message: `The maximum top-up is ${settings.currency} ${settings.maxTopUp}`,
      });
    }

    const gateway = await getActiveGateway();
    if (gateway === 'none') {
      return res.status(400).json({
        success: false,
        message: 'No payment gateway is configured. Please contact support.',
      });
    }

    const baseUrl = process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002';
    const cancelUrl = `${baseUrl}/checkout/cancel`;
    // CheckoutSuccessPage.js only ever reads `?session_id=` off the URL — the
    // placeholder each gateway substitutes into it differs, but the query key
    // it lands in stays the same so the frontend needs no gateway branch.
    const successUrl = gateway === 'stripe'
      ? `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&topup=1`
      : gateway === 'polar'
        ? `${baseUrl}/checkout/success?session_id={CHECKOUT_ID}&topup=1`
        : `${baseUrl}/checkout/success?topup=1`;

    const checkout = await gatewayRegistry.createTopUpCheckout(gateway, {
      team: req.team,
      actor: req.user,
      amount,
      currency: settings.currency,
      successUrl,
      cancelUrl,
    });

    res.json({ success: true, url: checkout.url, sessionId: checkout.id, gateway });
  } catch (error) {
    console.error('Create top-up error:', error);
    failure(res, error, 'Failed to start top-up');
  }
};

/**
 * POST /api/v1/customer/wallet/topup/instant
 *
 * Charges the customer's saved default card immediately and credits the
 * wallet in the same request — no redirect, no webhook wait. Built for the
 * checkout modal: a customer who is short on balance can close the gap right
 * there instead of being sent away to a hosted checkout page and losing their
 * place in the deploy flow. Requires a verified card; the redirect-based
 * `/topup` above remains the way to top up without one.
 */
const createInstantTopUp = async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const settings = await billingModeService.getBillingSettings();

    if (!amount || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Please enter a valid amount' });
    }
    if (amount < settings.minTopUp) {
      return res.status(400).json({
        success: false,
        message: `The minimum top-up is ${settings.currency} ${settings.minTopUp}`,
      });
    }
    if (amount > settings.maxTopUp) {
      return res.status(400).json({
        success: false,
        message: `The maximum top-up is ${settings.currency} ${settings.maxTopUp}`,
      });
    }

    let charge;
    try {
      charge = await paymentMethodService.chargeOffSession(req.team.id, amount, {
        currency: settings.currency,
        description: 'Instant wallet top-up',
      });
    } catch (err) {
      const code = err.code || 'CHARGE_FAILED';
      return res.status(402).json({
        success: false,
        code,
        message: code === 'NO_CARD'
          ? 'Add a verified card before topping up instantly.'
          : (err.message || 'The card could not be charged.'),
      });
    }

    // Same path as a gateway webhook's top-up (topUpService): record the
    // payment, credit the account, and bring back anything paused for lack of
    // credit — this route used to skip that last step, so a customer who
    // topped up instantly still had to resume every deployment by hand.
    // `stripePaymentIntentId` is a Stripe-only reconciliation column (used by
    // Stripe's own webhook lookups); every other gateway's charge id goes in
    // metadata instead, matching debtService.settleFromCard's identical split.
    const payment = await topUpService.recordPaidTopUp({
      metadata: { teamId: req.team.id, userId: req.user.id },
      amount,
      currency: settings.currency,
      source: charge.gateway,
      ledgerDescription: `Instant top-up of ${settings.currency} ${amount}`,
      payment: {
        ...(charge.gateway === 'stripe'
          ? { stripePaymentIntentId: charge.paymentIntentId }
          : { metadata: { paymentIntentId: charge.paymentIntentId, gateway: charge.gateway } }),
        status: 'succeeded',
        description: 'Instant wallet top-up via saved card',
        paidAt: new Date(),
      },
    });
    if (!payment) {
      // The card was charged; the credit could not be placed. Loud, so the
      // money can be reconciled by hand rather than silently kept.
      console.error(`[Wallet] Instant top-up charged ${charge.paymentIntentId} but could not credit account ${req.team.id}`);
      return res.status(500).json({ success: false, message: 'Your card was charged but the credit could not be added. Please contact support.' });
    }

    const summary = await creditService.getWalletSummary(req.team.id);
    res.json({ success: true, wallet: summary });
  } catch (error) {
    console.error('Instant top-up error:', error);
    res.status(500).json({ success: false, message: 'Failed to complete instant top-up' });
  }
};

/**
 * PUT /api/v1/customer/wallet/auto-topup
 */
const updateAutoTopUp = async (req, res) => {
  try {
    const { enabled, threshold, amount } = req.body;
    const settings = await billingModeService.getBillingSettings();

    if (threshold !== undefined) {
      const value = Number(threshold);
      if (Number.isNaN(value) || value < 0) {
        return res.status(400).json({ success: false, message: 'Threshold must be zero or more' });
      }
    }

    if (amount !== undefined) {
      const value = Number(amount);
      if (Number.isNaN(value) || value < settings.minTopUp) {
        return res.status(400).json({
          success: false,
          message: `Auto top-up amount must be at least ${settings.currency} ${settings.minTopUp}`,
        });
      }
    }

    const wallet = await creditService.updateAutoTopUp(req.team.id, { enabled, threshold, amount });

    res.json({ success: true, message: 'Auto top-up updated', autoTopUp: wallet.autoTopUp });
  } catch (error) {
    console.error('Update auto top-up error:', error);
    res.status(500).json({ success: false, message: 'Error updating auto top-up' });
  }
};

module.exports = {
  getWallet,
  getTransactions,
  createTopUp,
  createInstantTopUp,
  updateAutoTopUp,
};
