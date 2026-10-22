/**
 * The full set of defaults a brand-new AdminSettings row gets, before an
 * admin has ever touched a setting. These used to be declared inline in the
 * schema's hundreds of `default: ...` declarations — snapshotted once (via
 * `new AdminSettings({}).toObject()`, before the model was deleted in
 * Phase 6's final cutover) and frozen here as the one and only place these
 * defaults are now declared.
 */
module.exports = {
  themeSettings: {
    appName: 'My Platform',
    appTagline: 'Your Business Optimization Platform',
    appDescription: 'AI-powered business optimization platform',
    logoUrl: '',
    logoSmallUrl: '',
    faviconUrl: '',
    primaryService: 'SEO',
    secondaryService: 'Optimization',
    targetPlatform: '',
    toolType: 'AI Agent',
    welcomeTitle: 'Welcome to {APP_NAME}!',
    welcomeMessage: 'Thank you for joining {APP_NAME}. Please verify your email to get started.',
    emailVerificationMessage: 'Please verify your email to start using our platform.',
    primaryColor: '#7C3AED',
    secondaryColor: '#3B82F6',
    accentColor: '#10B981',
    companyName: '',
  },
  siteName: 'My Platform',
  siteDescription: 'AI-powered platform',
  supportEmail: 'support@example.com',
  contactEmail: 'contact@example.com',
  emailSettings: {
    enabled: true,
    smtpSecure: false,
    fromName: 'Platform Team',
    subjectPrefix: '[Platform]',
  },
  emailTemplates: {
    verification: { subject: '', body: '' },
    welcome: { subject: '', body: '' },
    passwordReset: { subject: '', body: '' },
    deploymentApproved: { subject: '', body: '' },
    deploymentReady: { subject: '', body: '' },
    deploymentRejected: { subject: '', body: '' },
    deploymentSuspended: { subject: '', body: '' },
    creditTopUp: { subject: '', body: '' },
    lowBalance: { subject: '', body: '' },
  },
  customerSettings: {
    requireEmailVerification: true,
    allowTemporaryEmails: false,
    blockedTemporaryEmailDomains: [
      '10minutemail.com', '10minutemail.net', '10minutesmail.com', '10minemail.com',
      'guerrillamail.com', 'guerrillamail.org', 'guerrillamail.net', 'guerrillamail.biz',
      'sharklasers.com', 'grr.la', 'guerrillamailblock.com', 'mailinator.com', 'mailinator2.com',
      'mailinator.net', 'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmail.io',
      'temp-email.org', 'temp-email.net', 'tempemail.net', 'throwaway.email', 'throwawaymail.com',
      'throwaway.top', 'throwaway.me', 'throwawaymail.net', 'throwawaymail.org', 'yopmail.com',
      'yopmail.net', 'yopmail.fr', 'yopmail.de', 'yopmail.es', 'yopmail.it', 'yopmail.jp',
      'yopmail.com.br', 'yopmail.at', 'yopmail.ch', 'yopmail.ru', 'fake-mail.com', 'fakemail.net',
      'fakemail.com', 'fakeinbox.com', 'trashmail.com', 'trashmail.net', 'trash-mail.com',
      'trash-mail.net', 'mailnesia.com', 'emailondeck.com', 'mintemail.com', 'mytemp.email',
      'tempinbox.com', 'dispostable.com', 'emailtemporanea.net', 'burnermail.io', 'burner.email',
      'burnerin.com', 'getnada.com', 'nada.email', 'nadamail.com', 'nada.fr', 'mohmal.com',
      'mailcatch.com', 'anonbox.net', 'spam4.me', 'mailforspam.com', 'spamgourmet.com',
      'spambox.us', 'spamfree24.org', 'crazymailing.com', 'smellfear.com', 'mailexpire.com',
      'mailsac.com', 'tempr.email', 'harakirimail.com', 'mail.tm', 'mailtm.com', 'pokemail.net',
      'pokemail.com', 'maildrop.cc', 'maildrop.com', 'maildrop.net', 'mail-temporaire.fr',
      'mail-temporaire.com', 'disposableemailaddresses.com', 'disposeamail.com', 'disposemail.com',
      'disposable.email', 'tmail.ws', 'tmail.com', 'tmails.net', 'tafmail.com', 'moakt.com',
      'tempsky.com', 'clrmail.com', 'freemail.ms', 'emailnax.com', 'devnullmail.com',
      'inboxbear.com', 'mailzi.ru', 'mailzi.com', 'temp.email', 'temporary.email', 'tempory.email',
      'tempoemail.com', 'temporarymail.com', 'temporaryemail.com', 'temporaryinbox.com',
      'dropmail.me', 'dropmyemail.com', 'emailinbox.com', 'spam.la', 'spambox.com', 'spamfree.org',
      'maildrop.xyz', '1secmail.com', '1secmail.net', '1secmail.org', 'secondmail.com',
      'tempmail.email', 'tempsms.com', 'temporaryphone.com', 'getring.com', 'ringring.jp',
      'tempnote.com', 'guerrillamail.info', 'tempmail.pro', 'smstempmail.com', 'sms-temp-mail.com',
      'mailslite.com', 'mailsilo.com', 'mailstro.com', 'sharp-secure.com', 'vpn.sc', 'temp.sh',
      'protomail.com', 'protonmail.com', 'keepmail.me', 'keepmymail.com', 'vpn.email',
      'vpnadmin.email', 'temp.0box.eu', 'inbox.tm', 'privateemail.com', 'proton.me',
      'nonbusimail.com', 'mytrashmail.com', 'yeet.cc', 'mooo.com', 'guerrillamail.xyz',
      'email.com.ve', 'temp-mail.io', 'mail.cx', 'trash.email', 'binkmail.com', 'minutemail.com',
      'junk.to', 'spam-me.com', 'spamspot.com', 'spam123.com', 'spam321.com', '5minutemail.com',
      '5minutemail.net', 'shorttermmail.com', 'inbox.cultparade.in',
    ],
    autoApproveNewcustomers: true,
  },
  securitySettings: {
    maxLoginAttempts: 5,
    lockoutDuration: 7200000,
    passwordMinLength: 8,
    requireStrongPassword: true,
    sessionTimeout: 604800000,
    twoFactorEnabled: false,
  },
  /**
   * What the platform is allowed to RECORD about visits, and for how long.
   *
   * This is the privacy half of analytics and is deliberately separate from
   * `AnalyticsPolicy`, which is the interpretation half (what a number means —
   * dormant, at risk, low stock). The traffic collector reads this; the
   * analysers read the policy; neither reads the other.
   *
   * `enableTracking` and `dataRetentionDays` were already here, written when
   * the settings screen was built, but nothing ever read them — first-party
   * tracking was intended and never shipped. The collector now honours both.
   */
  analyticsSettings: {
    enableTracking: true,
    dataRetentionDays: 90,
    // Which surfaces report. The admin center is off by default: operators
    // studying their own dashboards would otherwise pollute the traffic they
    // are studying.
    trackedSites: { marketing: true, customer: true, admin: false },
    respectDoNotTrack: true,
    // Store only the /24 (or /64) of a visitor's address before any lookup.
    anonymiseIp: true,
    // 1.0 = record every view. Lower it only if volume becomes a problem;
    // every derived figure is divided by this, so it is not free accuracy.
    sampleRate: 1,
    /**
     * Query-string keys stripped server-side before a URL is stored. The
     * customer center's own links carry invitation and password-reset tokens
     * and email addresses, and a URL is the one thing a page-view table exists
     * to keep. Stripping on the client would be a suggestion; this is the
     * enforcement.
     */
    strippedQueryKeys: ['token', 'invite', 'code', 'key', 'signature', 'email', 'password', 'reset'],
  },
  notificationSettings: {
    enableEmailNotifications: true,
    enablePushNotifications: false,
    notifyAdminOnNewcustomer: true,
    notifyAdminOnAutoSuspend: true,
    notifyAdminOnNewTicket: true,

    /**
     * Per-alert delivery: who hears about it, and whether by email.
     *
     * Keyed by alert, so a billing team can get unbilled-usage alerts without
     * also being woken by isolation alerts. Each entry is
     * `{ audience, email }`, where audience is 'admins', 'super_admins',
     * 'role:<CustomRole name>' or 'off'.
     *
     * Empty by default: an alert with no entry here falls back to its own
     * default (every active admin), which is exactly what the code did before
     * any of this was configurable. So an installation that never opens this
     * screen behaves as it always has.
     */
    alerts: {},
  },
  lemonSqueezySettings: {
    enabled: false,
    topUpVariants: {},
  },
  activePaymentGateway: 'stripe',
  maintenanceMode: {
    enabled: false,
    message: 'We are currently performing maintenance. Please check back soon.',
    allowAdminAccess: true,
  },
  seoSettings: {
    socialLinks: {
      twitter: '', facebook: '', linkedin: '', instagram: '', youtube: '',
    },
    socialLinksEnabled: {
      twitter: true, facebook: true, linkedin: true, instagram: true, youtube: true,
    },
    googleAnalyticsId: '',
    googleSearchConsoleVerification: '',
    bingVerification: '',
    defaultOgImage: '',
    enableSitemap: true,
    robotsTxtCustom: '',
    customHeadScripts: '',
    enableSchemaMarkup: true,
    customSocialLinks: [],
  },
  billingSettings: {
    payg: {
      eligibility: { minLifetimeSpend: 0, minAccountAgeDays: 0 },
      enabled: true,
      creditLimit: 50,
      maxDebtDays: 7,
      autoChargeThreshold: 1,
      autoChargeRetryDays: [1, 3, 5],
    },
    cardGate: {
      requireVerifiedCard: false,
      verifyWithAuthHold: false,
      // What to put through the card to prove it still works, and how long a
      // successful check stands before it is done again. Both are money the
      // customer briefly sees on their statement, so both belong to the
      // platform owner rather than to this file.
      authHoldAmount: 1,
      authHoldMaxAgeHours: 24,
      whenGatewayCannotStoreCards: 'prepaid_only',
      grandfatherUntil: null,
    },
    /*
     * Customers building their own machine instead of picking one from the
     * catalogue. Which parts they may use is set per component
     * (`ResourceComponent.availableForCustomBuilds`); this is the master
     * switch and the margin applied on top of the component prices.
     */
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
    copy: {
      autoSuspendedMessage: '"{deploymentName}" was paused because your balance ran out, and its API key has stopped working. Your data and disk are kept. Top up to bring it back — a new API key will be issued when it resumes.',
      storageDebtMessage: '"{deploymentName}" is stopped, but it still holds {storageGb} GB of storage, which keeps billing. Top up to settle it, or terminate the deployment to release the disk.',
      checkoutCardRequiredMessage: 'A verified card is required before you can deploy — for pay-as-you-go or prepaid credit.',
      checkoutPaygIneligibleMessage: 'Pay-as-you-go unlocks once you have spent at least {currency} {minLifetimeSpend} and been on the platform for {minAccountAgeDays} day(s).',
    },
    currency: 'USD',
    minTopUp: 10,
    maxTopUp: 5000,
    topUpPresets: [25, 50, 100, 250],
    signupBonusCredits: 0,
    lowBalanceThreshold: 10,
    lowBalanceHours: 24,
    graceBalance: 0,
    autoSuspendAtZero: true,
    minHoursBalanceToDeploy: 24,
    billStorageWhileStopped: true,
    hoursPerMonth: 730,
    suspendOrder: 'most_expensive',
    staleProvisioningDays: 3,
    cardExpiryWarningDays: [30, 14, 7],
  },
  deploymentSettings: {
    provisioningDriver: 'manual',
    rotateKeyOnEnforcedResume: true,
  },

  /**
   * Google Cloud, for provisioning customer machines.
   *
   * Every default here is the one that cannot spend money. A platform that is
   * half-configured, or whose settings row was created before this section
   * existed, does nothing at all — it does not guess, and it does not create a
   * VM to find out whether it can.
   *
   * The service-account key is the first secret on this platform stored
   * encrypted rather than as plaintext in the settings JSON (Stripe's and
   * Polar's are not). That is a deliberate exception, not an inconsistency:
   * this one key can create and destroy machines that cost real money by the
   * hour, which puts it in a different class from an API token that can take a
   * payment.
   */
  gcpSettings: {
    enabled: false,
    projectId: '',
    // Written by gcpSettingsController through cryptoHelper.encrypt — never the
    // raw JSON, and never echoed back to any client.
    serviceAccountKeyEncrypted: '',
    // Shown in the admin UI so an operator can confirm WHICH key is loaded
    // without the key itself ever leaving the server.
    serviceAccountEmail: '',

    // The account every customer VM runs as. Role-less by design; see
    // infra/gcp/SETUP.md 5.1.
    customerServiceAccount: '',
    network: 'aiocean-customer',
    environment: 'staging',

    /**
     * Build nothing on GCP; record exactly what would have been built.
     *
     * On by default so that a freshly configured platform cannot spend a cent
     * by accident. The whole chain runs — mapper, driver, reconciler, the
     * compute clock, billing, the admin screens — against a synthetic instance,
     * which is how all of it gets exercised before a card is ever charged.
     */
    dryRun: true,
    // How long a dry-run instance pretends to take before reporting RUNNING,
    // so the timing of the real thing is exercised too.
    dryRunRunningAfterSeconds: 45,

    /*
     * There is deliberately no allowlist here any more.
     *
     * Automatic provisioning is what every customer gets; an admin turns it
     * off for ONE account on that account's own page, which sets
     * `Team.autoDeploy = false` and sends that account's deployments to
     * `pending_review` instead. An allowlist in settings made the normal case
     * the one that needed work, and quietly left every new customer on the
     * manual queue forever.
     *
     * The platform-wide brake is still here: `enabled` and `dryRun`.
     */

    /**
     * Hard ceilings. A no-review flow means a bug or an abusive customer can
     * ask for machines faster than anyone can notice, so the limits are
     * refusals rather than alerts.
     */
    maxConcurrentInstancesPerTeam: 3,
    maxConcurrentInstancesPlatform: 25,

    /**
     * Refuse to build a machine that costs us more per hour than the customer
     * is paying. Without a review step this is the only thing standing between
     * a mis-priced tier and an automatic, repeating loss.
     */
    enforceMarginGuard: true,

    /**
     * What Google charges us, per machine type, per hour — the only input the
     * margin guard has.
     *
     * Deliberately a table an operator fills in rather than a number this
     * codebase asserts. GCP's prices change, differ by region, and differ again
     * with any committed-use or sustained-use discount on the account; a figure
     * hardcoded here would be confidently wrong within a quarter, and a
     * confidently wrong margin guard is worse than none.
     *
     * Keyed exactly as the mapper emits a machine type, so both predefined and
     * custom shapes can be recorded:
     *
     *     { "e2-medium": 0.0335, "e2-custom-16-32768": 0.5123 }
     *
     * A machine type with no entry has an unknown cost. With the guard enforced
     * that is a refusal, not a guess — see capGuard.js.
     */
    machineCostPerHour: {},

    // Seconds before a GCP call is abandoned. This codebase has no timeouts
    // anywhere else; a hung call here would wedge the reconciler.
    requestTimeoutSeconds: 30,

    /**
     * The billing account, for reading prices.
     *
     * Optional, and worth having. Without it, prices come from Google's public
     * catalogue — list prices that nobody with sustained-use or committed-use
     * discounts actually pays. With it, the Pricing API returns this account's
     * own contract price, which is what the margin guard should judge against.
     * Format: `012345-6789AB-CDEF01`.
     */
    billingAccountId: '',
  },

  /**
   * What the platform adds on top of a provider's charge.
   *
   * A customer pays for a machine. The platform pays for the machine AND for
   * everything it needs to be reachable and safe — NAT, egress, logging, the
   * platform's own always-on infrastructure — plus tax on all of it. None of
   * that is on any per-VM price list, because no cloud sells it that way.
   *
   * Every value defaults to zero, so a platform that has not configured this
   * sees the provider's raw cost and nothing invented on top. The owner fills
   * these in from their own bill; see services/cloud/costModel.js for exactly
   * how each one is applied.
   */
  /**
   * Amazon Web Services.
   *
   * Deliberately the same shape as `gcpSettings` above, field for field where
   * the two clouds have the same concept, so an operator who has set one up
   * recognises the other. Where AWS calls something by a different name, the
   * field is named the AWS way — `accountId` not `projectId`, `instanceProfile`
   * not `serviceAccount` — because that is the word printed on the AWS console
   * the operator is copying from.
   *
   * Off, in dry run, and with no credentials on a fresh install. Nothing here
   * can spend a cent until all of that is deliberately changed.
   */
  awsSettings: {
    enabled: false,

    /** The 12-digit AWS account number. */
    accountId: '',
    /** Default region, matching infra/aws/live/<env>/env.hcl. */
    region: 'eu-west-1',

    /*
     * The access key the backend authenticates with. Encrypted at rest through
     * cryptoHelper, exactly like the GCP service-account key and for the same
     * reason: it can create and destroy machines that cost money by the hour.
     * Never echoed back to any client.
     */
    accessKeyId: '',
    secretAccessKeyEncrypted: '',

    /* What infra/aws built. The backend launches into these. */
    vpcId: '',
    securityGroupId: '',
    /** Customer subnets keyed by availability zone, from the network module. */
    subnetIds: {},
    /** The role-less profile every customer instance runs as. */
    instanceProfile: '',

    environment: 'staging',

    /** Build nothing; record exactly what would have been built. */
    dryRun: true,
    dryRunRunningAfterSeconds: 45,

    /* Hard ceilings, same meaning as the GCP ones. */
    maxConcurrentInstancesPerTeam: 3,
    maxConcurrentInstancesPlatform: 25,

    enforceMarginGuard: true,

    /**
     * What AWS charges us, per instance type, per hour.
     *
     * The fallback for when live pricing is unavailable — same role as the GCP
     * table. Keyed by instance type: `{ "m5.xlarge": 0.192 }`.
     */
    machineCostPerHour: {},

    requestTimeoutSeconds: 30,
  },

  /**
   * Which cloud a deployment goes to.
   *
   * There is deliberately no list of "active clouds" here — each cloud's own
   * `enabled` switch is the one an operator sees on that cloud's page, and a
   * second list would be a copy to fall out of step with it.
   *
   * All this holds is the tie-breaker: when more than one cloud is on and a
   * model has no assignment of its own, which one wins. With a single cloud on
   * it is not consulted at all, so a platform using one cloud never has to set
   * it. See services/cloud/cloudRouter.js for the full order of precedence.
   */
  cloudRoutingSettings: {
    defaultCloud: '',
  },

  cloudPricingSettings: {
    /** % of the provider's charge, for overheads that scale with the machine. */
    overheadPercent: 0,
    /** A flat per-machine-hour share of what does not scale — NAT, our own servers. */
    overheadPerHour: 0,
    /** Applied to the provider's charge AND the overhead, because both are real spending. */
    taxPercent: 0,
    /** What the platform needs on top of cost. Sets the price floor for a tier. */
    targetMarginPercent: 0,
    /**
     * May this cloud's own price API be asked, per cloud.
     *
     * On by default for both, because a live price is the only one that is
     * certainly current — a recorded table goes stale quietly, and a stale
     * figure that is too low means every machine built on it loses money.
     *
     * Turning one off is for when a provider's prices come back *wrong*: the
     * fallback is then the recorded cost table, without having to disconnect
     * the cloud itself and stop building machines.
     *
     * Not a kill switch for the cloud — that lives on the cloud's own page.
     */
    providers: { gcp: true, aws: true },

    /**
     * May the hourly refresh set a tier's selling price?
     *
     * On: each cell's price is its own cost plus the tier's margin, kept in
     * step with what the clouds charge. Off: the refresh still works out and
     * records what everything costs, but leaves every price alone.
     *
     * The off position is for an operator who wants to set prices by hand and
     * use this only as a cost report. It is deliberately not a kill switch for
     * the refresh itself — knowing what a machine costs must not depend on
     * whether we let the platform act on it.
     */
    autoPriceTiers: true,

    /**
     * The machine counts shown on the region-cost curve.
     *
     * A setting rather than a constant because what counts as a realistic
     * region differs by platform: a few large customers and a long tail of
     * small ones want different points on the curve. Nothing breaks if these
     * change — they only decide which rows the admin screen draws.
     */
    regionCostLadder: [1, 2, 5, 10, 25, 50],

    /**
     * How far below its floor a price may drift before the refresh calls the
     * cell `below_floor` rather than `sellable`.
     *
     * Not zero, because a cent of float would otherwise flip cells in and out
     * of sellable every hour as a provider's published rate moves in its last
     * decimal place — and each flip is a region disappearing from a customer's
     * region picker for no reason they could see.
     */
    floorTolerancePercent: 0.5,
  },
  features: {
    enableCustomerSignup: true,
    enableLogin: true,
    enableModelCatalog: true,
    enableDeployments: true,
    enablePlayground: false,
    enableCustomRoles: true,
    enableActivityLogs: true,
    /**
     * Which languages the customer center offers. Ships English-only, so a
     * platform that never visits the Languages tab behaves exactly as it did
     * before multi-language existed.
     *
     * `enabled` is a subset of the code-level catalogue in
     * `services/i18n/languageSettingsService.js` — that service owns the
     * merging and sanitising of this block, because these defaults are applied
     * only when the settings row is first created, never on read.
     */
    languages: {
      enabled: ['en'],
      default: 'en',
      // The first-login language prompt. Does nothing until the platform has a
      // way to tell what country a visitor is in — see detectCountry() in the
      // customer center.
      firstVisitPromptEnabled: false,
    },
    /**
     * Teams (shared accounts). Merged over its own DEFAULTS on every read by
     * services/team/teamSettingsService.js — see there for what each limit
     * guards against.
     */
    teams: {
      enabled: true,
      maxMembers: 25,
      inviteExpiryDays: 7,
      invitesPerDay: 20,
      maxPendingInvites: 50,
      maxTeamsPerUser: 5,
    },
  },
  googleSSOSettings: {
    enabled: false,
    clientId: '',
    clientSecret: '',
  },
};
