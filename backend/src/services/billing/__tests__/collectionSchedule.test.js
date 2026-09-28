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
  isSameDay, daysSince, shouldAttemptChargeToday, shouldSendGraceWarningToday,
  graceExpired, dueExpiryWarning,
} = require('../collectionSchedule');

const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)); // day 0 = 2026-01-01 UTC

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

test('an attempt is due on day 0 — the day debt first appears', () => {
  const due = shouldAttemptChargeToday({
    debtDays: 0, lastAutoChargeAt: null, now: day(0), autoChargeRetryDays: [1, 3, 5],
  });
  assert.strictEqual(due, true);
});

test('no attempt is due on a day that is not in the schedule', () => {
  const due = shouldAttemptChargeToday({
    debtDays: 2, lastAutoChargeAt: null, now: day(2), autoChargeRetryDays: [1, 3, 5],
  });
  assert.strictEqual(due, false);
});

test('an attempt is due on each configured retry day', () => {
  for (const d of [1, 3, 5]) {
    const due = shouldAttemptChargeToday({
      debtDays: d, lastAutoChargeAt: null, now: day(d), autoChargeRetryDays: [1, 3, 5],
    });
    assert.strictEqual(due, true, `day ${d} should be due`);
  }
});

test('an attempt already made today is not repeated, even if today is a scheduled day', () => {
  const due = shouldAttemptChargeToday({
    debtDays: 1, lastAutoChargeAt: day(1), now: day(1), autoChargeRetryDays: [1, 3, 5],
  });
  assert.strictEqual(due, false);
});

test('an attempt made yesterday does not block a scheduled attempt today', () => {
  const due = shouldAttemptChargeToday({
    debtDays: 3, lastAutoChargeAt: day(2), now: day(3), autoChargeRetryDays: [1, 3, 5],
  });
  assert.strictEqual(due, true);
});

test('an empty retry schedule still attempts once, on day 0', () => {
  const dueDay0 = shouldAttemptChargeToday({
    debtDays: 0, lastAutoChargeAt: null, now: day(0), autoChargeRetryDays: [],
  });
  const dueDay1 = shouldAttemptChargeToday({
    debtDays: 1, lastAutoChargeAt: null, now: day(1), autoChargeRetryDays: [],
  });
  assert.strictEqual(dueDay0, true);
  assert.strictEqual(dueDay1, false, 'with no configured retries, only day 0 is ever due');
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
