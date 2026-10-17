/**
 * Tests for what a machine-hour costs, and the price floor that follows.
 *
 * This decides what the platform may charge, so the cases that matter are the
 * ones where a plausible-looking bug produces a number that is too LOW — every
 * one of those approves a tier that loses money on every hour it runs:
 *
 *   - a missing rate must refuse, never cost nothing
 *   - disk is quoted per GB-MONTH and billed per hour
 *   - tax applies to the overhead as well as to the provider's charge
 *   - a price equal to cost is a loss, not a break-even
 *
 * Pure throughout: no database, no network, no clock.
 *
 * Run with:  node --test src/services/cloud/__tests__/costModel.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { costOf, assessPrice, HOURS_PER_MONTH } = require('../costModel');

/** Round numbers, so the arithmetic in each assertion is readable. */
const RATES = {
  vcpuHour: 0.02,
  ramGbHour: 0.01,
  gpuHour: { 'NVIDIA L4': 0.5, 'NVIDIA A100 80GB': 3 },
  diskGbMonth: { SSD: 0.17, 'NVMe SSD': 0.25, HDD: 0.04 },
  currency: 'USD',
};

const cpuBox = { vcpu: 4, ramGb: 16, storageGb: 100, storageType: 'SSD' };

/* ── The arithmetic ──────────────────────────────────────────────────────── */

test('a CPU machine costs the sum of its parts', () => {
  const r = costOf({ components: cpuBox, rates: RATES });
  assert.strictEqual(r.ok, true, r.missing.join(', '));
  assert.strictEqual(r.direct.compute, 0.08); // 4 × 0.02
  assert.strictEqual(r.direct.memory, 0.16); // 16 × 0.01
  assert.strictEqual(r.direct.gpu, 0);
  // 100 GB × $0.17/GB-month ÷ 730 h
  assert.strictEqual(r.direct.storage, Number(((100 * 0.17) / 730).toFixed(6)));
  assert.strictEqual(r.direct.total, Number((0.08 + 0.16 + (100 * 0.17) / 730).toFixed(6)));
});

test('disk is converted from per-GB-month to per-hour', () => {
  // The bug worth guarding: treating a monthly price as hourly over-states
  // disk 730-fold, and a tier that should be refused sails through.
  const r = costOf({
    components: { vcpu: 0, ramGb: 0, storageGb: 730, storageType: 'SSD' },
    rates: RATES,
  });
  assert.strictEqual(r.direct.storage, 0.17); // 730 GB-months ÷ 730 h = 1 GB-month/h
  assert.strictEqual(HOURS_PER_MONTH, 730);
});

test('a GPU machine prices each card', () => {
  const r = costOf({
    components: { vcpu: 12, ramGb: 85, gpuModel: 'NVIDIA L4', gpuCount: 4, storageGb: 0 },
    rates: RATES,
  });
  assert.strictEqual(r.direct.gpu, 2); // 4 × 0.5
});

/* ── Missing rates refuse ────────────────────────────────────────────────── */

test('an unknown vCPU rate refuses rather than costing nothing', () => {
  const r = costOf({ components: cpuBox, rates: { ...RATES, vcpuHour: null } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.totalCost, null);
  assert.deepStrictEqual(r.missing, ['vCPU rate']);
});

test('a blank rate is unknown, not free', () => {
  // `Number('') === 0`, which is how a blank cell silently becomes "free".
  const r = costOf({ components: cpuBox, rates: { ...RATES, ramGbHour: '' } });
  assert.strictEqual(r.ok, false);
  assert.ok(r.missing.includes('RAM rate'));
});

test('a GPU with no published rate refuses, and names the model', () => {
  const r = costOf({
    components: { vcpu: 1, ramGb: 1, gpuModel: 'RTX 4090', gpuCount: 1 },
    rates: RATES,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.missing[0], /RTX 4090/);
});

test('a disk type with no published rate refuses, and names the type', () => {
  const r = costOf({
    components: { vcpu: 1, ramGb: 1, storageGb: 50, storageType: 'Optane' },
    rates: RATES,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.missing[0], /Optane/);
});

test('every missing rate is reported, not just the first', () => {
  // An operator fixing one at a time, with a fresh API call between each, is
  // the slowest possible way to configure this.
  const r = costOf({
    components: { vcpu: 4, ramGb: 8, gpuModel: 'RTX 4090', gpuCount: 1, storageGb: 10, storageType: 'Optane' },
    rates: { currency: 'USD' },
  });
  assert.strictEqual(r.missing.length, 4);
});

test('a component the machine does not have needs no rate', () => {
  // No GPU and no disk, so neither rate is required — otherwise every CPU
  // machine would be unpriceable until somebody filled in GPU prices.
  const r = costOf({
    components: { vcpu: 2, ramGb: 4 },
    rates: { vcpuHour: 0.02, ramGbHour: 0.01, currency: 'USD' },
  });
  assert.strictEqual(r.ok, true, r.missing.join(', '));
});

/* ── Overhead, tax, margin ───────────────────────────────────────────────── */

test('overhead has a scaling part and a flat part, because the costs behave differently', () => {
  const r = costOf({
    components: { vcpu: 10, ramGb: 0 }, // direct = 0.20
    rates: RATES,
    policy: { overheadPercent: 10, overheadPerHour: 0.05 },
  });
  assert.strictEqual(r.direct.total, 0.2);
  assert.strictEqual(r.overhead, 0.07); // 0.20 × 10% + 0.05
});

test('tax applies to the overhead too, not only to the provider\'s charge', () => {
  // The overhead is real spending on a real invoice; taxing only the provider
  // line under-states the cost, which is the direction that loses money.
  const r = costOf({
    components: { vcpu: 10, ramGb: 0 },
    rates: RATES,
    policy: { overheadPerHour: 0.1, taxPercent: 10 },
  });
  assert.strictEqual(r.direct.total, 0.2);
  assert.strictEqual(r.overhead, 0.1);
  assert.strictEqual(r.tax, 0.03); // 10% of 0.30, not of 0.20
  assert.strictEqual(r.totalCost, 0.33);
});

test('the floor is cost plus the margin the platform wants', () => {
  const r = costOf({
    components: { vcpu: 10, ramGb: 0 },
    rates: RATES,
    policy: { targetMarginPercent: 50 },
  });
  assert.strictEqual(r.totalCost, 0.2);
  assert.strictEqual(r.floorPrice, 0.3);
});

test('with no policy at all, cost is exactly what the provider charges', () => {
  // A platform that has not configured any of this must not have numbers
  // invented on top of its provider bill.
  const r = costOf({ components: { vcpu: 10, ramGb: 0 }, rates: RATES });
  assert.strictEqual(r.overhead, 0);
  assert.strictEqual(r.tax, 0);
  assert.strictEqual(r.totalCost, 0.2);
  assert.strictEqual(r.floorPrice, 0.2);
});

test('negative policy values are treated as zero, never as a discount', () => {
  const r = costOf({
    components: { vcpu: 10, ramGb: 0 },
    rates: RATES,
    policy: { overheadPercent: -50, taxPercent: -10, targetMarginPercent: -100 },
  });
  assert.strictEqual(r.totalCost, 0.2);
  assert.strictEqual(r.floorPrice, 0.2);
});

/* ── A provider that prices the whole machine (AWS) ──────────────────────── */

const AWS_RATES = {
  instanceHour: 0.192, // m6i.xlarge
  diskGbMonth: { gp3: 0.088, io2: 0.138, st1: 0.0153 },
  currency: 'USD',
};

test('an instance rate prices the whole machine, with storage still separate', () => {
  // This is how AWS actually bills: one price for the instance, EBS billed
  // per GB-month on its own.
  const r = costOf({
    components: { vcpu: 4, ramGb: 16, storageGb: 100, storageType: 'gp3' },
    rates: AWS_RATES,
  });
  assert.strictEqual(r.ok, true, r.missing.join(', '));
  assert.strictEqual(r.direct.instance, 0.192);
  assert.strictEqual(r.direct.storage, Number(((100 * 0.088) / 730).toFixed(6)));
  assert.strictEqual(r.direct.total, Number((0.192 + (100 * 0.088) / 730).toFixed(6)));
});

test('the component lines are null, not zero, when the machine was priced whole', () => {
  /*
   * "Not broken down" and "costs nothing" are different facts. A screen
   * showing $0.0000 for CPU on an AWS machine would be stating the second
   * when only the first is true.
   */
  const r = costOf({ components: { vcpu: 4, ramGb: 16 }, rates: AWS_RATES });
  assert.strictEqual(r.direct.compute, null);
  assert.strictEqual(r.direct.memory, null);
  assert.strictEqual(r.direct.gpu, null);
  assert.strictEqual(r.pricedWholeMachine, true);
});

test('an instance rate makes the component rates irrelevant, not merely unused', () => {
  // No vCPU or RAM rate is supplied and none is demanded — the whole point of
  // supporting both shapes.
  const r = costOf({
    components: { vcpu: 96, ramGb: 1152, gpuModel: 'NVIDIA A100 40GB', gpuCount: 8 },
    rates: { instanceHour: 32.77, currency: 'USD' },
  });
  assert.strictEqual(r.ok, true, r.missing.join(', '));
  assert.strictEqual(r.totalCost, 32.77);
});

test('a GPU with no separate rate is fine when the instance price already covers it', () => {
  // AWS welds the GPU into the instance type, so there is no card price to
  // look up and demanding one would refuse every GPU machine on AWS.
  const r = costOf({
    components: { vcpu: 4, ramGb: 16, gpuModel: 'NVIDIA L4', gpuCount: 1 },
    rates: { instanceHour: 0.8048, currency: 'USD' },
  });
  assert.strictEqual(r.ok, true, r.missing.join(', '));
});

test('a missing disk rate still refuses, even with an instance rate', () => {
  // Storage is genuinely billed separately on AWS, so an unknown volume price
  // is still an unknown cost.
  const r = costOf({
    components: { vcpu: 4, ramGb: 16, storageGb: 50, storageType: 'io2' },
    rates: { instanceHour: 0.192, currency: 'USD' },
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.missing.some((m) => /io2/.test(m)), r.missing.join(', '));
});

test('an instance rate with no machine to attach it to refuses', () => {
  // Otherwise an empty tier would look priceable at the instance rate.
  const r = costOf({ components: {}, rates: AWS_RATES });
  assert.strictEqual(r.ok, false);
  assert.ok(r.missing.some((m) => /machine specs/.test(m)), r.missing.join(', '));
});

test('overhead, tax and margin apply identically to a whole-machine price', () => {
  // The platform's own costs do not care which cloud the machine is on.
  const r = costOf({
    components: { vcpu: 4, ramGb: 16 },
    rates: { instanceHour: 0.2, currency: 'USD' },
    policy: { overheadPercent: 10, overheadPerHour: 0.01, taxPercent: 10, targetMarginPercent: 50 },
  });
  assert.strictEqual(r.direct.total, 0.2);
  assert.strictEqual(r.overhead, 0.03); // 0.2 × 10% + 0.01
  assert.strictEqual(r.tax, 0.023); // 10% of 0.23
  assert.strictEqual(r.totalCost, 0.253);
  assert.strictEqual(r.floorPrice, 0.3795);
});

test('a zero instance rate is honoured as zero, not treated as absent', () => {
  // Free tier, a credit, a committed-use discount netting out — 0 is a number
  // somebody published, and it must not fall through to the component path.
  const r = costOf({ components: { vcpu: 4, ramGb: 16 }, rates: { instanceHour: 0, currency: 'USD' } });
  assert.strictEqual(r.ok, true, r.missing.join(', '));
  assert.strictEqual(r.direct.instance, 0);
  assert.strictEqual(r.pricedWholeMachine, true);
});

test('a blank instance rate falls back to components rather than reading as free', () => {
  // `Number('') === 0`, which would otherwise make every machine free.
  const r = costOf({
    components: { vcpu: 10, ramGb: 0 },
    rates: { instanceHour: '', vcpuHour: 0.02, currency: 'USD' },
  });
  assert.strictEqual(r.ok, true, r.missing.join(', '));
  assert.strictEqual(r.pricedWholeMachine, false);
  assert.strictEqual(r.direct.compute, 0.2);
});

/* ── What to do about a price ────────────────────────────────────────────── */

const cost = costOf({
  components: { vcpu: 10, ramGb: 0 },
  rates: RATES,
  policy: { targetMarginPercent: 50 },
}); // cost 0.20, floor 0.30

test('a price below cost is a loss, and the shortfall is to COST not to the floor', () => {
  const r = assessPrice({ sellPrice: 0.15, cost });
  assert.strictEqual(r.verdict, 'loss');
  assert.strictEqual(r.shortfall, 0.05);
  assert.ok(r.marginPercent < 0);
});

test('a price exactly at cost is a loss, not a break-even', () => {
  // Zero margin is not a business, and treating it as acceptable is how a
  // rounding error turns into a per-hour loss.
  assert.strictEqual(assessPrice({ sellPrice: 0.2, cost }).verdict, 'loss');
});

test('a profitable price under the target is flagged, not condemned', () => {
  const r = assessPrice({ sellPrice: 0.25, cost });
  assert.strictEqual(r.verdict, 'below_target');
  assert.strictEqual(r.marginPercent, 25);
  assert.strictEqual(r.shortfall, 0.05); // to the floor, which is what it misses
});

test('a price at or above the floor is fine', () => {
  assert.strictEqual(assessPrice({ sellPrice: 0.3, cost }).verdict, 'ok');
  assert.strictEqual(assessPrice({ sellPrice: 2, cost }).verdict, 'ok');
});

test('a price cannot be assessed against a cost that could not be worked out', () => {
  const unknown = costOf({ components: cpuBox, rates: { currency: 'USD' } });
  const r = assessPrice({ sellPrice: 5, cost: unknown });
  assert.strictEqual(r.verdict, 'unknown');
  assert.strictEqual(r.marginPercent, null);
});

/* ── Nothing here may throw ──────────────────────────────────────────────── */

test('junk input is refused rather than throwing', () => {
  for (const bad of [undefined, null, {}, { components: null, rates: null }]) {
    const r = costOf(bad);
    assert.strictEqual(typeof r.ok, 'boolean');
  }
  // A machine with no components at all costs nothing, and that is honest —
  // there is nothing to price.
  assert.strictEqual(costOf({}).ok, true);
  assert.strictEqual(costOf({}).totalCost, 0);
});
