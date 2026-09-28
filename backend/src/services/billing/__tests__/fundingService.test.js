/**
 * Tests for the funding decision — can a deployment actually go live right
 * now, given outstanding debt, the card gate and wallet runway?
 *
 * `evaluateFunding` is pure by construction, the same way `planCharge`,
 * `decideEndpointAction` and `evaluateDebtStatus` are: every input is a
 * plain, already-resolved value, so every combination can be asserted
 * directly without a database, four call sites, or a cron job.
 *
 * Run with:  node --test src/services/billing/__tests__/fundingService.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { evaluateFunding, evaluatePaygEligibility, resolvePaygAccess } = require('../fundingService');

const base = (over = {}) => ({
  debtBlocked: false,
  debtReason: null,
  requireVerifiedCard: false,
  hasVerifiedCard: true,
  balance: 100,
  requiredBalance: 10,
  ...over,
});

/* ── Debt blocks first, before the card gate or balance ──── */

test('blocked debt refuses funding even with plenty of balance', () => {
  const p = evaluateFunding(base({ debtBlocked: true, debtReason: 'CREDIT_LIMIT_EXCEEDED', balance: 10000 }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'DEBT_LIMIT_EXCEEDED');
});

test('debt blocked for being too old reports the day-limit code, not the credit-limit one', () => {
  const p = evaluateFunding(base({ debtBlocked: true, debtReason: 'DEBT_TOO_OLD' }));
  assert.strictEqual(p.code, 'DEBT_TOO_OLD');
});

test('unblocked debt (small, recent) does not refuse funding by itself', () => {
  const p = evaluateFunding(base({ debtBlocked: false }));
  assert.strictEqual(p.ok, true);
});

/* ── The card gate ────────────────────────────────────────────────────────── */

test('a missing card refuses funding when the gate requires one', () => {
  const p = evaluateFunding(base({ requireVerifiedCard: true, hasVerifiedCard: false }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'CARD_REQUIRED');
});

test('a verified card satisfies the gate', () => {
  const p = evaluateFunding(base({ requireVerifiedCard: true, hasVerifiedCard: true }));
  assert.strictEqual(p.ok, true);
});

test('the card gate does nothing at all when it is turned off', () => {
  const p = evaluateFunding(base({ requireVerifiedCard: false, hasVerifiedCard: false }));
  assert.strictEqual(p.ok, true, 'no card, but the gate is off, so this is not a reason to refuse');
});

/* ── Balance / runway — the original order-time check, now everywhere ───── */

test('balance below the required runway refuses funding with the exact shortfall', () => {
  const p = evaluateFunding(base({ balance: 6, requiredBalance: 10 }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'INSUFFICIENT_CREDIT');
  assert.ok(Math.abs(p.shortfall - 4) < 0.0001, 'shortfall should be exactly 4: ' + p.shortfall);
});

test('balance exactly at the required runway is funded — the bar is "at least", not "more than"', () => {
  const p = evaluateFunding(base({ balance: 10, requiredBalance: 10 }));
  assert.strictEqual(p.ok, true);
});

test('balance above the required runway is funded with zero shortfall', () => {
  const p = evaluateFunding(base({ balance: 50, requiredBalance: 10 }));
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.shortfall, 0);
});

/* ── Order of checks: each gate is independent and checked before balance ── */

test('debt blocks before the balance check ever runs, even with an exact-match balance', () => {
  const p = evaluateFunding(base({
    debtBlocked: true, debtReason: 'CREDIT_LIMIT_EXCEEDED', balance: 10, requiredBalance: 10,
  }));
  assert.strictEqual(p.code, 'DEBT_LIMIT_EXCEEDED');
});

test('the card gate blocks before the balance check, even with plenty of balance', () => {
  const p = evaluateFunding(base({
    requireVerifiedCard: true, hasVerifiedCard: false, balance: 10000, requiredBalance: 1,
  }));
  assert.strictEqual(p.code, 'CARD_REQUIRED');
});

test('a fully healthy account is funded with no code and no reason', () => {
  const p = evaluateFunding(base());
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.code, null);
  assert.strictEqual(p.reason, null);
  assert.strictEqual(p.shortfall, 0);
});

/* ── Pay-as-you-go: no pre-funded runway required — that's the whole offer ── */

test('pay-as-you-go with an empty wallet and a huge required balance is still funded', () => {
  const p = evaluateFunding(base({ billingMethod: 'payg', balance: 0, requiredBalance: 9999 }));
  assert.strictEqual(p.ok, true, 'pay-as-you-go does not need pre-funded runway at all');
});

test('prepaid (the default) still needs the runway — payg is the only exception', () => {
  const p = evaluateFunding(base({ balance: 0, requiredBalance: 9999 }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'INSUFFICIENT_CREDIT');
});

test('pay-as-you-go still blocks on debt — skipping the runway check is not a blanket bypass', () => {
  const p = evaluateFunding(base({
    billingMethod: 'payg', debtBlocked: true, debtReason: 'CREDIT_LIMIT_EXCEEDED', balance: 0, requiredBalance: 9999,
  }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'DEBT_LIMIT_EXCEEDED');
});

test('pay-as-you-go still needs the card when the gate requires one', () => {
  const p = evaluateFunding(base({
    billingMethod: 'payg', requireVerifiedCard: true, hasVerifiedCard: false, balance: 0, requiredBalance: 9999,
  }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'CARD_REQUIRED');
});

/* ── A dispute hold overrides everything ────────────────── */

test('a dispute hold blocks funding even with a perfectly healthy wallet', () => {
  const p = evaluateFunding(base({ disputeHold: true, balance: 10000, requiredBalance: 1 }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'DISPUTE_HOLD');
});

test('a dispute hold blocks pay-as-you-go too — it is not just a runway bypass', () => {
  const p = evaluateFunding(base({ billingMethod: 'payg', disputeHold: true, balance: 0, requiredBalance: 9999 }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'DISPUTE_HOLD');
});

test('no dispute hold (the default) does not block anything by itself', () => {
  const p = evaluateFunding(base());
  assert.strictEqual(p.ok, true);
});

/* ── PAYG eligibility: an extra bar on top of the card gate ──────────────── */

test('paygEligible defaults to true — prepaid and every existing caller is unaffected', () => {
  const p = evaluateFunding(base({ billingMethod: 'payg', balance: 0, requiredBalance: 9999 }));
  assert.strictEqual(p.ok, true);
});

test('an ineligible account is refused pay-as-you-go even with a healthy wallet and a card', () => {
  const p = evaluateFunding(base({
    billingMethod: 'payg', paygEligible: false, paygEligibleReason: 'MIN_SPEND_NOT_MET',
    balance: 10000, requiredBalance: 1,
  }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'PAYG_NOT_ELIGIBLE');
});

test('paygEligible: false is ignored for prepaid — the bar only applies to payg', () => {
  const p = evaluateFunding(base({ billingMethod: 'prepaid', paygEligible: false }));
  assert.strictEqual(p.ok, true);
});

test('the card gate and dispute hold still take priority over PAYG ineligibility', () => {
  const p = evaluateFunding(base({
    billingMethod: 'payg', paygEligible: false, requireVerifiedCard: true, hasVerifiedCard: false,
  }));
  assert.strictEqual(p.code, 'CARD_REQUIRED');
});

test('evaluatePaygEligibility: both thresholds at zero means everyone qualifies', () => {
  const e = evaluatePaygEligibility({ lifetimeSpend: 0, accountAgeDays: 0, minLifetimeSpend: 0, minAccountAgeDays: 0 });
  assert.strictEqual(e.eligible, true);
});

test('evaluatePaygEligibility: under the spend bar is ineligible, even with plenty of account age', () => {
  const e = evaluatePaygEligibility({ lifetimeSpend: 5, accountAgeDays: 999, minLifetimeSpend: 50, minAccountAgeDays: 0 });
  assert.strictEqual(e.eligible, false);
  assert.strictEqual(e.reason, 'MIN_SPEND_NOT_MET');
});

test('evaluatePaygEligibility: under the age bar is ineligible, even with plenty of spend', () => {
  const e = evaluatePaygEligibility({ lifetimeSpend: 999, accountAgeDays: 1, minLifetimeSpend: 0, minAccountAgeDays: 30 });
  assert.strictEqual(e.eligible, false);
  assert.strictEqual(e.reason, 'MIN_AGE_NOT_MET');
});

test('evaluatePaygEligibility: exactly at both bars qualifies — "at least", not "more than"', () => {
  const e = evaluatePaygEligibility({ lifetimeSpend: 50, accountAgeDays: 30, minLifetimeSpend: 50, minAccountAgeDays: 30 });
  assert.strictEqual(e.eligible, true);
});

/* ── Prepaid has to be square before it starts again ───────────────────────
 *
 * The rule the platform actually runs on: a prepaid deployment whose wallet
 * ran out is stopped, its disk keeps billing onto the outstanding balance, and
 * the customer gets back in one of two ways. Top up — which pays the storage
 * off first — or move the deployment to pay-as-you-go, which is allowed to
 * carry a balance. What must never happen is restarting a prepaid deployment
 * on money that was already owed.
 */
const square = (over) => ({
  debtBlocked: false, requireVerifiedCard: false, hasVerifiedCard: true,
  balance: 1000, requiredBalance: 0, outstanding: 0, ...over,
});

test('prepaid cannot start while any outstanding balance remains', () => {
  const p = evaluateFunding(square({ outstanding: 4.2 }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'SETTLE_OUTSTANDING');
  assert.strictEqual(p.shortfall, 4.2, 'the customer is told exactly what to clear');
});

test('a partial top-up that does not clear the storage bill still refuses', () => {
  // Plenty of balance is not the point — the debt is what is in the way, and
  // this is exactly the case the old `debtBlocked` check let through, because
  // a small debt is nowhere near the platform's limit.
  const p = evaluateFunding(square({ outstanding: 0.5, balance: 500 }));
  assert.strictEqual(p.code, 'SETTLE_OUTSTANDING');
});

test('pay-as-you-go is never blocked by carrying a balance — that is the offer', () => {
  const p = evaluateFunding(square({ outstanding: 4.2, billingMethod: 'payg' }));
  assert.strictEqual(p.ok, true, 'payg is gated on the card and the debt limit, not on owing anything at all');
});

test('once the outstanding balance is cleared, prepaid runs again', () => {
  const p = evaluateFunding(square({ outstanding: 0 }));
  assert.strictEqual(p.ok, true);
});

test('the debt check runs before the runway check, so the customer is told the real problem', () => {
  // Both are wrong here. Being told "add more credit" when the actual blocker
  // is an unpaid bill sends them round a loop that never resolves.
  const p = evaluateFunding(square({ outstanding: 3, balance: 0, requiredBalance: 50 }));
  assert.strictEqual(p.code, 'SETTLE_OUTSTANDING');
});

test('a declined card is refused the same as no card at all', () => {
  // check() flips hasVerifiedCard to false when the live authorisation fails,
  // so the pure decision needs no separate branch — this pins that contract.
  const p = evaluateFunding(square({ requireVerifiedCard: true, hasVerifiedCard: false }));
  assert.strictEqual(p.code, 'CARD_REQUIRED');
});

/* ── Per-customer pay-as-you-go access ──────────────────── */

const on = { payg: { enabled: true } };
const off = { payg: { enabled: false } };

test('a customer on the default follows the platform switch', () => {
  assert.strictEqual(resolvePaygAccess({ paygAccess: 'default' }, on).available, true);
  const shut = resolvePaygAccess({ paygAccess: 'default' }, off);
  assert.strictEqual(shut.available, false);
  assert.strictEqual(shut.reason, 'PLATFORM_DISABLED');
});

test('a row written before the column existed counts as the default', () => {
  assert.strictEqual(resolvePaygAccess({}, on).available, true);
  assert.strictEqual(resolvePaygAccess({}, off).available, false);
  assert.strictEqual(resolvePaygAccess(null, off).available, false);
});

test('an allowed customer keeps PAYG while it is off for everyone else', () => {
  const r = resolvePaygAccess({ paygAccess: 'allowed' }, off);
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.source, 'customer');
});

test('a blocked customer loses PAYG while it is on for everyone else', () => {
  const r = resolvePaygAccess({ paygAccess: 'blocked' }, on);
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'CUSTOMER_BLOCKED');
});

test('an unrecognised value never opens the door on its own', () => {
  // Only the literal 'allowed' may override an OFF switch.
  assert.strictEqual(resolvePaygAccess({ paygAccess: 'yes' }, off).available, false);
});

test('PAYG with the door shut is refused before anything else', () => {
  // Card and debt are fine and the wallet is full — still no.
  const p = evaluateFunding(base({ billingMethod: 'payg', paygAvailable: false, balance: 10000 }));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.code, 'PAYG_UNAVAILABLE');
});

test('a shut PAYG door does not affect prepaid', () => {
  const p = evaluateFunding(base({ billingMethod: 'prepaid', paygAvailable: false }));
  assert.strictEqual(p.ok, true);
});

test('being allowed does not skip any PAYG rule', () => {
  // The door is open, but eligibility, card, debt and dispute still apply.
  const open = { billingMethod: 'payg', paygAvailable: true, balance: 0, requiredBalance: 9999 };
  assert.strictEqual(evaluateFunding(base({ ...open, paygEligible: false, paygEligibleReason: 'MIN_AGE_NOT_MET' })).code, 'PAYG_NOT_ELIGIBLE');
  assert.strictEqual(evaluateFunding(base({ ...open, requireVerifiedCard: true, hasVerifiedCard: false })).code, 'CARD_REQUIRED');
  assert.strictEqual(evaluateFunding(base({ ...open, debtBlocked: true, debtReason: 'DEBT_TOO_OLD' })).code, 'DEBT_TOO_OLD');
  assert.strictEqual(evaluateFunding(base({ ...open, disputeHold: true })).code, 'DISPUTE_HOLD');
  assert.strictEqual(evaluateFunding(base(open)).ok, true);
});

/* ── Team spend limits ───────────────────────────────────── */

test('a member at their spend limit cannot start anything, on either method', () => {
  assert.strictEqual(evaluateFunding(base({ spendLimitReached: true })).code, 'SPEND_LIMIT_REACHED');
  assert.strictEqual(evaluateFunding(base({ billingMethod: 'payg', spendLimitReached: true, balance: 0 })).code, 'SPEND_LIMIT_REACHED');
});

test('below the limit, the usual rules decide', () => {
  assert.strictEqual(evaluateFunding(base({ spendLimitReached: false })).ok, true);
});
