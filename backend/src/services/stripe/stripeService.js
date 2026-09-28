/**
 * Stripe Service
 * 
 * Handles all Stripe API interactions. Initializes lazily with keys from AdminSettings.
 */
const adminSettingsService = require('../admin/adminSettingsService');
const teamService = require('../team/teamService');

class StripeService {
  constructor() {
    this.stripe = null;
  }

  /**
   * Initialize Stripe with keys from AdminSettings
   */
  async initialize() {
    const settings = await adminSettingsService.getSettings();
    const stripeConfig = settings.stripeSettings;

    if (!stripeConfig || !stripeConfig.secretKey) {
      throw new Error('Stripe is not configured. Please add Stripe keys in Admin → Settings.');
    }

    const Stripe = require('stripe');
    this.stripe = Stripe(stripeConfig.secretKey);
    return this.stripe;
  }

  /**
   * Get or create the Stripe customer for an ACCOUNT (a Team — personal or
   * shared). Cards and payments belong to the account, so the gateway
   * customer does too; a member of two teams has two Stripe customers, one
   * per account, and a card saved in one is never chargeable for the other.
   */
  async getOrCreateCustomer(team) {
    await this.initialize();

    if (team.stripeCustomerId) {
      try {
        const customer = await this.stripe.customers.retrieve(team.stripeCustomerId);
        if (!customer.deleted) return customer;
      } catch (err) {
        // Customer doesn't exist in Stripe anymore, create new one
      }
    }

    const contact = await teamService.gatewayContact(team);
    const customer = await this.stripe.customers.create({
      email: contact.email,
      name: contact.name,
      metadata: { teamId: String(team.id), ownerUserId: String(contact.ownerUserId || '') },
    });

    await teamService.update(team, { stripeCustomerId: customer.id });
    team.stripeCustomerId = customer.id;

    return customer;
  }

  /**
   * Create a one-time Checkout Session that adds credit to the customer's
   * wallet. Uses mode 'payment' rather than 'subscription' — the webhook
   * branches on metadata.type to tell the two apart.
   */
  async createTopUpSession({ team, actor, amount, currency = 'USD', successUrl, cancelUrl }) {
    await this.initialize();

    if (!amount || amount <= 0) {
      throw new Error('Top-up amount must be greater than zero.');
    }

    const customer = await this.getOrCreateCustomer(team);
    const siteBase = process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002';

    // `teamId` decides whose wallet the money lands in; `userId` records who
    // paid. The webhook trusts only these server-written values.
    const session = await this.stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: (currency || 'USD').toLowerCase(),
          product_data: {
            name: 'Account credit',
            description: `${currency} ${Number(amount).toFixed(2)} of pay-as-you-go credit`,
          },
          unit_amount: Math.round(amount * 100), // Stripe uses cents
        },
        quantity: 1,
      }],
      metadata: {
        type: 'credit_topup',
        teamId: String(team.id),
        userId: String(actor.id),
        credits: String(amount),
        currency,
      },
      // Mirrored onto the PaymentIntent so the webhook can read it either way
      payment_intent_data: {
        metadata: {
          type: 'credit_topup',
          teamId: String(team.id),
          userId: String(actor.id),
          credits: String(amount),
          currency,
        },
      },
      success_url: successUrl || `${siteBase}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${siteBase}/checkout/cancel`,
    });

    return session;
  }

  /**
   * Retrieve a Checkout Session
   */
  async retrieveCheckoutSession(sessionId) {
    await this.initialize();
    return this.stripe.checkout.sessions.retrieve(sessionId);
  }

  /**
   * Get webhook secret from settings
   */
  async getWebhookSecret() {
    const settings = await adminSettingsService.getSettings();
    return settings.stripeSettings?.webhookSecret;
  }

  /**
   * Construct event from webhook payload
   */
  async constructWebhookEvent(payload, signature) {
    await this.initialize();
    const webhookSecret = await this.getWebhookSecret();

    if (!webhookSecret) {
      throw new Error('Stripe webhook secret is not configured.');
    }

    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
}

module.exports = new StripeService();
