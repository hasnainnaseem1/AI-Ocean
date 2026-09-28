/**
 * Collection Schedule
 *
 * Pure date/day-count decisions for jobs/debtCollection.js — kept separate
 * and side-effect-free for the same reason planCharge, decideEndpointAction,
 * evaluateDebtStatus and evaluateFunding are: every "should this fire today"
 * rule can be asserted directly, for every combination of day counts and
 * prior-attempt dates, without a database or the real clock.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Same calendar day (UTC), regardless of time of day. */
const isSameDay = (a, b) => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getUTCFullYear() === db.getUTCFullYear()
    && da.getUTCMonth() === db.getUTCMonth()
    && da.getUTCDate() === db.getUTCDate();
};

/** Whole days elapsed since `since`, never negative. */
const daysSince = (since, now) => {
  if (!since) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / MS_PER_DAY));
};

/**
 * Should debt collection attempt a card charge today?
 *
 * Attempts on day 0 (the day the debt first appeared) and again on each
 * configured retry day after that — a dunning schedule, not "try every
 * single day the debt exists", so a declining card is not hit relentlessly.
 * Never fires twice on the same calendar day, whatever this job's own
 * schedule turns out to be.
 */
const shouldAttemptChargeToday = ({ debtDays, lastAutoChargeAt, now, autoChargeRetryDays }) => {
  if (lastAutoChargeAt && isSameDay(lastAutoChargeAt, now)) return false;
  const schedule = [0, ...(autoChargeRetryDays || [])];
  return schedule.includes(debtDays);
};

/** Should today's run send a daily storage-grace reminder? */
const shouldSendGraceWarningToday = ({ debtDays, warnDailyFrom, lastWarnedAt, now }) => {
  if (debtDays < warnDailyFrom) return false;
  if (lastWarnedAt && isSameDay(lastWarnedAt, now)) return false;
  return true;
};

/** Has the storage grace period fully elapsed? */
const graceExpired = ({ debtDays, graceDays }) => debtDays > graceDays;

/**
 * Which card-expiry threshold (if any) is due to fire today, given the
 * platform's configured thresholds and the largest one already warned
 * about. Returns the threshold to warn at, or null if none applies —
 * `warningDays` need not be pre-sorted.
 */
const dueExpiryWarning = ({ daysUntilExpiry, warningDays, lastWarnedDays }) => {
  if (daysUntilExpiry === null || daysUntilExpiry === undefined) return null;

  const sorted = [...(warningDays || [])].sort((a, b) => b - a);
  for (const threshold of sorted) {
    const alreadyWarnedThisOrCloser = lastWarnedDays !== null
      && lastWarnedDays !== undefined
      && lastWarnedDays <= threshold;
    if (daysUntilExpiry <= threshold && !alreadyWarnedThisOrCloser) {
      return threshold;
    }
  }
  return null;
};

module.exports = {
  MS_PER_DAY,
  isSameDay,
  daysSince,
  shouldAttemptChargeToday,
  shouldSendGraceWarningToday,
  graceExpired,
  dueExpiryWarning,
};
