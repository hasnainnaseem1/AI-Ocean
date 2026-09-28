/**
 * The seam between "which payment gateway is active" and "what a call site
 * actually needs to do."
 *
 * Before this file, every gateway-aware call site (walletController's
 * createTopUp, the admin integrations UI, the settings validators) hand-wrote
 * its own `if (gateway === 'lemonsqueezy') {...} else {...}` branch, and each
 * one would have needed a third arm added by hand for Polar — and a fourth,
 * were another gateway ever added. This describes each gateway's
 * capabilities once, in one place, and the one call site that actually
 * dispatches by gateway (`createTopUpCheckout` below) reads from it instead
 * of growing another branch.
 *
 * This does NOT wrap or rename anything inside stripeService.js /
 * lemonSqueezyService.js / polarService.js — those methods keep their own
 * names and shapes (`createTopUpSession` vs `createTopUpCheckout`, for
 * instance) because they are live, tested code and a forced rename would be
 * pure churn for no behavioural gain. This file only normalizes the *call*.
 */
const stripeService = require('../stripe/stripeService');
const lemonSqueezyService = require('../lemonsqueezy/lemonSqueezyService');
const polarService = require('../polar/polarService');

/**
 * @property {object}  service        the gateway's own service singleton
 * @property {boolean} canStoreCards  can this gateway save a card and charge
 *                                    it later without the customer present?
 *                                    Stripe/Polar: yes. LemonSqueezy: no — it
 *                                    is a Merchant of Record and structurally
 *                                    cannot store a card at all.
 * @property {string}  label          display name for admin/error copy
 */
const GATEWAYS = {
  stripe: { service: stripeService, canStoreCards: true, label: 'Stripe' },
  lemonsqueezy: { service: lemonSqueezyService, canStoreCards: false, label: 'LemonSqueezy' },
  polar: { service: polarService, canStoreCards: true, label: 'Polar' },
};

/** Every gateway key that is a real payment gateway (excludes 'none'). */
const PAYMENT_GATEWAY_TYPES = Object.keys(GATEWAYS);

const canStoreCards = (gatewayKey) => !!GATEWAYS[gatewayKey]?.canStoreCards;

const label = (gatewayKey) => GATEWAYS[gatewayKey]?.label || gatewayKey;

/**
 * Create a one-time hosted checkout for a wallet top-up, regardless of which
 * gateway is active. Each gateway's own method keeps its own name/shape
 * (Stripe returns `{ url, id }` as a full Session object, LemonSqueezy/Polar
 * return `{ url, checkoutId }`) — normalized here to one shape so the caller
 * (walletController.createTopUp) has a single code path instead of one
 * per gateway.
 *
 * @param {string} gatewayKey
 * `team` is the account the money is paid into; `actor` is the member paying.
 *
 * @param {{ team: object, actor: object, amount: number, currency: string, successUrl: string, cancelUrl?: string }} params
 * @returns {Promise<{ url: string, id: string }>}
 */
const createTopUpCheckout = async (gatewayKey, params) => {
  const entry = GATEWAYS[gatewayKey];
  if (!entry) {
    const err = new Error(`Unknown payment gateway "${gatewayKey}".`);
    err.status = 400;
    throw err;
  }

  if (gatewayKey === 'stripe') {
    const session = await stripeService.createTopUpSession(params);
    return { url: session.url, id: session.id };
  }

  if (gatewayKey === 'lemonsqueezy') {
    const checkout = await lemonSqueezyService.createTopUpCheckout(params);
    return { url: checkout.url, id: checkout.checkoutId };
  }

  if (gatewayKey === 'polar') {
    const checkout = await polarService.createCheckoutSession(params);
    return { url: checkout.url, id: checkout.checkoutId };
  }

  // Unreachable while GATEWAYS and the branches above stay in sync, but fails
  // loudly instead of silently returning undefined if they ever drift.
  throw new Error(`No checkout dispatcher wired for gateway "${gatewayKey}".`);
};

module.exports = {
  GATEWAYS,
  PAYMENT_GATEWAY_TYPES,
  canStoreCards,
  label,
  createTopUpCheckout,
};
