/**
 * Tests for the debt-limit decision — whether a customer's unpaid
 * pay-as-you-go balance has gone far enough that PAYG usage should be
 * blocked.
 *
 * `evaluateDebtStatus` is pure by construction, the same way `planCharge`
 * (deploymentBilling.js) and `decideEndpointAction` (endpointService.js) are:
 * it takes the numbers and returns a decision, with no database involved —
 * so every combination of debt size, debt age and limit can be asserted
 * directly.
 *
 * Run with:  node --test src/services/billing/__tests__/debtService.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { evaluateDebtStatus } = require('../debtService');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

test('no debt at all is never blocked, regardless of stale debtSince', () => {
  const p = evaluateDebtStatus({
    outstanding: 0, debtSince: daysAgo(365), now: new Date(), creditLimit: 10, maxDebtDays: 1,
  });
  assert.strictEqual(p.outstanding, 0);
  assert.strictEqual(p.debtDays, 0);
  assert.strictEqual(p.blocked, false);
  assert.strictEqual(p.reason, null);
});

test('debt within both limits is not blocked', () => {
  const p = evaluateDebtStatus({
    outstanding: 20, debtSince: daysAgo(2), now: new Date(), creditLimit: 50, maxDebtDays: 7,
  });
  assert.strictEqual(p.blocked, false);
  assert.strictEqual(p.overCreditLimit, false);
  assert.strictEqual(p.overDayLimit, false);
  assert.strictEqual(p.debtDays, 2);
});

test('debt over the credit limit is blocked even if it is brand new', () => {
  const p = evaluateDebtStatus({
    outstanding: 51, debtSince: new Date(), now: new Date(), creditLimit: 50, maxDebtDays: 7,
  });
  assert.strictEqual(p.overCreditLimit, true);
  assert.strictEqual(p.overDayLimit, false);
  assert.strictEqual(p.blocked, true);
  assert.strictEqual(p.reason, 'CREDIT_LIMIT_EXCEEDED');
});

test('debt older than the day limit is blocked even if it is tiny', () => {
  const p = evaluateDebtStatus({
    outstanding: 0.5, debtSince: daysAgo(10), now: new Date(), creditLimit: 50, maxDebtDays: 7,
  });
  assert.strictEqual(p.overCreditLimit, false);
  assert.strictEqual(p.overDayLimit, true);
  assert.strictEqual(p.blocked, true);
  assert.strictEqual(p.reason, 'DEBT_TOO_OLD');
});

test('exactly at the credit limit is not over it — over means strictly more', () => {
  const p = evaluateDebtStatus({
    outstanding: 50, debtSince: daysAgo(1), now: new Date(), creditLimit: 50, maxDebtDays: 7,
  });
  assert.strictEqual(p.overCreditLimit, false);
  assert.strictEqual(p.blocked, false);
});

test('exactly at the day limit is not over it — over means strictly more', () => {
  const p = evaluateDebtStatus({
    outstanding: 10, debtSince: daysAgo(7), now: new Date(), creditLimit: 50, maxDebtDays: 7,
  });
  assert.strictEqual(p.overDayLimit, false);
  assert.strictEqual(p.blocked, false);
});

test('one day and one cent past either limit blocks', () => {
  const overDay = evaluateDebtStatus({
    outstanding: 10, debtSince: daysAgo(8), now: new Date(), creditLimit: 50, maxDebtDays: 7,
  });
  assert.strictEqual(overDay.blocked, true);

  const overCredit = evaluateDebtStatus({
    outstanding: 50.01, debtSince: daysAgo(1), now: new Date(), creditLimit: 50, maxDebtDays: 7,
  });
  assert.strictEqual(overCredit.blocked, true);
});

test('a credit limit of 0 means no limit on that dimension — only the day limit can block', () => {
  const p = evaluateDebtStatus({
    outstanding: 999999, debtSince: daysAgo(1), now: new Date(), creditLimit: 0, maxDebtDays: 7,
  });
  assert.strictEqual(p.overCreditLimit, false);
  assert.strictEqual(p.blocked, false);
});

test('a day limit of 0 means no limit on that dimension — only the credit limit can block', () => {
  const p = evaluateDebtStatus({
    outstanding: 10, debtSince: daysAgo(9999), now: new Date(), creditLimit: 50, maxDebtDays: 0,
  });
  assert.strictEqual(p.overDayLimit, false);
  assert.strictEqual(p.blocked, false);
});

test('both limits at 0 means debt never blocks, no matter how large or old', () => {
  const p = evaluateDebtStatus({
    outstanding: 100000, debtSince: daysAgo(9999), now: new Date(), creditLimit: 0, maxDebtDays: 0,
  });
  assert.strictEqual(p.blocked, false);
  assert.strictEqual(p.reason, null);
});

test('breaching both limits at once still names the credit limit — an honest, deterministic tiebreak', () => {
  const p = evaluateDebtStatus({
    outstanding: 100, debtSince: daysAgo(30), now: new Date(), creditLimit: 50, maxDebtDays: 7,
  });
  assert.strictEqual(p.overCreditLimit, true);
  assert.strictEqual(p.overDayLimit, true);
  assert.strictEqual(p.blocked, true);
  assert.strictEqual(p.reason, 'CREDIT_LIMIT_EXCEEDED');
});

test('debtDays is a whole number of full days, not a fraction', () => {
  const p = evaluateDebtStatus({
    outstanding: 5,
    debtSince: new Date(Date.now() - 2.9 * 24 * 60 * 60 * 1000),
    now: new Date(),
    creditLimit: 50,
    maxDebtDays: 7,
  });
  assert.strictEqual(p.debtDays, 2, 'a partial third day has not completed yet');
});
