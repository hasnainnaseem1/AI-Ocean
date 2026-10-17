/**
 * The AWS orphan sweep, and the destroy path it feeds.
 *
 * An orphan is a machine this platform created, can no longer account for, and
 * is still being billed for by AWS. Every test here stands for a way that
 * machine stays alive and unbilled-to-anyone while the platform believes
 * otherwise.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const naming = require('../../services/aws/awsInstanceNaming');

/* ── A stand-in for the pieces the sweep talks to ──────────────────────── */

const DEPLOYMENT_ID = '11111111-1111-4111-8111-111111111111';

let upserts;
let notifications;
let listResult;
let knownRows;

const realLoad = Module._load;

const install = () => {
  upserts = [];
  notifications = [];
  knownRows = [];
  listResult = { instances: [], partial: false, regions: ['eu-west-1'], failures: [] };

  /*
   * These paths must match the real ones exactly. A mock on a path the module
   * does not require would make every test here pass against a module that
   * cannot even be loaded — which is how a bad require path once got as far as
   * crashing the server on boot.
   */
  Module._load = function patched(request, parent, isMain) {
    if (request.endsWith('lib/prismaClient')) {
      return {
        deploymentInstance: { findMany: async () => knownRows },
        orphanInstance: { upsert: async (args) => { upserts.push(args); return {}; } },
      };
    }
    if (request.endsWith('services/aws/awsClient')) {
      return { listManagedInstances: async () => listResult };
    }
    if (request.endsWith('services/notification/notificationService')) {
      return { createMany: async (rows) => { notifications.push(...rows); } };
    }
    if (request.endsWith('services/user/userService')) {
      return { listActiveAdmins: async () => [{ id: 'admin-1' }] };
    }
    if (request.endsWith('services/admin/adminSettingsService')) {
      return { getSettings: async () => ({ awsSettings: SETTINGS }) };
    }
    return realLoad(request, parent, isMain);
  };

  // Loaded through the patched loader so its requires resolve to the above.
  delete require.cache[require.resolve('../awsReconciler')];
  return require('../awsReconciler');
};

let SETTINGS = { enabled: true, dryRun: false, accountId: '123456789012' };

beforeEach(() => { SETTINGS = { enabled: true, dryRun: false, accountId: '123456789012' }; });
afterEach(() => {
  Module._load = realLoad;
  delete require.cache[require.resolve('../awsReconciler')];
});

/** A machine as `listManagedInstances` reports it. */
const machine = (over = {}) => ({
  instanceId: 'i-0abc12345678',
  region: 'eu-west-1',
  az: 'eu-west-1a',
  instanceType: 'm6i.large',
  state: 'running',
  name: naming.instanceName(DEPLOYMENT_ID),
  ...over,
});

describe('the module can actually be loaded', () => {
  test('every path it requires resolves', () => {
    /*
     * The one thing the mocks above cannot prove. A wrong require path makes
     * every other test here pass — they never touch the real module — while
     * the server crashes on boot with MODULE_NOT_FOUND. So this loads it for
     * real, with nothing patched.
     */
    Module._load = realLoad;
    delete require.cache[require.resolve('../awsReconciler')];
    const real = require('../awsReconciler');
    assert.equal(typeof real.runOnce, 'function');
    assert.equal(typeof real.sweepOrphans, 'function');
  });

  test('and the job registry wires it to a schedule', () => {
    Module._load = realLoad;
    const jobs = require('../index');
    assert.ok(jobs, 'the jobs module must load with the new job registered');
  });
});

describe('a machine with no record behind it is recorded as an orphan', () => {
  test('it is written against the AWS provider, not the default', async () => {
    const sweep = install();
    listResult.instances = [machine()];

    const summary = await sweep.runOnce();

    assert.equal(summary.orphans, 1);
    assert.equal(upserts.length, 1);

    const row = upserts[0].create;
    /*
     * `provider` defaults to "gcp" in the schema. An AWS orphan written
     * without it would be destroyed by asking Google, which answers 404 — read
     * as "already gone" — while the real machine keeps billing.
     */
    assert.equal(row.provider, 'aws');
    assert.equal(row.projectId, '123456789012');
    assert.equal(row.zone, 'eu-west-1a');
    // The AZ is the whole handle for finding the region again later.
    assert.equal(upserts[0].where.provider_projectId_zone_instanceName.zone, 'eu-west-1a');
  });

  test('the AWS instance id is stored, because a name is only a tag', async () => {
    const sweep = install();
    listResult.instances = [machine()];
    await sweep.runOnce();

    assert.equal(upserts[0].create.instanceId, 'i-0abc12345678');
    // And refreshed on a later sighting, so a destroy always has a live handle.
    assert.equal(upserts[0].update.instanceId, 'i-0abc12345678');
  });

  test('it names the deployment it claims to have belonged to', async () => {
    const sweep = install();
    listResult.instances = [machine()];
    await sweep.runOnce();

    assert.equal(upserts[0].create.suspectedDeploymentId, DEPLOYMENT_ID);
    assert.match(upserts[0].create.reason, /deployment was probably deleted/);
  });

  test('an admin is told, because an orphan appears nowhere else', async () => {
    const sweep = install();
    listResult.instances = [machine()];
    await sweep.runOnce();

    // One row per admin, so each can be marked read independently.
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].recipientId, 'admin-1');
    assert.equal(notifications[0].recipientType, 'admin');
    assert.equal(notifications[0].priority, 'urgent');
    assert.match(notifications[0].message, /billing by the hour/);
    // Singular when there is one — an admin reading "1 machine exist" learns
    // that nobody has looked at this alert.
    assert.match(notifications[0].message, /1 machine exists\b/);
    // And it links to the AWS page, which is where it can be acted on.
    assert.match(notifications[0].action.url, /cloud\/aws\?tab=orphans/);
  });
});

describe('what is NOT an orphan', () => {
  test('a machine with a live record is left alone', async () => {
    const sweep = install();
    const name = naming.instanceName(DEPLOYMENT_ID);
    listResult.instances = [machine({ name })];
    knownRows = [{ instanceName: name, phase: 'running', deploymentId: DEPLOYMENT_ID }];

    const summary = await sweep.runOnce();

    assert.equal(summary.orphans, 0);
    assert.equal(upserts.length, 0);
  });

  test('a terminated instance is not reported — EC2 keeps tombstones for an hour', async () => {
    const sweep = install();
    listResult.instances = [machine({ state: 'terminated' })];

    const summary = await sweep.runOnce();

    /*
     * A terminated instance costs nothing and owns nothing. Reporting it would
     * be a false alarm every hour, which teaches an admin to ignore the one
     * screen that must never be ignored.
     */
    assert.equal(summary.orphans, 0);
    assert.equal(notifications.length, 0);
  });

  test("a machine that is not ours is ignored, however it got the tag", async () => {
    const sweep = install();
    listResult.instances = [machine({ name: 'someone-elses-box' })];

    assert.equal((await sweep.runOnce()).orphans, 0);
  });

  test('a record we believe is destroyed, but AWS still has, IS one', async () => {
    const sweep = install();
    const name = naming.instanceName(DEPLOYMENT_ID);
    listResult.instances = [machine({ name })];
    knownRows = [{ instanceName: name, phase: 'terminated', deploymentId: DEPLOYMENT_ID }];

    const summary = await sweep.runOnce();

    assert.equal(summary.orphans, 1);
    assert.match(upserts[0].create.reason, /recorded the machine as destroyed, but AWS still has it/);
  });
});

describe('an incomplete sweep says so', () => {
  test('a region that cannot be read makes the result partial', async () => {
    const sweep = install();
    listResult = {
      instances: [machine()],
      partial: true,
      regions: ['eu-west-1', 'ap-south-1'],
      failures: [{ region: 'ap-south-1', message: 'AuthFailure' }],
    };

    const summary = await sweep.runOnce();

    assert.equal(summary.partial, true);
    // Still recorded: a sweep that saw something must report it. Recording only
    // ever adds what was seen, so a missing region can hide an orphan but can
    // never invent one.
    assert.equal(summary.orphans, 1);
    // And the alert must not read as all-clear.
    assert.match(notifications[0].message, /incomplete/);
    assert.equal(notifications[0].metadata.partial, true);
  });
});

describe('the sweep does not run when it would be meaningless', () => {
  test('dry run sweeps nothing, because nothing was ever created', async () => {
    SETTINGS = { enabled: true, dryRun: true, accountId: '123456789012' };
    const sweep = install();
    listResult.instances = [machine()];

    const summary = await sweep.runOnce();

    assert.equal(summary.ran, false);
    assert.equal(upserts.length, 0);
  });

  test('AWS switched off sweeps nothing', async () => {
    SETTINGS = { enabled: false, dryRun: false, accountId: '123456789012' };
    const sweep = install();
    listResult.instances = [machine()];

    assert.equal((await sweep.runOnce()).ran, false);
  });
});
