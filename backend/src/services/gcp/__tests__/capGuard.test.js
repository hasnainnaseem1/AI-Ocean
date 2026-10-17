/**
 * Tests for the question "may this deployment have a real machine right now?".
 *
 * This is the file that matters most in the automatic-provisioning path,
 * because there is no admin review behind it. Every rule below is the only
 * thing standing between some mistake — a mispriced tier, a retry loop, an
 * unfunded account, a switch flipped in the wrong order — and a bill from
 * Google that arrives a month later.
 *
 * So the assertions are about refusals, and in particular about the refusals
 * that are easy to get backwards:
 *
 *   - a cap of 0 means zero, never "unlimited"
 *   - an unknown cost is a refusal, not an assumption
 *   - a funding read that FAILS is not "funded"
 *   - automatic provisioning is the DEFAULT; only an explicit `false` defers
 *   - that switch applies in dry run too, because the clock still starts
 *
 * Pure throughout: no database, no network, no clock.
 *
 * Run with:  node --test src/services/gcp/__tests__/capGuard.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { decide, CODES } = require('../capGuard');

/**
 * A configuration that permits provisioning, so each test can break one thing.
 *
 * `gcp` is merged rather than replaced: a test that overrides one switch must
 * not silently drop the project id and end up asserting the wrong refusal.
 */
const DEFAULT_GCP = {
  enabled: true,
  dryRun: false,
  projectId: 'proj',
  serviceAccountKeyEncrypted: 'cipher',
  customerServiceAccount: 'customer-vm@proj.iam.gserviceaccount.com',
  maxConcurrentInstancesPerTeam: 3,
  maxConcurrentInstancesPlatform: 25,
  enforceMarginGuard: true,
};

const input = (over = {}) => ({
  cloud: 'gcp',
  accountAutoDeploy: true,
  hasLiveInstance: false,
  funding: { ok: true },
  teamInstances: 0,
  platformInstances: 0,
  sellPricePerHour: 0.2,
  costPerHour: 0.0335,
  machineType: 'e2-medium',
  ...over,
  gcp: { ...DEFAULT_GCP, ...(over.gcp || {}) },
});

/* ── The happy path, so every refusal below means something ──────────────── */

test('a funded, allowlisted deployment under every cap is permitted', () => {
  const r = decide(input());
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.code, null);
});

/* ── "Not our job" is distinct from "something is wrong" ─────────────────── */

test('the manual driver is reported as not-our-job, not as a failure', () => {
  const r = decide(input({ cloud: 'manual' }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, CODES.NOT_A_CLOUD);
  // The caller falls through to the manual queue on this code; it must not be
  // confusable with a real refusal.
  assert.match(r.reason, /manual/);
});

test('GCP switched off names the screen that switches it on', () => {
  const r = decide(input({ gcp: { enabled: false } }));
  assert.strictEqual(r.code, CODES.GCP_DISABLED);
  assert.match(r.reason, /Admin/);
});

/* ── Configuration ──────────────────────────────────────────────────────── */

test('a live run with no project, no key or no customer service account is refused', () => {
  for (const missing of ['projectId', 'serviceAccountKeyEncrypted', 'customerServiceAccount']) {
    const r = decide(input({ gcp: { [missing]: '' } }));
    assert.strictEqual(r.code, CODES.GCP_NOT_CONFIGURED, `${missing} should be required`);
  }
});

test('a missing customer service account explains WHY it matters', () => {
  // This one is not paperwork: the firewall rules target that account, so a
  // machine built without it is a machine outside the isolation.
  const r = decide(input({ gcp: { customerServiceAccount: '' } }));
  assert.match(r.reason, /firewall/i);
});

test('dry run needs no credentials at all — that is what it is for', () => {
  const r = decide(input({
    gcp: {
      dryRun: true, projectId: '', serviceAccountKeyEncrypted: '', customerServiceAccount: '',
    },
  }));
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.dryRun, true);
});

/* ── The account's own switch ──────────────────────────────────────────── */

test('an account with no switch set is automatic — that is the product rule', () => {
  // The important one. Automatic provisioning is what every customer gets;
  // an earlier design made it opt-in through an allowlist, which meant every
  // new customer silently stayed on the manual queue forever.
  const r = decide(input({ accountAutoDeploy: undefined }));
  assert.strictEqual(r.ok, true, r.reason);
});

test('an account set to manual review is deferred, not refused', () => {
  const r = decide(input({ accountAutoDeploy: false }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, CODES.ACCOUNT_ON_MANUAL_REVIEW);
  // The wording matters: an operator reading this in a log must not go
  // hunting for a fault. Nothing is wrong — an admin has to look first.
  assert.match(r.reason, /approve/);
});

test('only an explicit false defers — a missing or odd value stays automatic', () => {
  for (const value of [true, undefined, null, 1, 'yes']) {
    const r = decide(input({ accountAutoDeploy: value }));
    assert.strictEqual(r.ok, true, `${String(value)} should stay automatic: ${r.reason}`);
  }
});

test('manual review applies in dry run too, because the billing clock still starts', () => {
  // The tempting exemption. A dry-run instance reports RUNNING so the money
  // path can be exercised — and a clock that starts bills a real customer for
  // a machine that does not exist, which is worse than billing for one that
  // does but is unusable.
  const r = decide(input({ gcp: { dryRun: true }, accountAutoDeploy: false }));
  assert.strictEqual(r.code, CODES.ACCOUNT_ON_MANUAL_REVIEW);
});

/* ── Idempotency ────────────────────────────────────────────────────────── */

test('a deployment that already has a machine is refused before any API call', () => {
  const r = decide(input({ hasLiveInstance: true }));
  assert.strictEqual(r.code, CODES.ALREADY_HAS_INSTANCE);
});

/* ── Funding: the check transition() cannot do on this path ──────────────── */

test('an unfunded account is refused and the funding reason is carried through', () => {
  const r = decide(input({
    funding: { ok: false, code: 'INSUFFICIENT_BALANCE', reason: 'Balance too low.', shortfall: 4.5 },
  }));
  assert.strictEqual(r.code, CODES.NOT_FUNDED);
  assert.strictEqual(r.fundingCode, 'INSUFFICIENT_BALANCE');
  assert.strictEqual(r.shortfall, 4.5);
  // The customer-facing wording comes from fundingService, not from here —
  // there is one place that explains why an account cannot deploy.
  assert.strictEqual(r.reason, 'Balance too low.');
});

test('funding is checked before the caps, so an unfunded account is told about money', () => {
  // Both would refuse. Being told "the platform is full" when the real problem
  // is an empty wallet sends the customer to support instead of to top-up.
  const r = decide(input({
    funding: { ok: false, code: 'INSUFFICIENT_BALANCE', reason: 'Balance too low.' },
    teamInstances: 99,
    platformInstances: 99,
  }));
  assert.strictEqual(r.code, CODES.NOT_FUNDED);
});

/* ── Caps ───────────────────────────────────────────────────────────────── */

test('a team at its cap is refused', () => {
  const r = decide(input({ teamInstances: 3 }));
  assert.strictEqual(r.code, CODES.TEAM_CAP_REACHED);
  assert.match(r.reason, /limit is 3/);
});

test('a team one below its cap is permitted', () => {
  assert.strictEqual(decide(input({ teamInstances: 2 })).ok, true);
});

test('a cap of 0 blocks everything — it is never read as unlimited', () => {
  // The failure these caps exist to prevent, in the caps themselves.
  const team = decide(input({ gcp: { maxConcurrentInstancesPerTeam: 0 } }));
  assert.strictEqual(team.code, CODES.TEAM_CAP_REACHED);

  const platform = decide(input({ gcp: { maxConcurrentInstancesPlatform: 0 } }));
  assert.strictEqual(platform.code, CODES.PLATFORM_CAP_REACHED);
});

test('the platform cap counts every customer, not just this one', () => {
  const r = decide(input({ teamInstances: 0, platformInstances: 25 }));
  assert.strictEqual(r.code, CODES.PLATFORM_CAP_REACHED);
});

test('the team cap is reported before the platform cap', () => {
  // When both are hit, the account's own limit is the actionable one.
  const r = decide(input({ teamInstances: 5, platformInstances: 500 }));
  assert.strictEqual(r.code, CODES.TEAM_CAP_REACHED);
});

/* ── The margin guard ───────────────────────────────────────────────────── */

test('a machine that costs more than it sells for is refused', () => {
  const r = decide(input({ sellPricePerHour: 0.0154, costPerHour: 0.0335 }));
  assert.strictEqual(r.code, CODES.MARGIN_TOO_LOW);
  assert.strictEqual(r.costPerHour, 0.0335);
  assert.strictEqual(r.sellPricePerHour, 0.0154);
});

test('selling at exactly cost is refused — zero margin is not a business', () => {
  const r = decide(input({ sellPricePerHour: 0.0335, costPerHour: 0.0335 }));
  assert.strictEqual(r.code, CODES.MARGIN_TOO_LOW);
});

test('an unrecorded cost is a refusal, not a guess', () => {
  for (const unknown of [null, undefined, NaN, '']) {
    const r = decide(input({ costPerHour: unknown }));
    assert.strictEqual(r.code, CODES.COST_UNKNOWN, `${String(unknown)} must not be treated as free`);
    // The message has to say where to fix it, or it is just a dead end.
    assert.match(r.reason, /Admin/);
  }
});

test('a recorded cost of zero is honoured as zero, not treated as unknown', () => {
  // Free tier, a credit, a committed-use discount that nets out — whatever the
  // reason, 0 is a number somebody typed and must not be confused with blank.
  const r = decide(input({ costPerHour: 0 }));
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.costPerHour, 0);
});

test('with the guard off, an unknown cost no longer blocks the build', () => {
  const r = decide(input({ gcp: { enforceMarginGuard: false }, costPerHour: null }));
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.costPerHour, null);
});

test('with the guard off, a loss-making machine is permitted — that is the point of the switch', () => {
  const r = decide(input({
    gcp: { enforceMarginGuard: false }, sellPricePerHour: 0.01, costPerHour: 5,
  }));
  assert.strictEqual(r.ok, true, r.reason);
});

test('the guard is on unless it is explicitly false', () => {
  // Same `!== false` rule as dryRun: a settings row written before this field
  // existed must read as protected, not as unprotected.
  const r = decide(input({ gcp: { enforceMarginGuard: undefined }, costPerHour: null }));
  assert.strictEqual(r.code, CODES.COST_UNKNOWN);
});

/* ── Nothing here may throw ──────────────────────────────────────────────── */

test('a call with no arguments at all is refused rather than throwing', () => {
  // This runs on the path that creates a customer's deployment. An exception
  // here would turn a provisioning decision into a failed order.
  for (const bad of [undefined, null, {}]) {
    const r = decide(bad);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(typeof r.code, 'string');
  }
});
