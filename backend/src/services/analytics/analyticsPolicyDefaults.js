/**
 * Every number that decides what an analytics figure *means*, as data.
 *
 * "Dormant after how many days", "low stock at what level", "a ticket is late
 * after how long", "what makes an account at risk and how much does each
 * signal count" — none of these are engineering facts. They are judgements
 * about this business, and the person running the platform will want to change
 * them without anyone touching code. So nothing in the analytics layer may
 * hardcode a threshold, a weight, a band boundary or a customer-visible
 * sentence; if it would otherwise be a magic number in an aggregate, it
 * belongs here.
 *
 * This object is the FALLBACK, not the source of truth. The active
 * `AnalyticsPolicy` row is deep-merged over it, exactly as
 * `recommendation/policyDefaults.js` works — so an operator can override one
 * threshold without restating forty others, and a policy written before a new
 * knob shipped keeps working the day it does.
 *
 * ── The boundary with AdminSettings ──
 *
 * `AdminSettings.analyticsSettings` answers "what are we allowed to record,
 * and for how long" — consent and retention, a privacy decision.
 * `AnalyticsPolicy` (this) answers "what does the recorded number mean" — an
 * interpretation decision. The collector reads the first. The analysers read
 * the second. Neither reads the other.
 */

/*
 * `deepMerge` and `render` are imported rather than re-declared. They are
 * pure and already carry the exact semantics a policy needs (an override wins
 * field-for-field; an unrecognised {placeholder} stays visible rather than
 * silently blanking). A second copy here would be two implementations of one
 * rule, which is precisely how the two drift.
 */
const { deepMerge, render, isPlainObject } = require('../recommendation/policyDefaults');

const DEFAULT_ANALYTICS_POLICY = {
  /* ── Reporting windows ──────────────────────────────────────────────── */
  windows: {
    defaultPeriod: '30d',
    // Offered in the toolbar. Keys must exist in timeWindow.PRESET_DAYS.
    presets: ['7d', '30d', '90d', '1y'],
    /**
     * The calendar every bucket is measured on. UTC by default because the
     * billing job, the seat-fee job and every stored timestamp already are —
     * setting this to the operator's own zone makes the dashboard agree with
     * their working day, at the cost of disagreeing with an invoice by a few
     * hours at the boundary. Their call, deliberately.
     */
    timezone: 'UTC',
    // Clamped, not rejected — the same posture `paginate()` takes on limit.
    maxRangeDays: 730,
  },

  /* ── Caching ────────────────────────────────────────────────────────── */
  // Most figures only move when the hourly billing job runs, so two minutes
  // of staleness costs nothing and saves a table scan per dashboard refresh.
  cacheTtlSeconds: 120,
  // Long windows are far more expensive and far less volatile.
  heavyWindowCacheTtlSeconds: 900,
  heavyWindowDays: 120,

  /* ── Tier capacity and stock ────────────────────────────────────────── */
  capacity: {
    // Percentage of a tier's capacity still free.
    lowStockPercent: 25,
    criticalStockPercent: 10,
    // A tier with capacityTotal = 0 has no declared ceiling; it is reported
    // as "unlimited" rather than as 0% free, which would read as an outage.
    treatZeroCapacityAsUnlimited: true,
    // Change rows are pruned after this; the daily heartbeat rows are kept
    // indefinitely (one row per tier per day is nothing, and they are the
    // long-term stock history).
    eventRetentionDays: 180,
  },

  /* ── Engagement and dormancy ────────────────────────────────────────── */
  engagement: {
    // Bands, in days since the account last did anything that counts.
    activeDays: 7,
    coolingDays: 30,
    dormantDays: 60,
    deepDormantDays: 120,
    /**
     * What "did something" means. Deliberately not just logins: a customer
     * whose deployment has been serving traffic for a month without them
     * signing in is the opposite of churning.
     */
    activitySignals: ['usage', 'login', 'payment', 'deployment'],
  },

  /* ── Customers and organizations ────────────────────────────────────── */
  customers: {
    /**
     * The activation funnel, in order, as data.
     *
     * Each stage is NESTED in the one above it: a customer who was billed also
     * got a deployment running, also requested one, also verified. That is why
     * the order lives here as a list rather than as five hardcoded counts —
     * switching a stage off removes a bar without renumbering the rest, and the
     * drop-off between any two neighbours stays meaningful.
     *
     * `signedUp` cannot be disabled: it is the denominator of everything else.
     */
    activationStages: [
      { key: 'signedUp', label: 'Signed up', enabled: true },
      { key: 'verified', label: 'Verified their email', enabled: true },
      { key: 'requested', label: 'Asked for a deployment', enabled: true },
      { key: 'running', label: 'Got one running', enabled: true },
      { key: 'billed', label: 'Was billed for usage', enabled: true },
    ],
    /**
     * A funnel is right-censored: somebody who signed up yesterday has not
     * failed to deploy, they have not had time to. Below this age the view
     * says so instead of reporting youth as drop-off.
     */
    activationMaturityDays: 7,
    /**
     * Under this many accounts in a window, a percentage is noise dressed as a
     * finding. Views print the raw counts and say the sample is too small
     * rather than a confident-looking rate.
     */
    minSampleForRates: 10,
    // How big our organizations are. First bucket whose `maxMembers` the count
    // does not exceed wins; the last one catches the rest.
    orgSizeBuckets: [
      { key: 'solo', label: 'Owner only', maxMembers: 1 },
      { key: 'small', label: '2–5 people', maxMembers: 5 },
      { key: 'mid', label: '6–15 people', maxMembers: 15 },
      { key: 'large', label: '16–50 people', maxMembers: 50 },
      { key: 'xl', label: 'Over 50', maxMembers: null },
    ],
    /**
     * Which `TeamActivity.action` keys count as somebody arriving in an
     * organization and somebody leaving it. Kept here because the question
     * "does an admin adding a member count as organic growth?" is a judgement,
     * not a fact — and because a new join channel shipped later is one entry
     * here rather than a change in three aggregates.
     */
    memberFlow: {
      joinActions: {
        invite: ['member.joined'],
        link: ['member.joinedByLink'],
        domain: ['member.joinedByDomain'],
        request: ['member.joinApproved'],
        admin: ['member.addedByAdmin'],
      },
      leaveActions: {
        left: ['member.left'],
        removed: ['member.removed'],
        admin: ['member.removedByAdmin'],
      },
    },
  },

  /* ── Retention ──────────────────────────────────────────────────────── */
  retention: {
    cohortGranularity: 'month',
    cohortPeriods: 12,
    // What counts as "retained" in a period.
    retainedBy: 'usage',      // 'usage' | 'login' | 'payment' | 'any'
    // An account that comes back after this long counts as a reactivation
    // rather than as continuous retention.
    reactivationAfterDays: 60,
  },

  /* ── Receivables ────────────────────────────────────────────────────── */
  receivables: {
    // Aging buckets in days since debt began, matching how collections are
    // actually chased rather than a generic 30/60/90.
    agingBuckets: [
      { key: 'current', label: '0–7 days', maxDays: 7 },
      { key: 'week2', label: '8–14 days', maxDays: 14 },
      { key: 'month1', label: '15–30 days', maxDays: 30 },
      { key: 'month2', label: '31–60 days', maxDays: 60 },
      { key: 'aged', label: '60+ days', maxDays: null },
    ],
    // Accounts above this share of total outstanding are flagged as
    // concentration risk on the receivables view.
    concentrationWarnPercent: 20,
  },

  /* ── Support ────────────────────────────────────────────────────────── */
  support: {
    // Minutes. Snapshotted onto each ticket when it opens, so changing a
    // target later does not silently re-grade tickets answered under the old
    // one.
    sla: {
      urgent: { firstResponseMinutes: 30, resolutionMinutes: 240 },
      high: { firstResponseMinutes: 120, resolutionMinutes: 1440 },
      normal: { firstResponseMinutes: 480, resolutionMinutes: 4320 },
      low: { firstResponseMinutes: 1440, resolutionMinutes: 10080 },
    },
    /**
     * The priority a ticket opens at. Must be a key of `sla` above — a
     * default naming a tier that does not exist would open every ticket with
     * no target at all, which reads as "100% within SLA" forever.
     */
    defaultPriority: 'normal',
    /**
     * Display order and wording for the priority control and every chart that
     * groups by it. The keys must match `sla`; anything here that `sla` does
     * not describe is ignored rather than offered as a choice that cannot be
     * graded.
     */
    priorityLabels: {
      urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low',
    },
    // Backlog age pyramid.
    backlogBuckets: [
      { key: 'today', label: 'Under a day', maxHours: 24 },
      { key: 'days', label: '1–3 days', maxHours: 72 },
      { key: 'week', label: '3–7 days', maxHours: 168 },
      { key: 'stale', label: 'Over a week', maxHours: null },
    ],
    // A ticket with no admin message and older than this is "unanswered",
    // which is a different problem from "unresolved".
    unansweredAfterHours: 24,
  },

  /* ── Churn risk ─────────────────────────────────────────────────────── */
  churn: {
    /**
     * Weights are relative, not percentages — they are normalised by their
     * own sum, so adding a signal later does not require re-tuning the rest.
     * A signal set to 0 is switched off without being removed, which keeps
     * historical snapshots readable.
     */
    weights: {
      dormancy: 25,
      noUsage: 20,
      debt: 15,
      walletEmpty: 10,
      paymentFailing: 10,
      deploymentsWoundDown: 10,
      suspended: 15,
      cardExpired: 8,
      openTickets: 5,
      neverActivated: 12,
    },
    // Days/thresholds each signal fires at.
    thresholds: {
      dormantDays: 30,
      noUsageDays: 21,
      noTopUpDays: 45,
      walletBelow: 5,
      minOpenTicketAgeDays: 7,
      autoChargeFailures: 2,
      cardExpiringWithinDays: 30,
    },
    // Score 0–100 → band. First band whose `maxScore` the score does not
    // exceed wins; the last band catches the rest.
    bands: [
      { key: 'healthy', label: 'Healthy', maxScore: 24 },
      { key: 'watch', label: 'Watch', maxScore: 49 },
      { key: 'at_risk', label: 'At risk', maxScore: 74 },
      { key: 'critical', label: 'Critical', maxScore: null },
    ],
    /**
     * The sentence shown against each reason. Templates, not string literals
     * in a scoring function — an operator changes the wording here, and
     * `{placeholders}` are filled with the account's real numbers so the row
     * says WHY, with the figure and the threshold it crossed.
     */
    reasonTemplates: {
      dormancy: 'No sign-in for {days} days (flagged after {threshold})',
      noUsage: 'Nothing deployed or billed for {days} days (flagged after {threshold})',
      // No space between the symbol and the figure — `{currency}` is a symbol
      // ("$"), not a code ("USD"). An operator who prefers "USD 12.00" writes
      // the space back in here, which is the point of these being templates.
      debt: 'Owes {currency}{amount}, unpaid for {days} days',
      walletEmpty: 'Wallet down to {currency}{balance} with no auto top-up',
      paymentFailing: '{failures} failed automatic charges — last error: {error}',
      deploymentsWoundDown: 'Shut down {count} deployments and has none running',
      suspended: 'Suspended by enforcement: {reason}',
      cardExpired: 'Card {brand} ••{last4} {state}',
      openTickets: '{count} support tickets open, oldest {days} days',
      neverActivated: 'Signed up {days} days ago and has never deployed',
    },
    /**
     * Overrides used when the reader may not see money.
     *
     * The churn list is `analytics.view`, but one of its reasons quotes a
     * balance — so a support lead without `analytics.revenue` would read the
     * platform's receivables off a retention screen. Blanking the placeholder
     * would leave "Owes  , unpaid for 40 days"; dropping the reason entirely
     * would hide why the account scored what it did. A second sentence for the
     * same signal keeps both the boundary and the explanation, and stays the
     * operator's wording rather than a string in the source.
     *
     * Only the keys that need a variant appear here; everything else falls
     * through to `reasonTemplates`.
     */
    reasonTemplatesNoMoney: {
      debt: 'Has an unpaid balance, outstanding for {days} days',
      walletEmpty: 'Wallet has run down with no auto top-up',
    },
    // Only accounts scoring at least this are written to the daily snapshot;
    // the healthy majority would otherwise be one row per team per day
    // forever for no question anyone asks.
    snapshotMinScore: 25,
    snapshotRetentionDays: 400,
  },

  /* ── Traffic ────────────────────────────────────────────────────────── */
  traffic: {
    // A session ends after this long with no beacon.
    sessionIdleMinutes: 30,
    // A session with one page view and less than this counts as a bounce.
    bounceMaxSeconds: 10,
    // Beyond this far back, reads come from the daily rollups rather than the
    // raw event table — which is also the only table here that grows without
    // bound.
    rawQueryWindowDays: 14,
    // Collapse high-cardinality paths into groupable patterns. First match
    // wins; `:param` is what appears in reports.
    pathPatternRules: [
      { match: '^/blog/[^/]+$', pattern: '/blog/:slug' },
      { match: '^/models/[^/]+$', pattern: '/models/:slug' },
      { match: '^/deployments/[^/]+$', pattern: '/deployments/:id' },
      { match: '^/invite/[^/]+$', pattern: '/invite/:token' },
      { match: '^/verify-email/[^/]+$', pattern: '/verify-email/:token' },
      { match: '^/support/[^/]+$', pattern: '/support/:id' },
    ],
    // Substring match on a lower-cased user agent.
    botUserAgentPatterns: [
      'bot', 'crawl', 'spider', 'slurp', 'curl', 'wget', 'headless',
      'python-requests', 'axios/', 'postman', 'lighthouse', 'pingdom', 'uptime',
    ],
    // The collector is unauthenticated, so these are load-bearing, not tuning.
    rateLimit: {
      windowSeconds: 60,
      maxRequestsPerIp: 120,
      maxEventsPerRequest: 20,
      maxBodyBytes: 16384,
    },
  },

  /* ── The Dashboard's attention queue ────────────────────────────────── */
  dashboard: {
    /**
     * Which checks run, in what order, and what counts as bad enough to show.
     * Order is the display order: the first thing an operator sees should be
     * the thing that costs most to ignore, which is money already at risk —
     * not the newest chart.
     */
    attention: [
      { key: 'tiersOutOfStock', severity: 'error', enabled: true },
      { key: 'tiersLowStock', severity: 'warning', enabled: true, minFreePercent: 25 },
      { key: 'debtOverLimit', severity: 'error', enabled: true },
      { key: 'debtAging', severity: 'warning', enabled: true, minDays: 30 },
      { key: 'ticketsBreachingSla', severity: 'error', enabled: true },
      { key: 'ticketsUnanswered', severity: 'warning', enabled: true, minHours: 24 },
      { key: 'deploymentsAwaitingReview', severity: 'warning', enabled: true, minHours: 4 },
      { key: 'deploymentsStuckProvisioning', severity: 'error', enabled: true, minHours: 2 },
      { key: 'shutdownsPending', severity: 'warning', enabled: true },
      { key: 'paymentMethodsFailing', severity: 'warning', enabled: true },
      { key: 'churnCritical', severity: 'warning', enabled: true },
      { key: 'jobsFailing', severity: 'error', enabled: true },
      { key: 'disputeHolds', severity: 'error', enabled: true },
    ],
    // How many KPI cards the top row shows before the rest move to Analytics.
    kpiLimit: 6,
    topAccountsLimit: 8,
  },
};

/**
 * Resolve a band from a score, using whatever bands the policy defines.
 * Kept here rather than in the scorer so the band ladder and the band lookup
 * can never disagree about what "critical" means.
 */
const bandForScore = (score, policy = DEFAULT_ANALYTICS_POLICY) => {
  const bands = policy?.churn?.bands || DEFAULT_ANALYTICS_POLICY.churn.bands;
  for (const band of bands) {
    if (band.maxScore === null || band.maxScore === undefined) return band;
    if (Number(score) <= Number(band.maxScore)) return band;
  }
  return bands[bands.length - 1];
};

/** Find the first bucket a value falls into, for aging/backlog ladders. */
const bucketFor = (value, buckets, field) => {
  for (const bucket of buckets || []) {
    const max = bucket[field];
    if (max === null || max === undefined) return bucket;
    if (Number(value) <= Number(max)) return bucket;
  }
  return (buckets || [])[buckets.length - 1] || null;
};

module.exports = {
  DEFAULT_ANALYTICS_POLICY,
  bandForScore,
  bucketFor,
  // Re-exported so analytics modules have one import for policy plumbing.
  deepMerge,
  render,
  isPlainObject,
};
