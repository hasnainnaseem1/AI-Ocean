/**
 * Tests for the reconciler's decisions — the parts with no I/O in them.
 *
 * `readOperation` is small and looks obvious, which is exactly why it is tested
 * here: it decides when a customer's meter starts, from a response shape that
 * is easy to read wrong. A DONE operation with an error inside it is a failure,
 * not a success; the error lives two levels down at `error.errors[0]`; and a
 * `status` that is anything other than DONE means "not yet", including values
 * this code has never seen.
 *
 * Getting the timestamp wrong is the other half. Billing is back-dated to GCP's
 * own `endTime`, so reading the wrong field — or falling back to our clock —
 * either charges a customer for our polling interval or gives away the minutes
 * before we noticed.
 *
 * Run with:  node --test src/jobs/__tests__/gcpReconciler.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { readOperation, dryRunReady, isDryRunOperation } = require('../gcpReconciler');

/* ── Still going ────────────────────────────────────────────────────────── */

test('an operation that is still running is pending', () => {
  assert.strictEqual(readOperation({ status: 'RUNNING' }).state, 'pending');
  assert.strictEqual(readOperation({ status: 'PENDING' }).state, 'pending');
});

test('a missing or empty operation is pending, never done', () => {
  // Reading "no answer" as "finished" would start a customer's meter for a
  // machine that does not exist.
  for (const nothing of [null, undefined, {}]) {
    assert.strictEqual(readOperation(nothing).state, 'pending');
  }
});

test('a status this code has never seen is pending, not done', () => {
  assert.strictEqual(readOperation({ status: 'SOMETHING_NEW' }).state, 'pending');
});

/* ── Finished ───────────────────────────────────────────────────────────── */

test('a finished operation reports GCP\'s own endTime, not our clock', () => {
  const r = readOperation({ status: 'DONE', endTime: '2026-10-13T10:00:00.000Z' });
  assert.strictEqual(r.state, 'done');
  assert.strictEqual(r.at.toISOString(), '2026-10-13T10:00:00.000Z');
});

test('without an endTime it falls back to GCP\'s other timestamps before our own', () => {
  // Every one of these is closer to the truth than "now" — the point of the
  // fallback chain is that our clock is the last resort, applied by the caller.
  const started = readOperation({ status: 'DONE', startTime: '2026-10-13T09:00:00.000Z' });
  assert.strictEqual(started.at.toISOString(), '2026-10-13T09:00:00.000Z');

  const inserted = readOperation({ status: 'DONE', insertTime: '2026-10-13T08:00:00.000Z' });
  assert.strictEqual(inserted.at.toISOString(), '2026-10-13T08:00:00.000Z');
});

test('endTime wins over startTime and insertTime', () => {
  const r = readOperation({
    status: 'DONE',
    insertTime: '2026-10-13T08:00:00.000Z',
    startTime: '2026-10-13T09:00:00.000Z',
    endTime: '2026-10-13T10:00:00.000Z',
  });
  assert.strictEqual(r.at.toISOString(), '2026-10-13T10:00:00.000Z');
});

test('a done operation with no timestamp at all returns null, so the caller decides', () => {
  const r = readOperation({ status: 'DONE' });
  assert.strictEqual(r.state, 'done');
  assert.strictEqual(r.at, null);
});

/* ── Finished badly ─────────────────────────────────────────────────────── */

test('a DONE operation carrying an error is a failure, not a success', () => {
  // The one that would silently bill for a machine that never existed.
  const r = readOperation({
    status: 'DONE',
    error: { errors: [{ code: 'QUOTA_EXCEEDED', message: 'Quota CPUS exceeded.' }] },
  });
  assert.strictEqual(r.state, 'error');
  assert.strictEqual(r.error.code, 'QUOTA_EXCEEDED');
  assert.match(r.error.message, /Quota/);
});

test('an error is detected even while the operation is still RUNNING', () => {
  const r = readOperation({
    status: 'RUNNING',
    error: { errors: [{ code: 'ZONE_RESOURCE_POOL_EXHAUSTED', message: 'No capacity.' }] },
  });
  assert.strictEqual(r.state, 'error');
});

test('an error with no code falls back to the HTTP message rather than going unnamed', () => {
  const r = readOperation({
    status: 'DONE',
    httpErrorMessage: 'FORBIDDEN',
    httpErrorStatusCode: 403,
    error: { errors: [{ message: 'The caller does not have permission' }] },
  });
  assert.strictEqual(r.state, 'error');
  assert.strictEqual(r.error.code, 'FORBIDDEN');
  assert.strictEqual(r.error.status, 403);
});

test('an empty error list is not an error', () => {
  // GCP sends `error: {}` on some successful operations; treating that as a
  // failure would fail every build.
  assert.strictEqual(readOperation({ status: 'DONE', error: {} }).state, 'done');
  assert.strictEqual(readOperation({ status: 'DONE', error: { errors: [] } }).state, 'done');
});

/* ── Dry run ────────────────────────────────────────────────────────────── */

test('a dry-run instance is not ready before its pretend build time has passed', () => {
  const now = new Date('2026-10-13T10:00:00.000Z');
  const instance = { operationAt: new Date('2026-10-13T09:59:30.000Z') }; // 30s ago
  assert.strictEqual(dryRunReady(instance, { afterSeconds: 45, now }), false);
});

test('a dry-run instance is ready once the pretend build time has passed', () => {
  const now = new Date('2026-10-13T10:00:00.000Z');
  const instance = { operationAt: new Date('2026-10-13T09:59:00.000Z') }; // 60s ago
  assert.strictEqual(dryRunReady(instance, { afterSeconds: 45, now }), true);
});

test('a pretend build time of 0 is ready immediately', () => {
  const now = new Date('2026-10-13T10:00:00.000Z');
  assert.strictEqual(dryRunReady({ operationAt: now }, { afterSeconds: 0, now }), true);
});

test('dry-run readiness falls back through requestedAt and createdAt', () => {
  const now = new Date('2026-10-13T10:00:00.000Z');
  const old = new Date('2026-10-13T09:00:00.000Z');
  assert.strictEqual(dryRunReady({ requestedAt: old }, { afterSeconds: 45, now }), true);
  assert.strictEqual(dryRunReady({ createdAt: old }, { afterSeconds: 45, now }), true);
});

test('an instance with no timestamp at all is never ready', () => {
  // Rather than being "ready" because `undefined` compares as 0 — which would
  // mark a machine running the instant its row appeared.
  const now = new Date('2026-10-13T10:00:00.000Z');
  assert.strictEqual(dryRunReady({}, { afterSeconds: 45, now }), false);
});

test('a dry-run operation name is recognised, and a real one is not', () => {
  // This is what keeps a real machine from being settled on a timer instead of
  // on GCP's answer, if dry run is switched off while a build is in flight.
  assert.strictEqual(isDryRunOperation('dryrun-aio-11664bf9'), true);
  assert.strictEqual(isDryRunOperation('dryrun-delete-aio-11664bf9'), true);
  assert.strictEqual(isDryRunOperation('operation-1760000000000-abc'), false);
  assert.strictEqual(isDryRunOperation(null), false);
  assert.strictEqual(isDryRunOperation(undefined), false);
});
