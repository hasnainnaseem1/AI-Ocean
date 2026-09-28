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
  analyticsSettings: {
    enableTracking: true,
    dataRetentionDays: 90,
  },
  notificationSettings: {
    enableEmailNotifications: true,
    enablePushNotifications: false,
    notifyAdminOnNewcustomer: true,
    notifyAdminOnAutoSuspend: true,
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
