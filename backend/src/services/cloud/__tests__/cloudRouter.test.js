/**
 * Tests for "which cloud does this deployment belong on?"
 *
 * The expensive mistakes here are all quiet ones, so that is what these
 * assert:
 *
 *   - a model pinned to a switched-off cloud must NOT be sent to the other one
 *   - two clouds on with nothing saying which must refuse, not pick
 *   - an existing deployment's cloud comes from the frozen field, never from
 *     re-deriving it — re-deriving is how a terminate goes to the wrong cloud
 *     and leaves a machine running that nobody is watching
 *   - every path returns a usable cloud name, never null
 *
 * Pure throughout: no database, no network, no clock.
 *
 * Run with:  node --test src/services/cloud/__tests__/cloudRouter.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { decide, cloudOf, enabledClouds, CODES, MANUAL } = require('../cloudRouter');

/* ── One cloud on: the simple platform ───────────────────────────────────── */

test('one cloud on and nothing else configured routes everything there', () => {
  const r = decide({ enabled: ['gcp'] });
  assert.strictEqual(r.cloud, 'gcp');
  assert.strictEqual(r.code, CODES.ONLY_CLOUD);
});

test('a model assigned to the one cloud that is on goes there', () => {
  const r = decide({ modelCloud: 'aws', enabled: ['aws'] });
  assert.strictEqual(r.cloud, 'aws');
  assert.strictEqual(r.code, CODES.MODEL_PINNED);
});

/* ── Both clouds on: the whole point of the feature ──────────────────────── */

test('with both clouds on, each model goes where it is assigned', () => {
  const both = ['gcp', 'aws'];
  assert.strictEqual(decide({ modelCloud: 'aws', enabled: both, defaultCloud: 'gcp' }).cloud, 'aws');
  assert.strictEqual(decide({ modelCloud: 'gcp', enabled: both, defaultCloud: 'aws' }).cloud, 'gcp');
});

test('an unassigned model uses the default cloud', () => {
  const r = decide({ modelCloud: null, enabled: ['gcp', 'aws'], defaultCloud: 'aws' });
  assert.strictEqual(r.cloud, 'aws');
  assert.strictEqual(r.code, CODES.DEFAULT_CLOUD);
});

test('a model assignment beats the default', () => {
  const r = decide({ modelCloud: 'gcp', enabled: ['gcp', 'aws'], defaultCloud: 'aws' });
  assert.strictEqual(r.cloud, 'gcp');
  assert.strictEqual(r.code, CODES.MODEL_PINNED);
});

/* ── The refusals ───────────────────────────────────────────────────────── */

test('a model pinned to a switched-off cloud goes to the QUEUE, not the other cloud', () => {
  // The one that would be most tempting to "fix" by being helpful. The admin
  // pinned it for a reason, and the other cloud may not be able to build it
  // at all — substituting one for another silently is how a customer ends up
  // on hardware nobody chose.
  const r = decide({ modelCloud: 'aws', enabled: ['gcp'], defaultCloud: 'gcp' });
  assert.strictEqual(r.cloud, MANUAL);
  assert.strictEqual(r.code, CODES.PINNED_CLOUD_OFF);
  assert.match(r.reason, /deliberate choice/);
});

test('two clouds on with no default and no assignment refuses rather than picking', () => {
  const r = decide({ enabled: ['gcp', 'aws'] });
  assert.strictEqual(r.cloud, MANUAL);
  assert.strictEqual(r.code, CODES.AMBIGUOUS);
  // The message has to say how to fix it, or it is a dead end.
  assert.match(r.reason, /Set a default cloud/);
});

test('no cloud on at all goes to the queue', () => {
  const r = decide({ enabled: [] });
  assert.strictEqual(r.cloud, MANUAL);
  assert.strictEqual(r.code, CODES.NO_CLOUD_ENABLED);
});

test('the platform-wide kill switch overrides everything, including a model pin', () => {
  const r = decide({
    modelCloud: 'aws',
    enabled: ['gcp', 'aws'],
    defaultCloud: 'aws',
    provisioningEnabled: false,
  });
  assert.strictEqual(r.cloud, MANUAL);
  assert.strictEqual(r.code, CODES.PROVISIONING_OFF);
});

/* ── A default that is switched off ──────────────────────────────────────── */

test('a switched-off default falls through to the only cloud that is on', () => {
  // Not a guess: there is exactly one answer, and sending it to a human
  // instead would be pedantry rather than safety.
  const r = decide({ enabled: ['aws'], defaultCloud: 'gcp' });
  assert.strictEqual(r.cloud, 'aws');
  assert.strictEqual(r.code, CODES.ONLY_CLOUD);
});

test('a default naming a cloud this build does not know is treated as no default', () => {
  // A removed cloud, or a hand-edited row. It must not route anywhere, and it
  // must not be mistaken for a valid-but-disabled default either — with two
  // clouds on and nothing saying which, the answer is the queue.
  const r = decide({ enabled: ['gcp', 'aws'], defaultCloud: 'azure' });
  assert.strictEqual(r.cloud, MANUAL);
  assert.strictEqual(r.code, CODES.AMBIGUOUS);
});

test('DEFAULT_CLOUD_OFF cannot be reached while only two clouds exist', () => {
  /*
   * Documenting a deliberate dead branch rather than leaving it to look live.
   * To reach it the default must be a REAL cloud that is off, with two or more
   * others on — impossible when there are only two clouds, since "two on"
   * means both are on. The branch is kept because it is the right answer the
   * day a third cloud is added; this test is what will start failing then,
   * which is the right moment to notice.
   */
  const everyPair = [
    { enabled: ['gcp'], defaultCloud: 'aws' },
    { enabled: ['aws'], defaultCloud: 'gcp' },
    { enabled: ['gcp', 'aws'], defaultCloud: 'gcp' },
    { enabled: ['gcp', 'aws'], defaultCloud: 'aws' },
  ];
  for (const c of everyPair) {
    assert.notStrictEqual(
      decide(c).code,
      CODES.DEFAULT_CLOUD_OFF,
      `${JSON.stringify(c)} reached a branch that should be unreachable — has a third cloud been added?`
    );
  }
});

/* ── Junk in, safe answer out ────────────────────────────────────────────── */

test('an unknown cloud name is never routed to', () => {
  for (const bad of ['azure', 'AWS ', '', null, undefined, 'manual', 'constructor']) {
    const r = decide({ modelCloud: bad, enabled: ['gcp'] });
    // Either it routes to the real cloud that is on, or to the queue — but
    // never to the junk string itself.
    assert.ok(r.cloud === 'gcp' || r.cloud === MANUAL, `${String(bad)} produced ${r.cloud}`);
  }
});

test('junk in the enabled list is ignored rather than routed to', () => {
  const r = decide({ enabled: ['azure', 'gcp', 'nonsense'] });
  assert.strictEqual(r.cloud, 'gcp');
});

test('a non-array enabled list is treated as none on', () => {
  for (const bad of [null, undefined, 'gcp', {}, 0]) {
    assert.strictEqual(decide({ enabled: bad }).cloud, MANUAL);
  }
});

test('calling with nothing at all still returns a usable answer', () => {
  for (const bad of [undefined, null, {}]) {
    const r = decide(bad);
    assert.strictEqual(r.cloud, MANUAL);
    assert.strictEqual(typeof r.code, 'string');
    assert.strictEqual(typeof r.reason, 'string');
  }
});

test('every branch returns a reason a human could act on', () => {
  const cases = [
    { enabled: [] },
    { enabled: ['gcp', 'aws'] },
    { enabled: ['gcp'], modelCloud: 'aws' },
    { enabled: ['gcp'] },
    { enabled: ['gcp', 'aws'], defaultCloud: 'azure' },
    { enabled: ['gcp'], provisioningEnabled: false },
  ];
  for (const c of cases) {
    const r = decide(c);
    assert.ok(r.reason.length > 20, `thin reason for ${JSON.stringify(c)}: "${r.reason}"`);
  }
});

/* ── The frozen field ────────────────────────────────────────────────────── */

test('an existing deployment\'s cloud comes from its frozen field', () => {
  assert.strictEqual(cloudOf({ cloudProvider: 'aws' }), 'aws');
  assert.strictEqual(cloudOf({ cloudProvider: 'gcp' }), 'gcp');
});

test('a deployment from before this column existed reads as manual', () => {
  // The honest answer: it was being fulfilled by hand, and it still is.
  for (const legacy of [{}, { cloudProvider: null }, { cloudProvider: '' }, null, undefined]) {
    assert.strictEqual(cloudOf(legacy), MANUAL);
  }
});

test('a frozen value that is not a known cloud reads as manual, not as itself', () => {
  // Data from a future version, or a hand-edited row. Routing a terminate to
  // a cloud this build has never heard of would throw somewhere worse.
  assert.strictEqual(cloudOf({ cloudProvider: 'azure' }), MANUAL);
});

test('the frozen field ignores what the settings now say', () => {
  // The whole point. Settings can change; a running machine cannot move.
  const deployment = { cloudProvider: 'aws' };
  assert.strictEqual(cloudOf(deployment), 'aws');
  // No settings argument exists to pass — the signature makes re-deriving
  // impossible rather than merely discouraged.
  assert.strictEqual(cloudOf.length, 1);
});

/* ── Reading the switches ────────────────────────────────────────────────── */

test('enabled clouds are read from each cloud\'s own settings block', () => {
  assert.deepStrictEqual(enabledClouds({ gcpSettings: { enabled: true } }), ['gcp']);
  assert.deepStrictEqual(enabledClouds({ awsSettings: { enabled: true } }), ['aws']);
  assert.deepStrictEqual(
    enabledClouds({ gcpSettings: { enabled: true }, awsSettings: { enabled: true } }),
    ['gcp', 'aws']
  );
  assert.deepStrictEqual(enabledClouds({}), []);
  assert.deepStrictEqual(enabledClouds(null), []);
});

test('a cloud is off unless it is explicitly on', () => {
  // Same rule as every other money switch on this platform: absent means off.
  for (const v of [false, null, undefined, 0, '']) {
    assert.deepStrictEqual(enabledClouds({ gcpSettings: { enabled: v } }), []);
  }
});
