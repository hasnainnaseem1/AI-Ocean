/**
 * Billing Mode Service
 *
 * Single source of truth for the platform's billing settings — a prepaid
 * credits wallet, with usage burned hourly (see AdminSettings.billingSettings
 * for prepaid-only vs. debt-allowed). The platform owner tunes it from
 * Admin Center → Settings → Billing; nothing here is hardcoded in routes or UI.
 */
const adminSettingsService = require('../admin/adminSettingsService');

const DEFAULTS = {
  // Mirrors the AdminSettings scalar; see getBillingSettings.
  activePaymentGateway: 'stripe',
  currency: 'USD',
  minTopUp: 10,
  maxTopUp: 5000,
  // Ceiling on a single manual credit/debit from Admin Center → Wallets, in
  // either direction. An adjustment far outside the normal range is far more
  // likely to be a typo than an intention — an extra zero here puts a customer
  // thousands into debt in one click. Tunable rather than hardcoded, like
  // every other billing limit.
  maxManualAdjustment: 10000,
  topUpPresets: [25, 50, 100, 250],
  signupBonusCredits: 0,
  lowBalanceThreshold: 10,
  lowBalanceHours: 24,
  graceBalance: 0,
  autoSuspendAtZero: true,
  minHoursBalanceToDeploy: 24,
  // Paused/stopped deployments keep paying for the disk they still occupy
  billStorageWhileStopped: true,
  hoursPerMonth: 730,
  // See AdminSettings.billingSettings.payg for what each field means
  payg: {
    enabled: true,
    creditLimit: 50,
    maxDebtDays: 7,
    autoChargeThreshold: 1,
    autoChargeRetryDays: [1, 3, 5],
    eligibility: { minLifetimeSpend: 0, minAccountAgeDays: 0 },
  },
  // Off by default — see AdminSettings.billingSettings.cardGate
  cardGate: {
    requireVerifiedCard: false,
    verifyWithAuthHold: false,
    authHoldAmount: 1,
    authHoldMaxAgeHours: 24,
    whenGatewayCannotStoreCards: 'prepaid_only',
    grandfatherUntil: null,
  },
  // See adminSettingsDefaults for what this governs.
  customBuild: {
    enabled: true,
    markupPercent: 0,
  },
  storageGrace: {
    enabled: true,
    graceDays: 7,
    terminateAtEnd: true,
    warnDailyFrom: 1,
  },
  suspendOrder: 'most_expensive',
  staleProvisioningDays: 3,
  cardExpiryWarningDays: [30, 14, 7],
  copy: {
    autoSuspendedMessage:
      '"{deploymentName}" was paused because your balance ran out, and its API key has stopped '
      + 'working. Your data and disk are kept. Top up to bring it back — a new API key will be '
      + 'issued when it resumes.',
    storageDebtMessage:
      '"{deploymentName}" is stopped, but it still holds {storageGb} GB of storage, which keeps '
      + 'billing. Top up to settle it, or terminate the deployment to release the disk.',
    checkoutCardRequiredMessage:
      'A verified card is required before you can deploy — for pay-as-you-go or prepaid credit.',
    checkoutPaygIneligibleMessage:
      'Pay-as-you-go unlocks once you have spent at least {currency} {minLifetimeSpend} and been '
      + 'on the platform for {minAccountAgeDays} day(s).',
  },
};

/** Full billing settings block, with defaults filled in. */
const getBillingSettings = async () => {
  try {
    const settings = await adminSettingsService.getSettings();
    return {
      ...DEFAULTS,
      ...(settings.billingSettings?.toObject?.() || settings.billingSettings || {}),
      /*
       * Which gateway is live is stored as a top-level AdminSettings scalar,
       * not inside billingSettings — but it is a billing fact, and every
       * billing decision that needs it already has this object in hand. Folded
       * in here so no call site has to make a second settings read, and so
       * nobody reaches for `billingSettings.activePaymentGateway` and silently
       * gets `undefined` (which reads as "this gateway cannot store cards" and
       * would refuse every card-gated customer on the platform).
       */
      activePaymentGateway: settings.activePaymentGateway || DEFAULTS.activePaymentGateway,
    };
  } catch (err) {
    console.error('Error reading billing settings, falling back to defaults:', err.message);
    return { ...DEFAULTS };
  }
};

/**
 * No plan-based discount system exists anymore (subscriptions were removed) —
 * kept as a no-op so the several call sites that apply "the discount" to an
 * hourly rate don't need individual edits.
 */
const getPlanDiscount = async () => 0;

module.exports = {
  DEFAULTS,
  getBillingSettings,
  getPlanDiscount,
};
