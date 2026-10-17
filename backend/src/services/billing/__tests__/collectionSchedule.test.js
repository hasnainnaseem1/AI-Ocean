/**
 * Tests for the debt-collection scheduling decisions — should a card charge
 * be attempted today, should a storage-grace reminder go out today, has the
 * grace period run out, and which card-expiry threshold (if any) is due.
 *
 * All four are pure by construction, the same as every other decision this
 * billing system makes: given the day counts and prior-attempt dates, every
 * combination can be asserted directly, without a database or a real clock.
 *
 * Run with:  node --test src/services/billing/__tests__/collectionSchedule.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  isSameDay, daysSince, dueChargeSlot, shouldAttemptCharge, shouldSendGraceWarningToday,
  graceExpired, stoppedRunningAt, storageUnpaidSince, storageGraceAction, dueExpiryWarning,
  MS_PER_HOUR,
} = require('../collectionSchedule');

const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)); // day 0 = 2026-01-01 UTC
const at = (d, h) => new Date(day(d).getTime() + h * MS_PER_HOUR);
const STORAGE = ['paused', 'stopped'];
const RETRY = [1, 3, 5];

/* ── isSameDay / daysSince — the building blocks everything else uses ───── */

test('isSameDay is true for the same UTC calendar day, false for adjacent ones', () => {
  assert.strictEqual(isSameDay(day(5), day(5)), true);
  assert.strictEqual(isSameDay(day(5), day(6)), false);
  assert.strictEqual(isSameDay(null, day(5)), false);
});

test('daysSince counts whole days and is never negative', () => {
  assert.strictEqual(daysSince(day(0), day(5)), 5);
  assert.strictEqual(daysSince(day(5), day(0)), 0, 'a "since" in the future never goes negative');
  assert.strictEqual(daysSince(null, day(5)), 0, 'no start date at all means zero days');
});

/* ── Card charge attempts: a dunning schedule, not "try every day" ───────── */

const charge = (now, lastAutoChargeAt, retry = RETRY) => shouldAttemptCharge({
  debtSince: day(0), lastAutoChargeAt, now, autoChargeRetryDays: retry,
});

test('the due slot is the latest of [0, ...retryDays] that has arrived', () => {
  assert.strictEqual(dueChargeSlot({ debtDays: 0, autoChargeRetryDays: RETRY }), 0);
  assert.strictEqual(dueChargeSlot({ debtDays: 2, autoChargeRetryDays: RETRY }), 1);
  assert.strictEqual(dueChargeSlot({ debtDays: 4, autoChargeRetryDays: RETRY }), 3);
  assert.strictEqual(dueChargeSlot({ debtDays: 40, autoChargeRetryDays: RETRY }), 5);
  assert.strictEqual(dueChargeSlot({ debtDays: 4, autoChargeRetryDays: [5, 1, 3, 3] }), 3,
    'unsorted and duplicated retry days are handled');
});

test('an attempt is due on day 0 — the day debt first appears', () => {
  assert.strictEqual(charge(at(0, 2), null), true);
});

test('an attempt is due on each configured retry day', () => {
  for (const d of RETRY) {
    // The previous slot was attempted, this one not yet.
    assert.strictEqual(charge(at(d, 1), at(d - 1, 12)), true, `day ${d} should be due`);
  }
});

test('nothing is due between slots once the current slot has been attempted', () => {
  assert.strictEqual(charge(at(2, 9), at(1, 3)), false, 'day 2 sits in slot 1, already tried');
});

test('one attempt per slot, however often the job runs', () => {
  // Hourly runs through day 1: tried at 01:00, so 02:00 … 23:00 do nothing.
  for (let h = 2; h < 24; h += 1) {
    assert.strictEqual(charge(at(1, h), at(1, 1)), false, `hour ${h} must not retry`);
  }
});

test('a MISSED retry day is made up on the next run, not lost', () => {
  // Day 3 was missed entirely; the day-1 attempt is the last one made.
  assert.strictEqual(charge(at(4, 0), at(1, 3)), true, 'the day-3 attempt happens on day 4');
});

test('several missed slots collapse into ONE catch-up attempt, not a burst', () => {
  // Down from day 0 until day 6: one attempt now ...
  assert.strictEqual(charge(at(6, 0), null), true);
  // ... and none an hour later — slots 0, 1 and 3 are not replayed.
  assert.strictEqual(charge(at(6, 1), at(6, 0)), false);
});

test('once the last slot has been attempted, nothing more is ever due', () => {
  assert.strictEqual(charge(at(30, 0), at(5, 2)), false);
});

test('an attempt on an EARLIER, settled debt does not count against this one', () => {
  // The account's last attempt was before this debt existed.
  assert.strictEqual(shouldAttemptCharge({
    debtSince: day(10), lastAutoChargeAt: day(3), now: at(10, 4), autoChargeRetryDays: RETRY,
  }), true);
});

test('no debt, no attempt', () => {
  assert.strictEqual(shouldAttemptCharge({
    debtSince: null, lastAutoChargeAt: null, now: day(3), autoChargeRetryDays: RETRY,
  }), false);
});

test('an empty retry schedule still attempts once, on day 0, and never again', () => {
  assert.strictEqual(charge(at(0, 1), null, []), true);
  assert.strictEqual(charge(at(1, 1), at(0, 1), []), false);
});

/*
 * The account that found this. Debt began 20 Sep 13:30 UTC; the 03:00-PKT job
 * (22:00 UTC) ran on none of days 0, 1, 3 or 5. Under the old exact-day rule
 * the first run after that — 8 Oct — found nothing due. Under this one, the
 * first run that happens makes the attempt.
 */
test('regression: a debt whose every retry night was missed still gets an attempt', () => {
  const debtSince = new Date('2026-09-20T13:30:00Z');
  assert.strictEqual(shouldAttemptCharge({
    debtSince,
    // The previous debt's attempt, before this debt existed.
    lastAutoChargeAt: new Date('2026-09-14T10:48:33Z'),
    now: new Date('2026-10-08T22:00:00Z'),
    autoChargeRetryDays: RETRY,
  }), true);
});

/* ── Storage grace: daily reminders, once per calendar day ───────────────── */

test('no warning before the configured "warn from" day', () => {
  const due = shouldSendGraceWarningToday({
    debtDays: 0, warnDailyFrom: 1, lastWarnedAt: null, now: day(0),
  });
  assert.strictEqual(due, false);
});

test('a warning is due once the "warn from" day is reached', () => {
  const due = shouldSendGraceWarningToday({
    debtDays: 1, warnDailyFrom: 1, lastWarnedAt: null, now: day(1),
  });
  assert.strictEqual(due, true);
});

test('a warning already sent today is not sent again', () => {
  const due = shouldSendGraceWarningToday({
    debtDays: 3, warnDailyFrom: 1, lastWarnedAt: day(3), now: day(3),
  });
  assert.strictEqual(due, false);
});

test('a warning sent yesterday does not block a fresh one today', () => {
  const due = shouldSendGraceWarningToday({
    debtDays: 4, warnDailyFrom: 1, lastWarnedAt: day(3), now: day(4),
  });
  assert.strictEqual(due, true);
});

/* ── Grace expiry: strictly "more than", not "at least" ──────────────────── */

test('exactly at the grace period is not yet expired', () => {
  assert.strictEqual(graceExpired({ debtDays: 7, graceDays: 7 }), false);
});

test('one day past the grace period is expired', () => {
  assert.strictEqual(graceExpired({ debtDays: 8, graceDays: 7 }), true);
});

test('well within the grace period is not expired', () => {
  assert.strictEqual(graceExpired({ debtDays: 1, graceDays: 7 }), false);
});

/* ── When storage went unpaid: the grace period's real start ─────────────── */

const hist = (...entries) => entries.map(([status, d]) => ({ status, at: d }));

test('stoppedRunningAt is the start of the trailing run of storage statuses', () => {
  const h = hist(['running', day(0)], ['paused', day(2)], ['running', day(3)], ['paused', day(5)], ['stopped', day(6)]);
  assert.deepStrictEqual(stoppedRunningAt(h, STORAGE), day(5),
    'the pause before the last resume does not count — that stretch was billed as compute');
  assert.strictEqual(stoppedRunningAt(hist(['running', day(0)]), STORAGE), null, 'still running');
});

test('unpaid storage starts at the LATER of the debt and the stop', () => {
  const stoppedDay5 = hist(['running', day(0)], ['paused', day(5)]);
  assert.deepStrictEqual(storageUnpaidSince({ debtSince: day(1), statusHistory: stoppedDay5, storageStatuses: STORAGE }),
    day(5), 'in debt since day 1, stopped day 5: grace starts day 5, not day 1');
  assert.deepStrictEqual(storageUnpaidSince({ debtSince: day(9), statusHistory: stoppedDay5, storageStatuses: STORAGE }),
    day(9), 'stopped day 5, in debt from day 9: grace starts day 9');
});

test('a paid-up account has no unpaid storage, whatever the deployment flag says', () => {
  assert.strictEqual(storageUnpaidSince({
    debtSince: null, statusHistory: hist(['paused', day(0)]), storageStatuses: STORAGE,
  }), null);
});

test('regression: a long-running debt does not erase the grace of a deployment stopped today', () => {
  // 20 days of small pay-as-you-go debt, then the owner stops a machine. The
  // old rule counted from the debt and would have released the disk tonight.
  const unpaidSince = storageUnpaidSince({
    debtSince: day(0), statusHistory: hist(['running', day(0)], ['stopped', day(20)]), storageStatuses: STORAGE,
  });
  const { action } = storageGraceAction({
    unpaidSince, graceDays: 15, warnDailyFrom: 5, lastWarnedAt: null, now: at(20, 22),
  });
  assert.strictEqual(action, 'none');
});

/* ── The grace decision: warn, give notice, then — and only then — terminate ─ */

const grace = (now, lastWarnedAt, unpaidSince = day(0)) => storageGraceAction({
  unpaidSince, graceDays: 15, warnDailyFrom: 5, lastWarnedAt, now,
}).action;

test('no reminder before the "warn from" day, then one a day', () => {
  assert.strictEqual(grace(at(4, 1), null), 'none');
  assert.strictEqual(grace(at(5, 1), null), 'warn');
  assert.strictEqual(grace(at(5, 9), at(5, 1)), 'none', 'already reminded today');
  assert.strictEqual(grace(at(6, 1), at(5, 1)), 'warn');
});

test('the ordinary case is unchanged: warned on day 15, terminated on day 16', () => {
  assert.strictEqual(grace(at(15, 0), at(14, 0)), 'warn');
  assert.strictEqual(grace(at(15, 23), at(15, 0)), 'none', 'day 15 is not past a 15-day grace');
  assert.strictEqual(grace(at(16, 0), at(15, 0)), 'terminate');
});

test('never terminated without a warning: an unwarned expiry gets a final notice first', () => {
  assert.strictEqual(grace(at(18, 0), null), 'final_notice');
});

test('after a final notice, termination waits roughly a day', () => {
  assert.strictEqual(grace(at(18, 10), at(18, 0)), 'none', '10 hours is not enough notice');
  assert.strictEqual(grace(at(18, 22), at(18, 0)), 'none', '22 hours is not enough notice');
  assert.strictEqual(grace(at(18, 23), at(18, 0)), 'terminate', 'a day, less the hour the job runs on');
});

test('a warning about an EARLIER stretch of unpaid storage does not count as notice', () => {
  // Warned on day 3 about a previous episode; this one began on day 4.
  assert.strictEqual(grace(at(20, 0), day(3), day(4)), 'final_notice');
});

/*
 * The account that found this: storage unpaid from 21 Sep 13:00 UTC (paused
 * the day after the debt began), 15-day grace, the job ran on 8 Oct with no
 * warning ever sent. It was terminated on the spot; it now gets a final notice.
 */
test('regression: the first run after a fully missed grace period warns, it does not terminate', () => {
  const unpaidSince = storageUnpaidSince({
    debtSince: new Date('2026-09-20T13:30:00Z'),
    statusHistory: hist(['running', new Date('2026-09-18T15:29:28Z')], ['paused', new Date('2026-09-21T13:00:00Z')]),
    storageStatuses: STORAGE,
  });
  assert.deepStrictEqual(unpaidSince, new Date('2026-09-21T13:00:00Z'));
  const { action } = storageGraceAction({
    unpaidSince, graceDays: 15, warnDailyFrom: 5, lastWarnedAt: null, now: new Date('2026-10-08T22:00:00Z'),
  });
  assert.strictEqual(action, 'final_notice');
});

/* ── Card expiry: successive, more urgent thresholds as expiry approaches ── */

test('no warning is due when expiry is further away than every configured threshold', () => {
  const t = dueExpiryWarning({ daysUntilExpiry: 90, warningDays: [30, 14, 7], lastWarnedDays: null });
  assert.strictEqual(t, null);
});

test('the largest threshold crossed fires first', () => {
  const t = dueExpiryWarning({ daysUntilExpiry: 25, warningDays: [30, 14, 7], lastWarnedDays: null });
  assert.strictEqual(t, 30);
});

test('having already warned at 30 does not repeat 30, but 14 fires when reached', () => {
  const t = dueExpiryWarning({ daysUntilExpiry: 12, warningDays: [30, 14, 7], lastWarnedDays: 30 });
  assert.strictEqual(t, 14);
});

test('having already warned at 14 does not re-fire 14 or 30 again', () => {
  const t = dueExpiryWarning({ daysUntilExpiry: 13, warningDays: [30, 14, 7], lastWarnedDays: 14 });
  assert.strictEqual(t, null);
});

test('the closest, most urgent threshold (7) still fires after 14 was already warned', () => {
  const t = dueExpiryWarning({ daysUntilExpiry: 5, warningDays: [30, 14, 7], lastWarnedDays: 14 });
  assert.strictEqual(t, 7);
});

test('unordered warningDays input is handled the same as sorted input', () => {
  const t = dueExpiryWarning({ daysUntilExpiry: 25, warningDays: [7, 30, 14], lastWarnedDays: null });
  assert.strictEqual(t, 30);
});

test('no expiry date at all never warns', () => {
  assert.strictEqual(dueExpiryWarning({ daysUntilExpiry: null, warningDays: [30, 14, 7], lastWarnedDays: null }), null);
  assert.strictEqual(dueExpiryWarning({ daysUntilExpiry: undefined, warningDays: [30, 14, 7], lastWarnedDays: null }), null);
});
