/**
 * Tests for when a deployment is being charged, and at which rate.
 *
 * This is the money predicate. For most of the platform's life it was simply
 * `status === 'running'`; automatic provisioning splits that apart, because GCP
 * reports a VM RUNNING while the deployment stays `provisioning` until the
 * model inside it is configured — and the platform is paying Google for every
 * minute of the gap.
 *
 * Pure throughout, which is the point: these rules decide what a customer is
 * charged, and they can be asserted here against every awkward combination
 * without a database, a clock, or a cloud account.
 *
 * Run with:  node --test src/services/deployment/__tests__/billingClock.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  isComputeBillable, isStorageBillable, currentRateFor, BILLABLE_WHERE,
  BILLABLE_STATUSES, STORAGE_BILLABLE_STATUSES, TERMINAL_STATUSES,
} = require('../deploymentConstants');

const CLOCK = new Date('2026-10-13T09:00:00.000Z');

const dep = (over = {}) => ({
  status: 'running',
  computeClockStartedAt: null,
  pricePerHour: 2,
  stoppedPricePerHour: 0.2,
  planDiscountPercent: 0,
  ...over,
});

/* ── The behaviour that existed before, unchanged ────────────────────────── */

test('a running deployment bills compute, exactly as it always did', () => {
  const d = dep({ status: 'running' });
  assert.strictEqual(isComputeBillable(d), true);
  assert.strictEqual(isStorageBillable(d), false);
  assert.strictEqual(currentRateFor(d), 2);
});

test('a paused or stopped deployment bills storage', () => {
  for (const status of STORAGE_BILLABLE_STATUSES) {
    const d = dep({ status });
    assert.strictEqual(isComputeBillable(d), false, status);
    assert.strictEqual(isStorageBillable(d), true, status);
    assert.strictEqual(currentRateFor(d), 0.2, status);
  }
});

test('a deployment nobody has provisioned bills nothing', () => {
  for (const status of ['pending_review', 'approved', 'provisioning']) {
    const d = dep({ status });
    assert.strictEqual(currentRateFor(d), 0, status);
  }
});

test('a terminal deployment bills nothing', () => {
  for (const status of TERMINAL_STATUSES) {
    assert.strictEqual(currentRateFor(dep({ status })), 0, status);
  }
});

test('with no clock anywhere, the predicate is the old one exactly', () => {
  // The guarantee that makes this change safe to ship before any VM exists:
  // every row in the database has a null clock, so nothing moves.
  for (const status of ['pending_review', 'approved', 'provisioning', 'running', 'paused', 'stopped', 'failed', 'terminated', 'rejected']) {
    const d = dep({ status, computeClockStartedAt: null });
    assert.strictEqual(isComputeBillable(d), BILLABLE_STATUSES.includes(status), status);
    assert.strictEqual(isStorageBillable(d), STORAGE_BILLABLE_STATUSES.includes(status), status);
  }
});

/* ── What the clock changes ──────────────────────────────────────────────── */

test('a provisioning deployment with a running machine bills COMPUTE', () => {
  // The whole reason this exists: GCP says RUNNING, the model is not configured
  // yet, and Google is charging us from this instant.
  const d = dep({ status: 'provisioning', computeClockStartedAt: CLOCK });
  assert.strictEqual(isComputeBillable(d), true);
  assert.strictEqual(currentRateFor(d), 2, 'the compute rate, not the storage rate');
});

test('an approved deployment with a running machine also bills compute', () => {
  const d = dep({ status: 'approved', computeClockStartedAt: CLOCK });
  assert.strictEqual(isComputeBillable(d), true);
});

test('a running machine beats a paused status — one rate at a time, and it is compute', () => {
  // Shouldn't normally happen: pausing stops the machine. If the two ever
  // disagree, the honest answer is the one that matches what we are paying for.
  const d = dep({ status: 'paused', computeClockStartedAt: CLOCK });
  assert.strictEqual(isComputeBillable(d), true);
  assert.strictEqual(isStorageBillable(d), false, 'never both rates at once');
  assert.strictEqual(currentRateFor(d), 2);
});

test('a terminated deployment bills nothing even if a clock was left behind', () => {
  // The one direction this must never get wrong: charging for a machine that
  // no longer exists.
  for (const status of TERMINAL_STATUSES) {
    const d = dep({ status, computeClockStartedAt: CLOCK });
    assert.strictEqual(isComputeBillable(d), false, status);
    assert.strictEqual(currentRateFor(d), 0, status);
  }
});

test('stopping the clock returns a deployment to storage billing', () => {
  const running = dep({ status: 'paused', computeClockStartedAt: CLOCK });
  const stopped = dep({ status: 'paused', computeClockStartedAt: null });
  assert.strictEqual(currentRateFor(running), 2);
  assert.strictEqual(currentRateFor(stopped), 0.2);
});

test('the plan discount still applies, clock or no clock', () => {
  const d = dep({ status: 'provisioning', computeClockStartedAt: CLOCK, planDiscountPercent: 25 });
  assert.strictEqual(currentRateFor(d), 1.5);
});

test('the predicates work on a bare Prisma row, not just a wrapped doc', () => {
  const row = {
    status: 'provisioning',
    computeClockStartedAt: CLOCK,
    pricePerHour: { toNumber: () => 3 },
    stoppedPricePerHour: { toNumber: () => 0.3 },
    planDiscountPercent: { toNumber: () => 0 },
  };
  assert.strictEqual(isComputeBillable(row), true);
  assert.strictEqual(currentRateFor(row), 3, 'Decimal columns are read as numbers');
});

test('nothing at all is not billable', () => {
  for (const v of [null, undefined, {}]) {
    assert.strictEqual(isComputeBillable(v), false, JSON.stringify(v));
    assert.strictEqual(isStorageBillable(v), false, JSON.stringify(v));
    assert.strictEqual(currentRateFor(v), 0, JSON.stringify(v));
  }
});

/* ── The query the billing job runs ──────────────────────────────────────── */

test('BILLABLE_WHERE selects the old statuses and clocked deployments, never terminal ones', () => {
  // A structural assertion rather than a database one: this object is handed
  // straight to Prisma, so what matters is that it is a disjunction covering
  // both, with the terminal guard on the clock arm.
  assert.ok(Array.isArray(BILLABLE_WHERE.OR) && BILLABLE_WHERE.OR.length === 2);

  const [byStatus, byClock] = BILLABLE_WHERE.OR;
  assert.deepStrictEqual(
    byStatus.status.in.slice().sort(),
    [...BILLABLE_STATUSES, ...STORAGE_BILLABLE_STATUSES].slice().sort(),
  );
  assert.deepStrictEqual(byClock.computeClockStartedAt, { not: null });
  assert.deepStrictEqual(
    byClock.status.notIn.slice().sort(),
    TERMINAL_STATUSES.slice().sort(),
    'a terminated deployment with a stale clock must not be picked up and billed',
  );
});
