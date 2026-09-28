/**
 * LemonSqueezy Service
 *
 * Handles all LemonSqueezy API interactions.
 * Initializes lazily with keys from AdminSettings and caches them
 * until explicitly cleared via clearCache().
 *
 * LemonSqueezy API: https://docs.lemonsqueezy.com/api
 */
const crypto = require('crypto');
const adminSettingsService = require('../admin/adminSettingsService');

const LEMONSQUEEZY_API_BASE = 'https://api.lemonsqueezy.com/v1';

class LemonSqueezyService {
  constructor() {
    this._initialized = false;
    this.apiKey = null;
    this.storeId = null;
  }

  // ────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────

  /**
   * Lazy-initialize: reads keys from DB once and caches them.
   * Subsequent calls are no-ops until clearCache() is invoked.
   */
  async initialize() {
    if (this._initialized) return this;

    const settings = await adminSettingsService.getSettings();
    const config = settings.lemonSqueezySettings;

    if (!config || !config.apiKey) {
      throw new Error(
        'LemonSqueezy is not configured. Please add API key in Admin → Settings → Integrations.'
      );
    }

    this.apiKey = config.apiKey;
    this.storeId = config.storeId;
    this._initialized = true;
    return this;
  }

  /**
   * Clear cached credentials.
   * Called when admin updates LemonSqueezy settings so the service
   * re-reads from DB on the next request.
   */
  clearCache() {
    this._initialized = false;
    this.apiKey = null;
    this.storeId = null;
  }

  // ────────────────────────────────────────────
  // HTTP helper
  // ────────────────────────────────────────────

  /**
   * Make an authenticated JSON:API request to LemonSqueezy.
   */
  async request(method, path, body = null) {
    await this.initialize();

    const url = `${LEMONSQUEEZY_API_BASE}${path}`;
    const headers = {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      console.error('[LemonSqueezy] API error:', {
        status: response.status,
        url,
        errors: data.errors,
        body: body ? JSON.stringify(body).substring(0, 500) : null,
      });
      const errorMsg =
        data.errors?.[0]?.detail ||
        data.message ||
        `LemonSqueezy API error (${response.status})`;
      throw new Error(errorMsg);
    }

    return data;
  }

  // ────────────────────────────────────────────
  // Checkout
  // ────────────────────────────────────────────

  /**
   * Create a one-time checkout that adds credit to the customer's wallet.
   *
   * LemonSqueezy prices live on variants rather than on the request, so the
   * admin configures one "top-up" variant per preset amount under
   * Settings → Integrations → LemonSqueezy → topUpVariants, e.g.
   *   { "25": "123456", "50": "123457", "100": "123458" }
   * `custom.credits` tells the webhook how much to credit.
   */
  async createTopUpCheckout({ team, actor, amount, currency = 'USD', successUrl }) {
    await this.initialize();

    if (!this.storeId) {
      throw new Error('LemonSqueezy Store ID is not configured.');
    }

    const settings = await adminSettingsService.getSettings();
    const variantMap = settings.lemonSqueezySettings?.topUpVariants || {};

    // a Map or a plain object depending on how it was written
    const variantId =
      typeof variantMap.get === 'function'
        ? variantMap.get(String(amount))
        : variantMap[String(amount)];

    if (!variantId) {
      /**
       * This is a configuration gap, not a server fault and not the customer's
       * mistake — so it carries a message written for them, and the operator's
       * runbook goes to the log instead of into the response. It used to be
       * thrown as a bare Error, which meant the customer was told to go and
       * edit an Admin Center they cannot reach.
       */
      // eslint-disable-next-line no-console
      console.error(
        `[LemonSqueezy] No top-up variant configured for ${currency} ${amount}. `
        + 'Add one in Admin Center → Integrations → LemonSqueezy → Top-up variants, '
        + 'or switch the active gateway to Stripe, which supports any amount.'
      );

      const err = new Error(
        `${currency} ${amount} is not available as a top-up amount right now. `
        + 'Please try one of the suggested amounts, or contact support.'
      );
      err.status = 503;
      err.code = 'TOPUP_AMOUNT_UNAVAILABLE';
      throw err;
    }

    const siteBase = process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002';

    const checkoutData = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: actor.email,
            name: actor.name,
            custom: {
              type: 'credit_topup',
              team_id: String(team.id),
              user_id: String(actor.id),
              credits: String(amount),
              currency,
            },
          },
          checkout_options: {
            embed: false,
            media: false,
            button_color: '#6C63FF',
          },
          product_options: {
            enabled_variants: [parseInt(variantId)],
            redirect_url: successUrl || `${siteBase}/checkout/success`,
            receipt_button_text: 'Go to Wallet',
            receipt_link_url: `${siteBase}/wallet`,
          },
        },
        relationships: {
          store: { data: { type: 'stores', id: this.storeId.toString() } },
          variant: { data: { type: 'variants', id: variantId.toString() } },
        },
      },
    };

    const result = await this.request('POST', '/checkouts', checkoutData);
    return {
      url: result.data.attributes.url,
      checkoutId: result.data.id,
    };
  }

  // ────────────────────────────────────────────
  // Webhook utilities
  // ────────────────────────────────────────────

  /**
   * Verify LemonSqueezy webhook signature (HMAC SHA-256).
   * Uses timing-safe comparison to prevent timing attacks.
   */
  verifyWebhookSignature(payload, signature, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(payload).digest('hex');
    const sigBuf = Buffer.from(signature);
    const digBuf = Buffer.from(digest);
    // timingSafeEqual requires identical byte lengths — return false if mismatch
    if (sigBuf.length !== digBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, digBuf);
  }

  /**
   * Retrieve webhook secret from AdminSettings.
   * (Does NOT require full initialization — only needs the secret.)
   */
  async getWebhookSecret() {
    const settings = await adminSettingsService.getSettings();
    return settings.lemonSqueezySettings?.webhookSecret;
  }
}

module.exports = new LemonSqueezyService();
