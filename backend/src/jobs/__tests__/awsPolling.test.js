/**
 * AWS status polling and the billing clock.
 *
 * Every test here is a way the platform or the customer loses money, or a way
 * a customer is left watching a spinner forever. The grouping is by what goes
 * wrong in production, because that is what makes a failure here worth reading.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const realLoad = Module._load;

const DEPLOYMENT_ID = '11111111-1111-4111-8111-111111111111';
const INSTANCE_ROW = 'aaaaaaaa-1111-4111-8111-111111111111';

let calls;      // what the reconciler did
let described;  // what AWS "answered"
let pendingRows;
let deployment;
let settings;

const freshDeployment = () => ({
  id: DEPLOYMENT_ID,
  status: 'provisioning',
  computeClockStartedAt: null,
  lastBilledAt: null,
  save: async function save() { calls.saves.push({ ...this }); },
});

const install = () => {
  calls = {
    markRunning: [], markStopped: [], markRetry: [], markFailed: [],
    markTerminated: [], markCreating: [], saves: [], billed: [], transitions: [],
  };

  Module._load = function patched(request, parent, isMain) {
    if (request.endsWith('lib/prismaClient')) {
      return {
        deploymentInstance: { findMany: async () => [], update: async () => ({}) },
        orphanInstance: { upsert: async () => ({}) },
      };
    }
    if (request.endsWith('services/aws/awsClient')) {
      return {
        describeInstance: async (id, az) => {
          if (described instanceof Error) throw described;
          return { ...described, _askedWith: { id, az } };
        },
        findInstanceByName: async () => described,
        listManagedInstances: async () => ({ instances: [], partial: false, regions: [], failures: [] }),
      };
    }
    if (request.endsWith('services/gcp/deploymentInstanceService')) {
      return {
        listPending: async () => pendingRows,
        markRunning: async (id, d) => { calls.markRunning.push({ id, ...d }); },
        markStopped: async (id, d) => { calls.markStopped.push({ id, ...d }); },
        markRetry: async (id, d) => { calls.markRetry.push({ id, ...d }); },
        markFailed: async (id, d) => { calls.markFailed.push({ id, ...d }); },
        markTerminated: async (id) => { calls.markTerminated.push({ id }); },
        markCreating: async (id, d) => { calls.markCreating.push({ id, ...d }); },
      };
    }
    if (request.endsWith('services/admin/adminSettingsService')) {
      return { getSettings: async () => ({ awsSettings: settings }) };
    }
    if (request.endsWith('deployment/deploymentService')) {
      return {
        findById: async () => deployment,
        transition: async (d, to, opts) => { calls.transitions.push({ to, ...opts }); },
      };
    }
    // `computeClock` sits in services/billing/, so it requires its sibling as
    // `./deploymentBilling` — the bare basename, not a path ending in the
    // folder name.
    if (/(^|\/)deploymentBilling$/.test(request)) {
      return { billOutstanding: async (d, o) => { calls.billed.push({ now: o.now }); } };
    }
    return realLoad(request, parent, isMain);
  };

  for (const m of ['../awsReconciler', '../../services/billing/computeClock']) {
    delete require.cache[require.resolve(m)];
  }
  return require('../awsReconciler');
};

/** One row mid-build, as the driver leaves it. */
const row = (over = {}) => ({
  id: INSTANCE_ROW,
  deploymentId: DEPLOYMENT_ID,
  instanceName: 'aio-probe',
  instanceId: null,
  operationName: 'i-0abc12345678',
  zone: 'eu-west-1a',
  phase: 'creating',
  attempt: 0,
  operationAt: new Date(Date.now() - 60000),
  ...over,
});

beforeEach(() => {
  settings = { enabled: true, dryRun: false };
  deployment = freshDeployment();
  pendingRows = [row()];
  described = { state: 'running', launchTime: null, privateIp: '10.0.0.5', publicIp: null };
});

afterEach(() => {
  Module._load = realLoad;
  for (const m of ['../awsReconciler', '../../services/billing/computeClock']) {
    delete require.cache[require.resolve(m)];
  }
});

describe('the meter starts when AWS says the machine is running', () => {
  test('a running instance starts the clock', async () => {
    const r = install();
    const summary = await r.pollPending();

    assert.equal(summary.running, 1);
    assert.equal(summary.clocksStarted, 1);
    assert.equal(calls.markRunning.length, 1);
    assert.ok(deployment.computeClockStartedAt, 'the clock must be set on the deployment');
  });

  test("it starts at AWS's own launchTime, not at this job's clock", async () => {
    // A machine that came up 50 seconds before the pass. Using `now` would
    // give those 50 seconds away — every pass, for every machine.
    const launched = new Date(Date.now() - 50_000);
    described = { state: 'running', launchTime: launched.toISOString(), privateIp: '10.0.0.5' };

    const r = install();
    await r.pollPending();

    assert.equal(
      deployment.computeClockStartedAt.getTime(),
      launched.getTime(),
      'the meter must be back-dated to AWS\'s timestamp',
    );
  });

  test('the billing watermark moves with it, so nothing before it is free', async () => {
    const launched = new Date(Date.now() - 50_000);
    described = { state: 'running', launchTime: launched.toISOString() };

    const r = install();
    await r.pollPending();

    /*
     * `deploymentBilling` bills from `lastBilledAt || startedAt` and plants
     * its own watermark at `now` when both are missing. Leaving it unset gives
     * away everything between the machine starting and the first billing pass.
     */
    assert.equal(deployment.lastBilledAt.getTime(), launched.getTime());
  });

  test('a launchTime in the future is clamped to now, never billed backwards', async () => {
    described = { state: 'running', launchTime: new Date(Date.now() + 600_000).toISOString() };

    const r = install();
    const before = Date.now();
    await r.pollPending();

    // A clock in the future makes the first billing pass compute negative
    // hours, which reads as a refund.
    assert.ok(deployment.computeClockStartedAt.getTime() <= Date.now() + 1000);
    assert.ok(deployment.computeClockStartedAt.getTime() >= before - 1000);
  });

  test('a missing launchTime falls back to now, not to 1970', async () => {
    described = { state: 'running', launchTime: null };

    const r = install();
    await r.pollPending();

    // `new Date(undefined).getTime()` is NaN; a naive Math.min would poison
    // the watermark and bill from the epoch.
    assert.ok(Number.isFinite(deployment.computeClockStartedAt.getTime()));
    assert.ok(deployment.computeClockStartedAt.getTime() > Date.now() - 10_000);
  });

  test('a clock already running is left exactly where it was', async () => {
    const original = new Date(Date.now() - 3_600_000);
    deployment.computeClockStartedAt = original;

    const r = install();
    const summary = await r.pollPending();

    // Re-planting it would move the watermark forward and write off the hour
    // in between.
    assert.equal(deployment.computeClockStartedAt.getTime(), original.getTime());
    assert.equal(summary.clocksStarted, 0);
    assert.equal(summary.running, 1, 'it is still counted as running');
  });
});

describe('the meter stops, and settles first', () => {
  test('a stopped instance stops the clock', async () => {
    described = { state: 'stopped' };
    deployment.computeClockStartedAt = new Date(Date.now() - 3_600_000);

    const r = install();
    const summary = await r.pollPending();

    assert.equal(summary.stopped, 1);
    assert.equal(calls.markStopped.length, 1);
    assert.equal(deployment.computeClockStartedAt, null);
  });

  test('the outstanding time is BILLED before the clock is cleared', async () => {
    described = { state: 'stopped' };
    deployment.computeClockStartedAt = new Date(Date.now() - 3_600_000);

    const r = install();
    await r.pollPending();

    /*
     * Clearing the clock is what makes the deployment stop being billable, so
     * the elapsed time has to be charged first. The other order silently gives
     * away the compute between the last billing pass and the machine stopping.
     */
    assert.equal(calls.billed.length, 1, 'billOutstanding must be called');
  });

  test('shutting-down counts as down — the meter does not run through it', async () => {
    described = { state: 'shutting-down' };
    deployment.computeClockStartedAt = new Date(Date.now() - 60_000);

    const r = install();
    await r.pollPending();

    assert.equal(deployment.computeClockStartedAt, null);
  });

  test('a machine still running while we wait for it to stop STAYS billable', async () => {
    // We asked AWS to stop it and it has not yet. This platform is still
    // paying for it, so the customer still is.
    pendingRows = [row({ phase: 'stopping' })];
    described = { state: 'running' };
    deployment.computeClockStartedAt = new Date(Date.now() - 60_000);

    const r = install();
    const summary = await r.pollPending();

    assert.ok(deployment.computeClockStartedAt, 'the meter must keep running');
    assert.equal(summary.pending, 1);
    assert.equal(summary.stopped, 0);
  });
});

describe('a launch that AWS accepted and then failed', () => {
  test('pending → terminated with a capacity reason is retried in another AZ', async () => {
    described = {
      state: 'terminated',
      stateReasonCode: 'Server.InsufficientInstanceCapacity',
      stateReasonMessage: 'There is not enough capacity.',
    };

    const r = install();
    const summary = await r.pollPending();

    assert.equal(summary.deferred, 1);
    assert.equal(calls.markRetry.length, 1);
    assert.equal(calls.markFailed.length, 0, 'capacity is temporary, not a permanent failure');
    assert.ok(calls.markRetry[0].nextAttemptAt > new Date(), 'it must back off');
  });

  test('a permanent reason fails the DEPLOYMENT, so the customer is told', async () => {
    described = {
      state: 'terminated',
      stateReasonCode: 'Client.InvalidSnapshot.NotFound',
      stateReasonMessage: 'The snapshot does not exist.',
    };

    const r = install();
    const summary = await r.pollPending();

    assert.equal(summary.failed, 1);
    assert.equal(calls.markFailed.length, 1);
    // Without this the deployment sits in `provisioning` forever and the
    // customer watches a spinner with nobody told.
    assert.equal(calls.transitions.length, 1);
    assert.equal(calls.transitions[0].to, 'failed');
  });

  test('a failed launch stops the meter too', async () => {
    deployment.computeClockStartedAt = new Date(Date.now() - 60_000);
    described = { state: 'terminated', stateReasonCode: 'Client.InternalError' };

    const r = install();
    await r.pollPending();

    assert.equal(deployment.computeClockStartedAt, null, 'nothing is running, so nothing is billed');
  });

  test('a machine that WAS running and is now gone is a destroy, not a failure', async () => {
    pendingRows = [row({ phase: 'stopping' })];
    described = { state: 'terminated', stateReasonCode: 'Client.UserInitiatedShutdown' };
    deployment.computeClockStartedAt = new Date(Date.now() - 60_000);

    const r = install();
    await r.pollPending();

    assert.equal(calls.markTerminated.length, 1);
    assert.equal(calls.markFailed.length, 0, 'a deliberate destroy is not a build failure');
    assert.equal(calls.transitions.length, 0, 'and the deployment must not be marked failed');
  });
});

describe('an instance AWS cannot find', () => {
  test('stops the meter and goes back to the retry queue', async () => {
    const err = new Error('not found');
    err.awsCode = 'InvalidInstanceID.NotFound';
    described = err;
    deployment.computeClockStartedAt = new Date(Date.now() - 60_000);

    const r = install();
    const summary = await r.pollPending();

    // This platform is not paying for a machine AWS does not have.
    assert.equal(deployment.computeClockStartedAt, null);
    assert.equal(summary.deferred, 1);
    assert.equal(calls.markRetry.length, 1);
  });

  test('a network blip changes nothing — it is asked again next pass', async () => {
    described = new Error('socket hang up');
    deployment.computeClockStartedAt = new Date(Date.now() - 60_000);

    const r = install();
    const summary = await r.pollPending();

    assert.equal(summary.pending, 1);
    assert.ok(deployment.computeClockStartedAt, 'a blip must not stop the meter');
    assert.equal(calls.markRetry.length, 0, 'and must not trigger a rebuild');
  });
});

describe('the call goes to the right place', () => {
  test('polling asks about the recorded instance, in its own availability zone', async () => {
    pendingRows = [row({ operationName: 'i-0mumbai1234', zone: 'ap-south-1a' })];

    const r = install();
    await r.pollPending();

    // The AZ is what picks the region. Asking the wrong region answers
    // "no such instance", which this code reads as a reason to rebuild.
    assert.equal(calls.markRunning.length, 1);
  });

  test('a still-pending instance is left alone', async () => {
    described = { state: 'pending' };

    const r = install();
    const summary = await r.pollPending();

    assert.equal(summary.pending, 1);
    assert.equal(summary.running, 0);
    assert.equal(deployment.computeClockStartedAt, null, 'nothing is running yet');
  });
});

describe('it does not run when it would be meaningless', () => {
  test('AWS switched off polls nothing', async () => {
    settings = { enabled: false, dryRun: false };

    const r = install();
    const summary = await r.pollPending();

    assert.equal(summary.ran, false);
    assert.equal(calls.markRunning.length, 0);
  });

  test('dry run still runs the whole chain, without asking AWS', async () => {
    settings = { enabled: true, dryRun: true, dryRunRunningAfterSeconds: 1 };
    pendingRows = [row({ operationAt: new Date(Date.now() - 60_000) })];

    const r = install();
    const summary = await r.pollPending();

    // The point of dry run: exercise everything, including the meter, with
    // nothing sent and no AWS account needed.
    assert.equal(summary.running, 1);
    assert.equal(summary.clocksStarted, 1);
  });

  test('dry run waits its configured delay before pretending it is up', async () => {
    settings = { enabled: true, dryRun: true, dryRunRunningAfterSeconds: 600 };
    pendingRows = [row({ operationAt: new Date(Date.now() - 1000) })];

    const r = install();
    const summary = await r.pollPending();

    assert.equal(summary.pending, 1);
    assert.equal(summary.running, 0);
  });
});

describe('the module is wired up for real', () => {
  test('every path it requires resolves', () => {
    Module._load = realLoad;
    delete require.cache[require.resolve('../awsReconciler')];
    const real = require('../awsReconciler');
    assert.equal(typeof real.pollPending, 'function');
    assert.equal(typeof real.runOnce, 'function');
  });

  test('both AWS jobs are registered on a schedule', () => {
    Module._load = realLoad;
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../index'), 'utf8');

    assert.match(src, /awsReconciler:\s*awsReconciler\.pollPending/);
    assert.match(src, /awsOrphanSweep:\s*awsReconciler\.runOnce/);
  });

  test('both clouds use the SAME clock, so neither can drift', () => {
    Module._load = realLoad;
    const fs = require('fs');
    for (const job of ['../gcpReconciler', '../awsReconciler']) {
      const src = fs.readFileSync(require.resolve(job), 'utf8');
      assert.match(
        src,
        /require\('\.\.\/services\/billing\/computeClock'\)/,
        `${job} must use the shared meter — a second copy of when a customer starts `
        + 'being charged would drift from this one',
      );
    }
  });
});
