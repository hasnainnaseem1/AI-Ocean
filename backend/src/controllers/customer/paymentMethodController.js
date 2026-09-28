/**
 * Payment Method Controller
 *
 * Saved cards: starting verification, recording a verified card, listing,
 * switching the default, and removing one. The actual card data never passes
 * through this server — see paymentMethodService for why.
 */
const paymentMethodService = require('../../services/billing/paymentMethodService');
const { failure } = require('../../utils/helpers/apiError');
const deploymentService = require('../../services/deployment/deploymentService');

const { serialize } = paymentMethodService;

/**
 * GET /api/v1/customer/payment-methods
 *
 * Also pulls in any card the customer already attached to their Stripe
 * customer through some other flow (a wallet top-up, most commonly) before
 * listing — so a card that already exists on Stripe's side is never invisible
 * here just because it wasn't added through this exact form.
 */
const getPaymentMethods = async (req, res) => {
  try {
    await paymentMethodService.syncFromGateway(req.team, req.user).catch((err) => {
      console.error('[PaymentMethods] Sync-on-read failed (non-fatal):', err.message);
    });

    const cards = await paymentMethodService.list(req.team.id);
    res.json({ success: true, paymentMethods: cards.map(serialize) });
  } catch (error) {
    console.error('List payment methods error:', error);
    res.status(500).json({ success: false, message: 'Error fetching payment methods' });
  }
};

/**
 * POST /api/v1/customer/payment-methods/setup-intent
 *
 * Step one of adding a card: get a client secret, hand it to Stripe Elements
 * on the frontend, which collects and confirms the card directly with
 * Stripe — this server never sees the card number.
 */
const createSetupIntent = async (req, res) => {
  try {
    const { clientSecret } = await paymentMethodService.createSetupIntent(req.team, req.user);
    res.json({ success: true, clientSecret });
  } catch (error) {
    console.error('Create setup intent error:', error);
    failure(res, error, 'Could not start card verification.');
  }
};

/**
 * POST /api/v1/customer/payment-methods/polar-portal
 *
 * Polar's equivalent of setup-intent — except Polar's card management is a
 * hosted redirect, not an embedded form, so there's no "confirm, then POST
 * back the result" second step: the frontend just sends the customer to this
 * URL, and any card they save becomes visible next time getPaymentMethods
 * runs its sync (see paymentMethodService.syncFromPolar).
 */
const createPolarPortalSession = async (req, res) => {
  try {
    const polarService = require('../../services/polar/polarService');
    const baseUrl = process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002';
    const { url } = await polarService.createPortalSession(req.team, `${baseUrl}/billing?tab=cards`);
    res.json({ success: true, url });
  } catch (error) {
    console.error('Create Polar portal session error:', error);
    failure(res, error, 'Could not open card management.');
  }
};

/**
 * POST /api/v1/customer/payment-methods
 *
 * Step two: the frontend confirmed the SetupIntent with Stripe directly and
 * hands us back its id. We verify with Stripe ourselves (never trusting the
 * client's word that it succeeded) and only then record the card.
 */
const attachPaymentMethod = async (req, res) => {
  try {
    const { setupIntentId } = req.body;
    if (!setupIntentId) {
      return res.status(400).json({ success: false, message: 'setupIntentId is required.' });
    }

    const pm = await paymentMethodService.attachFromSetupIntent(req.team, req.user, setupIntentId);

    // Whatever the card gate was blocking is unblocked the instant a
    // verified card lands — same as a top-up clearing a credit-suspend.
    await deploymentService.resumeCardGateSuspended(req.team.id).catch((err) => {
      console.error('[PaymentMethods] Resume-on-card-added failed (non-fatal):', err.message);
    });

    res.json({ success: true, message: 'Card added.', paymentMethod: serialize(pm) });
  } catch (error) {
    if (error.code === 'SETUP_INCOMPLETE' || error.code === 'SETUP_ACCOUNT_MISMATCH') {
      return res.status(400).json({ success: false, code: error.code, message: error.message });
    }
    if (error.code === 'CARD_HELD_ELSEWHERE') {
      return res.status(402).json({ success: false, code: error.code, message: error.message });
    }
    console.error('Attach payment method error:', error);
    res.status(500).json({ success: false, message: 'Could not save this card.' });
  }
};

/**
 * PUT /api/v1/customer/payment-methods/:id/default
 */
const setDefaultPaymentMethod = async (req, res) => {
  try {
    const pm = await paymentMethodService.setDefault(req.team.id, req.params.id);
    res.json({ success: true, message: 'Default card updated.', paymentMethod: serialize(pm) });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return failure(res, error, 'Something went wrong. Please try again.');
    }
    console.error('Set default payment method error:', error);
    res.status(500).json({ success: false, message: 'Could not update default card.' });
  }
};

/**
 * DELETE /api/v1/customer/payment-methods/:id
 */
const removePaymentMethod = async (req, res) => {
  try {
    await paymentMethodService.remove(req.team.id, req.params.id);
    res.json({ success: true, message: 'Card removed.' });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return failure(res, error, 'Something went wrong. Please try again.');
    }
    if (error.code === 'LAST_CARD') {
      return res.status(409).json({ success: false, code: error.code, message: error.message });
    }
    console.error('Remove payment method error:', error);
    res.status(500).json({ success: false, message: 'Could not remove this card.' });
  }
};

module.exports = {
  getPaymentMethods,
  createSetupIntent,
  createPolarPortalSession,
  attachPaymentMethod,
  setDefaultPaymentMethod,
  removePaymentMethod,
};
