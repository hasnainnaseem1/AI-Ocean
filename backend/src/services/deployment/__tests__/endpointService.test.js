/**
 * Tests for the endpoint-access decision — what should happen to a
 * deployment's API key credentials when its status changes.
 *
 * This is the fix for the biggest hole found while planning pay-as-you-go
 * billing: pausing a deployment changed its status and nothing else, so a
 * customer whose credit ran out kept a fully working API key and could keep
 * consuming inference for free — while we billed them for storage alone.
 *
 * `decideEndpointAction` is pure by construction, the same way `planCharge` in
 * services/billing/deploymentBilling.js turned "how much do we bill" into
 * plain arithmetic: it takes an endpoint's current fields and the status it is
 * moving to, and returns what should happen, with no database, no clock and no
 * provisioning driver involved. Every case below is a way credentials could
 * otherwise have gone wrong.
 *
 * Run with:  node --test src/services/deployment/__tests__/endpointService.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { decideEndpointAction } = require('../endpointService');

const provisioned = (over = {}) => ({
  url: 'https://api.example.com/v1/infer',
  apiKeyEncrypted: 'iv:tag:ciphertext',
  apiKeyMasked: 'aio-••••••••ab12',
  active: true,
  suspendedForEnforcement: false,
  ...over,
});

/* ── Never-provisioned deployments have nothing to take away ────────────── */

test('a deployment with no credentials at all is left alone on every status', () => {
  const empty = { url: '', apiKeyEncrypted: '' };

  for (const status of ['paused', 'stopped', 'terminated', 'rejected', 'failed', 'running']) {
    const plan = decideEndpointAction(empty, status);
    assert.strictEqual(plan.kind, 'none', `expected "none" for ${status}, got "${plan.kind}"`);
    assert.strictEqual(plan.hadCredentials, false);
  }
});

/* ── The core hole: pausing must suspend, not do nothing ─────────────────── */

test('pausing a provisioned deployment suspends its access', () => {
  const plan = decideEndpointAction(provisioned(), 'paused');
  assert.strictEqual(plan.kind, 'suspend');
  assert.strictEqual(plan.hadCredentials, true);
});

test('stopping a provisioned deployment suspends its access, same as pausing', () => {
  const plan = decideEndpointAction(provisioned(), 'stopped');
  assert.strictEqual(plan.kind, 'suspend');
});

test('suspending an already-suspended endpoint is reported as already there', () => {
  const plan = decideEndpointAction(provisioned({ active: false }), 'paused');
  assert.strictEqual(plan.kind, 'suspend');
  assert.strictEqual(plan.alreadyThere, true, 'should not re-log a suspension that already happened');
});

/* ── Terminal statuses destroy credentials outright ──────────────────────── */

for (const status of ['terminated', 'rejected', 'failed']) {
  test(`reaching "${status}" revokes credentials, not merely suspends them`, () => {
    const plan = decideEndpointAction(provisioned(), status);
    assert.strictEqual(plan.kind, 'revoke');
  });
}

/* ── Resuming: the rotation rule is the security-critical part ──────────── */

test('a customer pause (not enforcement) resumes without rotating the key', () => {
  const plan = decideEndpointAction(
    provisioned({ suspendedForEnforcement: false }),
    'running',
    { rotateOnEnforcedResume: true }
  );
  assert.strictEqual(plan.kind, 'restore');
  assert.strictEqual(plan.shouldRotate, false, 'a voluntary pause must not cost the customer their key');
});

test('resuming from an enforcement suspension rotates the key when the setting allows it', () => {
  const plan = decideEndpointAction(
    provisioned({ suspendedForEnforcement: true }),
    'running',
    { rotateOnEnforcedResume: true }
  );
  assert.strictEqual(plan.kind, 'restore');
  assert.strictEqual(plan.shouldRotate, true);
});

test('an admin can turn enforcement rotation off', () => {
  const plan = decideEndpointAction(
    provisioned({ suspendedForEnforcement: true }),
    'running',
    { rotateOnEnforcedResume: false }
  );
  assert.strictEqual(plan.shouldRotate, false);
});

test('a destroyed key is always replaced on resume, whatever the rotation setting says', () => {
  // The only way this state arises is a deployment resurrected after having
  // its key destroyed (e.g. an admin manually reopening a failed provision) —
  // there is no ciphertext to hand back, so "don't rotate" cannot mean
  // "leave them with nothing".
  const plan = decideEndpointAction(
    provisioned({ apiKeyEncrypted: '', suspendedForEnforcement: false }),
    'running',
    { rotateOnEnforcedResume: false }
  );
  assert.strictEqual(plan.kind, 'restore');
  assert.strictEqual(plan.keyDestroyed, true);
  assert.strictEqual(plan.shouldRotate, true, 'a destroyed key must always be replaced');
});

test('enforcement latches: a customer pause on top of an enforcement suspension is still enforcement', () => {
  // decideEndpointAction itself only classifies "paused" as a suspend action —
  // the latching behaviour (once enforced, always enforced until a real
  // resume) lives in suspend()'s handling of suspendedForEnforcement, which is
  // exercised by the live-database checks. This test fixes the read side: a
  // deployment already flagged suspendedForEnforcement must still show that
  // fact to the resume decision even if the most recent action was a plain
  // customer pause.
  const alreadyEnforced = provisioned({ active: false, suspendedForEnforcement: true });
  const plan = decideEndpointAction(alreadyEnforced, 'running', { rotateOnEnforcedResume: true });
  assert.strictEqual(plan.wasEnforced, true);
  assert.strictEqual(plan.shouldRotate, true);
});

/* ── In-flight statuses touch nothing ─────────────────────────────────────── */

for (const status of ['pending_review', 'approved', 'provisioning']) {
  test(`"${status}" is left alone — nothing has been earned or taken away yet`, () => {
    const plan = decideEndpointAction(provisioned(), status);
    assert.strictEqual(plan.kind, 'none');
  });
}

/* ── A revoked deployment coming back has nothing to restore correctly ───── */

test('a deployment whose key was destroyed but whose URL survives still restores with a fresh key', () => {
  const plan = decideEndpointAction(
    { url: 'https://api.example.com/v1/infer', apiKeyEncrypted: '' },
    'running',
    { rotateOnEnforcedResume: false }
  );
  assert.strictEqual(plan.hadCredentials, true, 'a URL alone still counts as something to manage');
  assert.strictEqual(plan.kind, 'restore');
  assert.strictEqual(plan.shouldRotate, true);
});
