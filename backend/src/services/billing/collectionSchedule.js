/**
 * Collection Schedule
 *
 * Pure date/day-count decisions for jobs/debtCollection.js — kept separate
 * and side-effect-free for the same reason planCharge, decideEndpointAction,
 * evaluateDebtStatus and evaluateFunding are: every "should this fire today"
 * rule can be asserted directly, for every combination of day counts and
 * prior-attempt dates, without a database or the real clock.
 */

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/*
 * ── Why every decision below survives a missed run ──
 *
 * These rules used to assume the job fired every night at exactly 03:00. They
 * asked "is today day 3?" — so if the server was down on day 3, that card
 * retry was simply never made, and a deployment past its grace period was
 * terminated whenever the job next happened to run, with none of the daily
 * warnings in between ever sent. On one real account the job ran on 2 nights
 * out of 28: the debt's four scheduled card attempts produced none, and three
 * deployments were terminated two days late without a single warning.
 *
 * So each rule now asks "what is due and has not been done yet?" rather than
 * "is today the day?". A run that comes late does what the missed run should
 * have done; a run that comes early, or twice, does nothing extra.
 */

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
 * The dunning slot that has most recently come due: the latest of
 * `[0, ...retryDays]` that is not after `debtDays`, or null if none has yet.
 * Day 0 — the day the debt first appeared — is always a slot.
 */
const dueChargeSlot = ({ debtDays, autoChargeRetryDays }) => {
  const slots = [...new Set([0, ...(autoChargeRetryDays || [])].map(Number))]
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  let due = null;
  for (const slot of slots) {
    if (slot <= debtDays) due = slot;
  }
  return due;
};

/**
 * Should debt collection attempt a card charge now?
 *
 * A dunning schedule, not "try every day the debt exists": one attempt per
 * slot (day 0, then each configured retry day), so a declining card is not hit
 * relentlessly. The question is whether the slot that has most recently come
 * due has been attempted yet — not whether today happens to BE that day.
 *
 *   - A run that misses day 3 makes the day-3 attempt on day 4.
 *   - Several missed slots collapse into ONE catch-up attempt, not a burst:
 *     a server back after a week charges once, not three times in an hour.
 *   - Once the last slot has been attempted, nothing more is due, however
 *     long the debt then sits — exactly as the schedule always intended.
 *
 * `lastAutoChargeAt` from an earlier, already-settled debt is older than this
 * debt's `debtSince` and so correctly counts as "not attempted".
 */
const shouldAttemptCharge = ({
  debtSince, lastAutoChargeAt, now, autoChargeRetryDays,
}) => {
  if (!debtSince) return false;
  const slot = dueChargeSlot({ debtDays: daysSince(debtSince, now), autoChargeRetryDays });
  if (slot === null) return false;
  const slotOpened = new Date(debtSince).getTime() + slot * MS_PER_DAY;
  return !lastAutoChargeAt || new Date(lastAutoChargeAt).getTime() < slotOpened;
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
 * When this deployment last stopped running: the first entry of the unbroken
 * run of storage-only statuses at the end of its history. A deployment that
 * flipped paused → running → paused counts from the second pause, because the
 * running stretch in between was billed as compute, not as storage.
 */
const stoppedRunningAt = (statusHistory, storageStatuses) => {
  let since = null;
  const history = statusHistory || [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (!storageStatuses.includes(history[i].status)) break;
    since = history[i].at;
  }
  return since ? new Date(since) : null;
};

/**
 * When this deployment's storage went unpaid — the moment its grace period
 * starts counting.
 *
 * It is the LATER of two things: the account falling into debt, and the
 * deployment stopping. Counting from the account's debt alone (as this used
 * to) is wrong in one direction: an account 20 days into a small pay-as-you-go
 * debt whose owner then stops a machine would have its disk released the very
 * next night, with no grace at all. Counting from the stop alone is wrong in
 * the other: a deployment stopped months ago whose storage only went unpaid
 * today would already be "past" its grace.
 *
 * Null when the account is not in debt at all — a customer who has paid
 * everything owes no storage, whatever the deployment's flag still says.
 */
const storageUnpaidSince = ({ debtSince, statusHistory, storageStatuses }) => {
  if (!debtSince) return null;
  const debt = new Date(debtSince);
  const stopped = stoppedRunningAt(statusHistory, storageStatuses);
  return stopped && stopped > debt ? stopped : debt;
};

/**
 * The least notice a customer gets between being warned and losing a
 * deployment. "A day", less an hour so a job running on the hour does not
 * slip a whole extra hour because the warning was stamped a few seconds
 * after the hour it was sent in.
 */
const FINAL_NOTICE_MS = 23 * MS_PER_HOUR;

/**
 * What this run should do about one stopped deployment with unpaid storage:
 *
 *   'warn'          a routine daily reminder (from `warnDailyFrom` on)
 *   'final_notice'  the grace period is over but this customer has not been
 *                   warned since their storage went unpaid — warn now,
 *                   terminate no sooner than FINAL_NOTICE_MS later
 *   'terminate'     over, and warned at least FINAL_NOTICE_MS ago
 *   'none'          nothing due yet
 *
 * The rule that matters: nothing is terminated without a warning first. The
 * old version could, and did — when the job did not run during the warning
 * days, the first thing the customer heard was that their machine was gone.
 * In the ordinary case nothing changes: the day-15 reminder is a day old by
 * day 16, so termination still lands on day 16.
 */
const storageGraceAction = ({
  unpaidSince, graceDays, warnDailyFrom, lastWarnedAt, now,
}) => {
  if (!unpaidSince) return { action: 'none', elapsedDays: 0, daysLeft: null };

  const elapsedDays = daysSince(unpaidSince, now);
  const daysLeft = Math.max(0, graceDays - elapsedDays);
  // A warning about an earlier stretch of unpaid storage is not a warning
  // about this one.
  const warnedThisTime = !!lastWarnedAt && new Date(lastWarnedAt) >= new Date(unpaidSince);

  if (graceExpired({ debtDays: elapsedDays, graceDays })) {
    if (!warnedThisTime) return { action: 'final_notice', elapsedDays, daysLeft };
    const sinceWarning = now.getTime() - new Date(lastWarnedAt).getTime();
    return { action: sinceWarning >= FINAL_NOTICE_MS ? 'terminate' : 'none', elapsedDays, daysLeft };
  }

  const warn = shouldSendGraceWarningToday({
    debtDays: elapsedDays, warnDailyFrom, lastWarnedAt, now,
  });
  return { action: warn ? 'warn' : 'none', elapsedDays, daysLeft };
};

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
  MS_PER_HOUR,
  MS_PER_DAY,
  FINAL_NOTICE_MS,
  isSameDay,
  daysSince,
  dueChargeSlot,
  shouldAttemptCharge,
  shouldSendGraceWarningToday,
  graceExpired,
  stoppedRunningAt,
  storageUnpaidSince,
  storageGraceAction,
  dueExpiryWarning,
};
