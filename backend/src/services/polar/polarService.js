/**
 * Polar Service
 *
 * Handles all Polar (polar.sh) API interactions. Polar is a Merchant of
 * Record — like LemonSqueezy — but unlike LemonSqueezy it can store a card
 * and charge it later without the customer present, which is what this
 * platform's PAYG billing actually needs from a gateway (see
 * paymentMethodService.js's class comment): a one-time hosted checkout for
 * wallet top-ups, and an on-demand off-session charge for debt collection
 * and instant top-up. It was chosen over Stripe (does not onboard
 * Pakistan-based sellers) and over Paddle (a documented, dated case of a
 * Pakistan-based seller being rejected with no appeal) — see the Polar
 * integration plan for the full comparison.
 *
 * Initializes lazily with credentials from AdminSettings, caches them until
 * explicitly cleared — same shape as stripeService.js/lemonSqueezyService.js.
 *
 * Polar API reference: https://polar.sh/docs/api-reference
 */
const crypto = require('crypto');
const adminSettingsService = require('../admin/adminSettingsService');
const teamService = require('../team/teamService');

const POLAR_API_BASE = {
  live: 'https://api.polar.sh/v1',
  sandbox: 'https://sandbox-api.polar.sh/v1',
};

class PolarService {
  constructor() {
    this._initialized = false;
    this.accessToken = null;
    this.organizationId = null;
    this.productId = null;
    this.sandbox = false;
  }

  // ────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────

  /**
   * Lazy-initialize: reads credentials from DB once and caches them.
   * Subsequent calls are no-ops until clearCache() is invoked.
   */
  async initialize() {
    if (this._initialized) return this;

    const settings = await adminSettingsService.getSettings();
    const config = settings.polarSettings;

    if (!config || !config.accessToken || !config.organizationId) {
      throw new Error(
        'Polar is not configured. Please add credentials in Admin → Settings → Integrations.'
      );
    }

    this.accessToken = config.accessToken;
    this.organizationId = config.organizationId;
    this.productId = config.productId || null;
    this.sandbox = !!config.sandbox;
    this._initialized = true;
    return this;
  }

  /**
   * Clear cached credentials. Called when admin updates Polar settings so
   * the service re-reads from DB on the next request.
   */
  clearCache() {
    this._initialized = false;
    this.accessToken = null;
    this.organizationId = null;
    this.productId = null;
    this.sandbox = false;
  }

  get apiBase() {
    return this.sandbox ? POLAR_API_BASE.sandbox : POLAR_API_BASE.live;
  }

  // ────────────────────────────────────────────
  // HTTP helper
  // ────────────────────────────────────────────

  /** Make an authenticated JSON request to Polar. */
  async request(method, path, body = null) {
    await this.initialize();

    const url = `${this.apiBase}${path}`;
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
    };

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[Polar] API error:', {
        status: response.status,
        url,
        detail: data.detail,
        body: body ? JSON.stringify(body).substring(0, 500) : null,
      });
      const errorMsg = (Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail)
        || `Polar API error (${response.status})`;
      const err = new Error(errorMsg);
      err.status = response.status;
      err.polarBody = data;
      throw err;
    }

    return data;
  }

  // ────────────────────────────────────────────
  // Customers
  // ────────────────────────────────────────────

  /**
   * Get or create the Polar customer for an account (a Team). `external_id`
   * carries the account id so Polar-side lookups/webhooks can be resolved back
   * to it without a second round trip, mirroring what `metadata` does for
   * Stripe.
   *
   * No `organization_id` in the create body — confirmed live against Polar's
   * sandbox: an Organization Access Token already scopes every request to
   * one organization, and the API rejects `organization_id` as redundant
   * ("Setting organization_id is disallowed when using an organization
   * token") rather than silently ignoring it.
   */
  async getOrCreateCustomer(team) {
    await this.initialize();

    if (team.polarCustomerId) {
      try {
        const customer = await this.request('GET', `/customers/${team.polarCustomerId}`);
        if (!customer.deleted_at) return customer;
      } catch (err) {
        // Customer no longer exists on Polar's side — fall through and create a new one.
      }
    }

    /*
     * `external_id` is the ACCOUNT's id, and must be: Polar requires it to be
     * unique, and one person can pay for a personal account and a team — keyed
     * on the user, the second account's customer could never be created.
     * (Customers created before teams carry the user id; they are found by
     * `polarCustomerId` above and never re-created.)
     */
    const contact = await teamService.gatewayContact(team);
    const customer = await this.request('POST', '/customers/', {
      email: contact.email,
      name: contact.name,
      external_id: String(team.id),
      metadata: { teamId: String(team.id), ownerUserId: String(contact.ownerUserId || '') },
    });

    await teamService.update(team, { polarCustomerId: customer.id });
    team.polarCustomerId = customer.id;

    return customer;
  }

  // ────────────────────────────────────────────
  // Checkout (top-up)
  // ────────────────────────────────────────────

  /**
   * Create a one-time hosted Checkout Session that adds credit to the
   * customer's wallet.
   *
   * Polar checkouts are normally tied to a catalog product's fixed price;
   * a top-up amount is chosen by the customer, so this attaches an ad-hoc
   * price for the requested amount to the placeholder "AI-Ocean Credit"
   * product (`polarSettings.productId`) rather than requiring one
   * pre-configured product per preset amount the way LemonSqueezy's
   * `topUpVariants` does.
   *
   * `prices` is confirmed (against Polar's published Checkout Session schema,
   * `/v1/checkouts/` create request) to be an object KEYED BY product id,
   * each value a list of ad-hoc price objects — not a flat array with
   * `product_id` inside each entry. The `fixed` variant of that discriminated
   * union takes exactly `amount_type: 'fixed'` + `price_amount` (its sibling
   * `custom` variant is a pay-what-you-want price with a min/max/preset
   * instead, which is not what a top-up needs — the amount is already known
   * server-side).
   */
  async createCheckoutSession({ team, actor, amount, currency = 'USD', successUrl }) {
    await this.initialize();

    if (!amount || amount <= 0) {
      throw new Error('Top-up amount must be greater than zero.');
    }
    if (!this.productId) {
      throw new Error(
        'Polar product ID is not configured. Create a placeholder fixed-price product in '
        + 'your Polar dashboard and set its ID in Admin → Settings → Integrations → Polar.'
      );
    }

    const customer = await this.getOrCreateCustomer(team);
    const siteBase = process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002';

    const session = await this.request('POST', '/checkouts/', {
      products: [this.productId],
      prices: {
        [this.productId]: [{
          amount_type: 'fixed',
          price_amount: Math.round(amount * 100),
        }],
      },
      customer_id: customer.id,
      customer_email: actor.email,
      customer_name: actor.name,
      success_url: successUrl || `${siteBase}/checkout/success?checkout_id={CHECKOUT_ID}`,
      metadata: {
        type: 'credit_topup',
        teamId: String(team.id),
        userId: String(actor.id),
        credits: String(amount),
        currency,
      },
    });

    return { url: session.url, checkoutId: session.id };
  }

  /** Retrieve a Checkout Session — used by the local-dev verify-session fallback. */
  async retrieveCheckoutSession(checkoutId) {
    return this.request('GET', `/checkouts/${checkoutId}`);
  }

  /**
   * Find the Order a Checkout Session produced. A Checkout Session's own
   * response has no `order_id` field (confirmed against Polar's schema), so
   * this goes through `GET /v1/orders/?checkout_id=` instead. Used by the
   * local-dev verify-session fallback so it hands the real order to
   * `polarWebhookController.handleOrderPaid` and gets the exact same
   * order.id-keyed idempotency the real `order.paid` webhook uses — rather
   * than crediting the wallet under a different key the webhook wouldn't
   * recognize as already-processed if it also fires.
   */
  async findOrderByCheckoutId(checkoutId) {
    await this.initialize();
    const result = await this.request('GET', `/orders/?checkout_id=${checkoutId}&limit=1`);
    return (result.items || [])[0] || null;
  }

  /**
   * List every payment method Polar has on file for a customer — confirmed
   * against `GET /v1/customers/{id}/payment-methods`, which (unlike deleting
   * one) works with our organization access token, no customer session
   * needed. Used the same way `paymentMethodService.syncFromGateway` uses
   * Stripe's `paymentMethods.list`: after a customer saves a card via the
   * hosted Customer Portal, this is how our own `PaymentMethod` table learns
   * about it — nothing pushes it to us proactively (there is no dedicated
   * "payment method saved" webhook event, per Polar's docs).
   */
  async listPaymentMethods(customerId) {
    await this.initialize();
    const result = await this.request('GET', `/customers/${customerId}/payment-methods?limit=100`);
    return result.items || [];
  }

  // ────────────────────────────────────────────
  // Off-session charging — PAYG debt collection + instant top-up
  // ────────────────────────────────────────────

  /**
   * Charge a customer's saved card without them present — the Polar
   * equivalent of Stripe's `paymentIntents.create({ off_session: true,
   * confirm: true })`, called by paymentMethodService.chargeOffSession.
   *
   * Two-step, both confirmed against Polar's docs: create a draft order for
   * a custom amount against the placeholder product (fires `order.created`,
   * no charge yet, no customer email), then finalize it, which synchronously
   * attempts the charge against the customer's default saved payment method
   * (or a specific one via `payment_method_id`). Unlike Stripe's async
   * webhook-confirmed flow, the result here is known immediately from the
   * finalize response — no need to wait for a webhook to know if this
   * particular charge succeeded.
   *
   * Constraint (confirmed): only fixed-price/free/unit-based products
   * support off-session charges — the placeholder product must not be a
   * subscription product. Also confirmed: the order-create body does NOT
   * accept a `metadata` field (only `customer_id`, `product_id`, `units`,
   * `amount`, `currency`, `description`, `organization_id`) — identifying
   * info goes in `description` instead; the order is traceable back to the
   * user via its `customer_id` regardless. Off-session charging additionally
   * requires the organization to be on a paid Polar plan and have
   * `orders:write` + sales-management permission — a 403 here means that
   * prerequisite isn't met, not a bug in this call.
   *
   * Takes `customerId`/`paymentMethodId` directly rather than a `user`
   * object — `paymentMethodService.chargeOffSession` already has both off the
   * saved `PaymentMethod` row (`providerCustomerId`/`providerPaymentMethodId`)
   * and charging the exact card on file, rather than re-deriving "the
   * customer's default" through another round trip, is what a specific saved
   * card on file should mean here.
   */
  async chargeOffSession({ customerId, paymentMethodId, amount, currency = 'usd', description }) {
    await this.initialize();

    if (!this.productId) {
      throw new Error('Polar product ID is not configured.');
    }

    const order = await this.request('POST', '/orders/', {
      customer_id: customerId,
      product_id: this.productId,
      amount: Math.round(amount * 100),
      currency: (currency || 'usd').toLowerCase(),
      description: description || 'AI-Ocean — pay-as-you-go charge',
    });

    const finalized = await this.request('POST', `/orders/${order.id}/finalize`, paymentMethodId ? { payment_method_id: paymentMethodId } : {});

    return { order: finalized };
  }

  // ────────────────────────────────────────────
  // Saved card management — hosted, not embedded
  // ────────────────────────────────────────────

  /**
   * Polar's card management is a hosted redirect (Customer Portal), not an
   * embedded form like Stripe Elements — PCI compliance lives entirely on
   * Polar's side. PaymentMethodsTab.js's Polar branch redirects here instead
   * of opening a client-side card form.
   *
   * This is also the ONLY way a Polar card gets removed — deleting a payment
   * method (`customer_portal/delete-customer-payment-method`) requires a
   * customer-session token, which only exists inside a live portal session
   * the customer is in; our backend's organization access token can list a
   * customer's cards (see `listPaymentMethods`) but cannot detach one itself.
   * `paymentMethodService.remove`'s Polar branch is a DB-only no-op for the
   * gateway side because of this — see the comment there.
   */
  async createPortalSession(team, returnUrl) {
    await this.initialize();
    const customer = await this.getOrCreateCustomer(team);
    const session = await this.request('POST', '/customer-sessions/', {
      customer_id: customer.id,
      ...(returnUrl ? { return_url: returnUrl } : {}),
    });
    return { url: session.customer_portal_url };
  }

  // ────────────────────────────────────────────
  // Webhook utilities
  // ────────────────────────────────────────────

  /**
   * Verify a Polar webhook signature — the Standard Webhooks spec
   * (standardwebhooks.com), confirmed different from LemonSqueezy's raw HMAC.
   *
   * Signed content is `{webhook-id}.{webhook-timestamp}.{body}` (dot-joined),
   * HMAC-SHA256 with the *decoded* secret (the part of `whsec_...` after the
   * prefix is base64), compared against the `webhook-signature` header's
   * `v1,<base64>` entries — the header may carry several space-separated
   * entries for secret rotation, and any match is valid.
   *
   * Also rejects stale timestamps (>5 minutes old), per the spec's replay
   * protection recommendation — LemonSqueezy's verifier has no such check
   * because it has no timestamp header to check.
   */
  verifyWebhookSignature(payload, headers, secret) {
    const id = headers['webhook-id'];
    const timestamp = headers['webhook-timestamp'];
    const signatureHeader = headers['webhook-signature'];
    if (!id || !timestamp || !signatureHeader) return false;

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const signedContent = `${id}.${timestamp}.${payload}`;
    const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
    const expectedBuf = Buffer.from(expected);

    return signatureHeader.split(' ').some((entry) => {
      const [, sig] = entry.split(',');
      if (!sig) return false;
      const sigBuf = Buffer.from(sig);
      if (sigBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    });
  }

  /**
   * Retrieve webhook secret from AdminSettings.
   * (Does NOT require full initialization — only needs the secret.)
   */
  async getWebhookSecret() {
    const settings = await adminSettingsService.getSettings();
    return settings.polarSettings?.webhookSecret;
  }
}

module.exports = new PolarService();
