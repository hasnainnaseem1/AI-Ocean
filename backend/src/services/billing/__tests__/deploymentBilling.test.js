/**
 * Tests for the billing decision: who pays for the time that just elapsed.
 *
 * The rule these pin down has no exceptions — time that was consumed is always
 * billed in full, at the rate in force while it was consumed. The wallet pays
 * whatever it can cover and every remaining cent becomes debt. Nothing is ever
 * waived, for any customer, on any billing method, for any duration.
 *
 * Two earlier behaviours broke that rule and are guarded against below. Prepaid
 * used to bill only the hours the balance could afford and let the rest of the
 * elapsed period go, on the theory that the machine "should have been stopped"
 * at the instant the money ran out — but billing runs hourly, so the machine
 * was still serving traffic and the platform ate up to a full hour of it every
 * time a wallet emptied. And idle storage had a policy whose entire purpose was
 * to write unpaid disk off.
 *
 * Pure by construction — `planCharge` takes numbers and returns numbers, so
 * none of this needs a database.
 *
 * Run with:  node --test src/services/billing/__tests__/deploymentBilling.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { planCharge } = require('../deploymentBilling');

const near = (actual, expected, tolerance = 0.005) =>
  Math.abs(actual - expected) <= tolerance;

const compute = (over) => ({
  rate: 0.69,
  elapsedHours: 1,
  available: 100,
  kind: 'compute',
  ...over,
});

/* ── Nothing is ever free ─────────────────────────────────────────────────── */

test('a wallet that covers the period is billed in full', () => {
  const p = planCharge(compute({ elapsedHours: 3, available: 100 }));

  assert.ok(near(p.amount, 2.07), `expected $2.07, got $${p.amount}`);
  assert.strictEqual(p.hours, 3);
  assert.strictEqual(p.exhausted, false);
  assert.strictEqual(p.toDebt, 0);
});

test('the old free hour: $0.55 against $0.69/hr bills the WHOLE hour, not $0.55 of it', () => {
  // The exact state from the deployment that kept running. This used to bill
  // 0.797h and drop the remaining 0.203h. Those minutes were served.
  const p = planCharge(compute({ elapsedHours: 1, available: 0.55 }));

  assert.strictEqual(p.hours, 1, 'the full hour that actually ran');
  assert.ok(near(p.amount, 0.69), `the full hour at full price, got $${p.amount}`);
  assert.ok(near(p.toWallet, 0.55), 'the wallet gives everything it has');
  assert.ok(near(p.toDebt, 0.14), 'and the rest is owed, not waived');
  assert.strictEqual(p.exhausted, true, 'prepaid still stops the machine');
});

test('a long catch-up bills every hour of the gap, however empty the wallet', () => {
  // A 16-hour gap with $3 in the wallet used to bill $3 and write off $8.04.
  const p = planCharge(compute({ elapsedHours: 16, available: 3 }));

  assert.strictEqual(p.hours, 16, 'the cron running late does not make the hours free');
  assert.ok(near(p.amount, 11.04), `expected $11.04, got $${p.amount}`);
  assert.ok(near(p.toWallet, 3));
  assert.ok(near(p.toDebt, 8.04));
  assert.strictEqual(p.exhausted, true);
});

test('an empty wallet bills the full period, all of it to debt', () => {
  const p = planCharge(compute({ elapsedHours: 2, available: 0 }));

  assert.strictEqual(p.hours, 2);
  assert.ok(near(p.amount, 1.38));
  assert.strictEqual(p.toWallet, 0);
  assert.ok(near(p.toDebt, 1.38), 'an empty wallet is not a discount');
  assert.strictEqual(p.exhausted, true);
});

test('a negative available balance never produces a negative charge or a credit', () => {
  // graceBalance can be set above zero, which makes `available` negative for a
  // wallet already under it. Billing a negative amount would pay the customer
  // for running a machine.
  const p = planCharge(compute({ elapsedHours: 5, available: -20 }));

  assert.strictEqual(p.toWallet, 0, 'nothing comes out of a wallet already below the floor');
  assert.ok(near(p.toDebt, 3.45), 'the whole charge is owed');
  assert.ok(near(p.amount, 3.45));
});

test('every cent of every charge lands in exactly one of wallet or debt', () => {
  for (const available of [0, 0.01, 0.55, 3, 11.03, 11.04, 50]) {
    const p = planCharge(compute({ elapsedHours: 16, available }));
    assert.ok(
      near(p.toWallet + p.toDebt, p.amount),
      `available ${available}: ${p.toWallet} + ${p.toDebt} != ${p.amount}`
    );
    assert.ok(p.toWallet >= 0 && p.toDebt >= 0, `available ${available}: negative split`);
  }
});

test('unpaid storage on a stopped deployment is owed, never written off', () => {
  // There is no compute left to switch off and the disk is genuinely occupied.
  // This used to be a policy choice between driving the wallet negative — a
  // ledger nothing collects from — and writing the storage off outright.
  const p = planCharge({ rate: 0.246, elapsedHours: 10, available: 1, kind: 'storage' });

  assert.ok(near(p.amount, 2.46), `expected the full $2.46, got $${p.amount}`);
  assert.ok(near(p.toWallet, 1), 'the wallet covers what it can');
  assert.ok(near(p.toDebt, 1.46), 'and the shortfall is owed on the outstanding balance');
  assert.ok(near(p.toWallet + p.toDebt, p.amount), 'every cent lands somewhere');
});

test('billing exactly to the last cent is not treated as exhaustion', () => {
  const p = planCharge(compute({ elapsedHours: 1, available: 0.69 }));

  assert.strictEqual(p.exhausted, false, '$0.69 available covers a $0.69 charge');
  assert.ok(near(p.amount, 0.69));
  assert.strictEqual(p.toDebt, 0);
});

test('an unlimited available balance records the whole period and is never exhausted', () => {
  const p = planCharge(compute({ elapsedHours: 40, available: Infinity }));

  assert.strictEqual(p.hours, 40);
  assert.strictEqual(p.exhausted, false);
});

test('a zero rate bills nothing — that is a price the admin set, not a waiver', () => {
  const p = planCharge({ rate: 0, elapsedHours: 10, available: 0, kind: 'storage' });

  assert.strictEqual(p.amount, 0);
  assert.strictEqual(p.toDebt, 0, 'nothing is owed for something priced at zero');
  assert.strictEqual(p.exhausted, false, 'costing nothing is not the same as running out');
});

test('prepaid and pay-as-you-go differ only on whether the machine stops', () => {
  const shared = { elapsedHours: 4, available: 1 };
  const pre = planCharge(compute(shared));
  const pay = planCharge(compute({ ...shared, billingMethod: 'payg' }));

  assert.ok(near(pre.amount, pay.amount), 'identical money');
  assert.ok(near(pre.toWallet, pay.toWallet));
  assert.ok(near(pre.toDebt, pay.toDebt));
  assert.strictEqual(pre.exhausted, true, 'prepaid stops');
  assert.strictEqual(pay.exhausted, false, 'pay-as-you-go keeps running');
});

/* ── Pay-as-you-go: wallet first, shortfall becomes debt, never exhausted ── */

const payg = (over) => compute({ billingMethod: 'payg', ...over });

test('a prepaid charge with a covering wallet never touches debt (toDebt is 0)', () => {
  const p = planCharge(compute({ elapsedHours: 1, available: 100 }));
  assert.strictEqual(p.toWallet, 0.69);
  assert.strictEqual(p.toDebt, 0);
});

test('pay-as-you-go with a covering wallet: everything comes from the wallet, nothing from debt', () => {
  const p = planCharge(payg({ elapsedHours: 1, available: 100 }));
  assert.ok(near(p.toWallet, 0.69));
  assert.strictEqual(p.toDebt, 0);
  assert.strictEqual(p.exhausted, false);
});

test('pay-as-you-go with an empty wallet: the entire charge becomes debt, and it is NOT exhausted', () => {
  const p = planCharge(payg({ elapsedHours: 1, available: 0 }));
  assert.strictEqual(p.toWallet, 0);
  assert.ok(near(p.toDebt, 0.69));
  assert.strictEqual(p.exhausted, false, 'pay-as-you-go billing itself never pauses the machine');
  assert.strictEqual(p.hours, 1, 'the full period is billed, not cut short');
  assert.ok(near(p.amount, 0.69));
});

test('pay-as-you-go with a partial wallet: split exactly between wallet and debt', () => {
  const p = planCharge(payg({ elapsedHours: 1, available: 0.20 }));
  assert.ok(near(p.toWallet, 0.20));
  assert.ok(near(p.toDebt, 0.49));
  assert.ok(near(p.toWallet + p.toDebt, 0.69), 'wallet + debt always equals the full charge');
  assert.strictEqual(p.exhausted, false);
});

test('pay-as-you-go with a negative available (already in the red) still bills fully, all to debt', () => {
  const p = planCharge(payg({ elapsedHours: 1, available: -50 }));
  assert.strictEqual(p.toWallet, 0, 'nothing can come from a wallet that is already negative');
  assert.ok(near(p.toDebt, 0.69));
});

test('pay-as-you-go over a long unbilled gap still bills every hour', () => {
  // The exact shape of the old catch-up bug: a 16h gap on a nearly empty
  // wallet. Both methods now bill all 16 hours; only the machine's fate differs.
  const p = planCharge(payg({ elapsedHours: 16, available: 1 }));
  assert.strictEqual(p.hours, 16, 'the whole gap is billed, not cut short');
  assert.strictEqual(p.exhausted, false);
  assert.ok(near(p.toWallet, 1));
  assert.ok(near(p.toDebt, 16 * 0.69 - 1));
});

test('pay-as-you-go storage bills in full and splits wallet/debt like compute', () => {
  const p = planCharge(payg({ kind: 'storage', elapsedHours: 10, available: 1 }));
  assert.strictEqual(p.exhausted, false);
  assert.ok(near(p.toWallet, 1));
  assert.ok(near(p.toDebt, 10 * 0.69 - 1));
  assert.strictEqual(p.hours, 10);
});

test('pay-as-you-go billed exactly to the last cent still reports toDebt as exactly 0, not a rounding artefact', () => {
  const p = planCharge(payg({ elapsedHours: 1, available: 0.69 }));
  assert.strictEqual(p.toDebt, 0);
  assert.ok(near(p.toWallet, 0.69));
});

test('a zero rate under pay-as-you-go bills nothing and sends nothing to debt', () => {
  const p = planCharge(payg({ rate: 0, elapsedHours: 5, available: 0 }));
  assert.strictEqual(p.amount, 0);
  assert.strictEqual(p.toWallet, 0);
  assert.strictEqual(p.toDebt, 0);
});
