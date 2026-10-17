/**
 * Tests for the three decisions around placing an instance: which region and
 * zone, what it is called, and what a failure means.
 *
 * All three only matter when something is unusual — a region nobody mapped, a
 * retry after a crash, a zone that ran out of GPUs — which is exactly why they
 * are pure and asserted here rather than discovered in production.
 *
 * Run with:  node --test src/services/gcp/__tests__/gcpPlacement.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const regions = require('../gcpRegionMap');
const naming = require('../gcpInstanceNaming');
const errors = require('../gcpErrorClassifier');

/* ── Regions ─────────────────────────────────────────────────────────────── */

test('the platform regions in the live catalogue all resolve', () => {
  for (const r of ['eu-central', 'us-east', 'ap-south']) {
    const got = regions.resolveRegion(r);
    assert.strictEqual(got.ok, true, `${r} should resolve`);
    assert.match(got.gcpRegion, /^[a-z]+-[a-z]+[0-9]$/, got.gcpRegion);
    assert.ok(got.zones.length >= 2, 'more than one zone, or a full zone stops the platform');
  }
});

test('"default" means "nobody chose", and resolves without failing a deployment', () => {
  // The Tier schema defaults `regions` to ['default'] and the controller copies
  // it straight through, so this value really does arrive.
  const got = regions.resolveRegion('default');
  assert.strictEqual(got.ok, true);
  assert.strictEqual(got.platformRegion, regions.DEFAULT_PLATFORM_REGION);
  assert.strictEqual(got.defaulted, true, 'the caller must be able to tell this was not a choice');
});

test('an unmapped region is refused, not quietly moved to Europe', () => {
  // A customer who picked ap-south because their data has to stay in India
  // must not silently get a machine in the Netherlands.
  const got = regions.resolveRegion('af-south');
  assert.strictEqual(got.ok, false);
  assert.strictEqual(got.code, 'REGION_NOT_MAPPED');
  assert.match(got.message, /env\.hcl/, 'the message should say where to add it');
});

test('an empty or missing region is treated as "default"', () => {
  for (const v of ['', null, undefined, '   ']) {
    assert.strictEqual(regions.resolveRegion(v).ok, true, JSON.stringify(v));
  }
});

/* ── Zones ───────────────────────────────────────────────────────────────── */

test('the same deployment always gets the same zone on its first attempt', () => {
  const { zones } = regions.resolveRegion('eu-central');
  const a = regions.pickZone({ zones, deploymentId: 'dep-abc', attempt: 0 });
  const b = regions.pickZone({ zones, deploymentId: 'dep-abc', attempt: 0 });
  assert.strictEqual(a, b, 'a wandering first attempt could leave two machines for one order');
  assert.ok(zones.includes(a));
});

test('different deployments spread across zones rather than piling into the first', () => {
  const { zones } = regions.resolveRegion('eu-central');
  const picked = new Set(
    Array.from({ length: 40 }, (_, i) => regions.pickZone({ zones, deploymentId: `dep-${i}`, attempt: 0 })),
  );
  assert.ok(picked.size > 1, `all 40 landed in ${[...picked]}`);
});

test('a retry moves to the next zone', () => {
  const { zones } = regions.resolveRegion('eu-central');
  const first = regions.pickZone({ zones, deploymentId: 'dep-abc', attempt: 0 });
  const second = regions.pickZone({ zones, deploymentId: 'dep-abc', attempt: 1 });
  assert.notStrictEqual(first, second, 'retrying the zone that just said "no capacity" is pointless');
});

test('after one full lap the region is declared exhausted', () => {
  const { zones } = regions.resolveRegion('eu-central');
  assert.strictEqual(regions.exhaustedZones({ zones, attempt: zones.length - 1 }), false);
  assert.strictEqual(regions.exhaustedZones({ zones, attempt: zones.length }), true);
});

test('this file and the Terraform subnets name the same GCP regions', () => {
  // The regions in infra/gcp/live/staging/env.hcl. A region mapped here with no
  // subnet there fails at instances.insert with "subnetwork not found", on a
  // real customer's deployment.
  const subnetRegions = ['europe-west4', 'us-east4', 'asia-south1'];
  const check = regions.assertConsistentWith(subnetRegions);
  assert.strictEqual(check.ok, true, check.message);
});

/* ── Names and labels ────────────────────────────────────────────────────── */

test('the instance name is derived from the deployment, so GCP enforces idempotency', () => {
  const id = '11664bf9-ca11-4c5e-8fd6-c1fcfd01a987';
  assert.strictEqual(naming.instanceName(id), naming.instanceName(id));
  assert.ok(naming.isValidName(naming.instanceName(id)), naming.instanceName(id));
});

test('instance names satisfy GCP rules for ids that look nothing like a UUID', () => {
  for (const id of ['abc', '00000000-0000-0000-0000-000000000000', 'A-B-C', '9deadbeef']) {
    const name = naming.instanceName(id);
    assert.ok(naming.isValidName(name), `${id} -> ${name}`);
    assert.ok(name.length <= naming.MAX_NAME_LENGTH);
  }
});

test('an empty deployment id is a bug and is raised as one', () => {
  assert.throws(() => naming.instanceName(''));
  assert.throws(() => naming.instanceName(null));
});

test('a name round-trips back to its deployment id', () => {
  const id = '11664bf9-ca11-4c5e-8fd6-c1fcfd01a987';
  assert.strictEqual(naming.deploymentIdFromName(naming.instanceName(id)), id);
});

test('an instance that is not ours is never mistaken for a deployment', () => {
  // The orphan sweep deletes what it believes is abandoned. Someone's manual
  // test box in the same project must not look like one of ours.
  assert.strictEqual(naming.isOurs('my-test-box'), false);
  assert.strictEqual(naming.deploymentIdFromName('my-test-box'), null);
  assert.strictEqual(naming.deploymentIdFromName('aio-'), null);
});

test('labels carry what the orphan sweep and the cost report need', () => {
  const labels = naming.instanceLabels({
    deploymentId: '11664bf9-ca11-4c5e-8fd6-c1fcfd01a987',
    teamId: '354d2e25-db7c-40ce-8afd-42a099f78802',
    environment: 'staging',
  });
  assert.strictEqual(labels['managed-by'], naming.MANAGED_BY);
  assert.strictEqual(labels['deployment-id'], '11664bf9-ca11-4c5e-8fd6-c1fcfd01a987');
  assert.ok(labels['team-id']);
  assert.ok(naming.managedInstanceFilter('staging').includes(naming.MANAGED_BY));
});

test('label values are normalised to what GCP accepts', () => {
  const labels = naming.instanceLabels({
    deploymentId: 'Weird ID!! With Spaces',
    teamId: 'Ünïcode@Team',
    environment: 'Staging',
  });
  for (const [k, v] of Object.entries(labels)) {
    assert.match(v, /^[a-z0-9_-]*$/, `${k}=${v}`);
    assert.ok(v.length <= 63);
  }
});

test('the boot disk is named from the instance, so a retry reuses it too', () => {
  const id = 'dep-1';
  assert.strictEqual(naming.bootDiskName(id), `${naming.instanceName(id)}-boot`);
});

/* ── Failures ────────────────────────────────────────────────────────────── */

test('an existing instance is adopted, never duplicated', () => {
  const r = errors.classify({ code: 'RESOURCE_ALREADY_EXISTS', message: 'The resource already exists' });
  assert.strictEqual(r.action, 'adopt');
  assert.strictEqual(r.requiresHumanAction, false);
});

test('a zone with no capacity moves to the next zone rather than retrying in place', () => {
  const r = errors.classify({ code: 'ZONE_RESOURCE_POOL_EXHAUSTED', message: 'no A100 capacity' });
  assert.strictEqual(r.action, 'move_zone');
  assert.strictEqual(r.retryable, true);
});

test('quota exhaustion stops and asks for a human — it will never succeed on retry', () => {
  const r = errors.classify({ code: 'QUOTA_EXCEEDED', message: 'Quota GPUS_ALL_REGIONS exceeded' });
  assert.strictEqual(r.action, 'fail');
  assert.strictEqual(r.retryable, false);
  assert.strictEqual(r.requiresHumanAction, true);
  assert.match(r.message, /quota/i);
});

test('a missing permission names what to check', () => {
  const r = errors.classify({ code: 'PERMISSION_DENIED', message: 'compute.instances.create denied' });
  assert.strictEqual(r.action, 'fail');
  assert.match(r.message, /instanceAdmin|actAs/);
});

test('a 500 or a dropped connection is retried', () => {
  for (const e of [{ status: 503 }, { status: 500 }, { code: 'ECONNRESET' }, { status: 429 }]) {
    assert.strictEqual(errors.classify(e).action, 'retry', JSON.stringify(e));
  }
});

test('an unrecognised failure is treated as permanent, not retried forever', () => {
  const r = errors.classify({ code: 'SOMETHING_NOBODY_HAS_SEEN', message: 'what' });
  assert.strictEqual(r.action, 'fail');
  assert.strictEqual(r.requiresHumanAction, true);
  assert.match(r.message, /Unrecognised/);
});

test('failures are read out of whichever shape the SDK used', () => {
  assert.strictEqual(errors.classify({ errors: [{ reason: 'QUOTA_EXCEEDED' }] }).action, 'fail');
  assert.strictEqual(errors.classify({ operationError: { code: 'ZONE_RESOURCE_POOL_EXHAUSTED' } }).action, 'move_zone');
  assert.strictEqual(errors.classify({ response: { data: { error: { code: 503 } } } }).action, 'retry');
});

test('backoff grows, is capped, and does not put every retry on the same tick', () => {
  assert.ok(errors.backoffSeconds(0) < errors.backoffSeconds(3));
  assert.ok(errors.backoffSeconds(99) <= 900 * 1.2);
  const a = errors.backoffSeconds(2, { seed: 1 });
  const b = errors.backoffSeconds(2, { seed: 7 });
  assert.notStrictEqual(a, b, 'a batch that failed together should not come back together');
  assert.strictEqual(errors.backoffSeconds(2, { seed: 7 }), b, 'and the spread must be deterministic');
});
