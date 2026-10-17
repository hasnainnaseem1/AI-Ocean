/**
 * GCP Reconciler
 *
 * Finds out what actually happened on Google Cloud, and makes this database
 * agree with it.
 *
 * ── Why a cron job and not a callback ──
 *
 * `instances.insert` returns in about a second with an *operation*; the machine
 * takes 30 to 90 seconds to exist. There is no queue in this project — no
 * Redis, no BullMQ — and the established pattern for "something will be true
 * later" is a node-cron reconciler whose every decision is **due and not yet
 * done** (see `collectionSchedule.js` and `debtCollection.js`). So this asks
 * "what has an open question?" rather than "has a minute passed?", which means
 * a run that comes late does the work the missed run should have done, and a
 * run that happens twice changes nothing the first did not.
 *
 * ── The money moment ──
 *
 * One line in this file is the reason the whole GCP project was sequenced the
 * way it was:
 *
 *     deployment.computeClockStartedAt = runningAt
 *
 * From that instant the platform is paying Google, so from that instant the
 * customer is charged — even though the deployment is still `provisioning`,
 * nothing is configured inside the machine, and no endpoint has been handed
 * over. `runningAt` comes from **GCP's own operation timestamp**, never from
 * this process's clock: this job might notice a machine four minutes after it
 * started, and billing from "when we noticed" would charge a customer for our
 * polling interval.
 *
 * `lastBilledAt` is planted at the same instant. It is the billing watermark,
 * and `deploymentBilling` refuses to bill from an unknown start point — so
 * without this, the first billing pass would plant the watermark at its own
 * `now` and quietly give away everything before it.
 *
 * ── The orphan sweep ──
 *
 * A machine that exists on GCP with our label and no live deployment behind it
 * bills forever and appears in no screen. The sweep **records** those; it never
 * deletes them. Destroying a customer's machine because our own bookkeeping
 * lost track of it is exactly the operation that must not be automatic — a bug
 * in the sweep would then destroy live workloads. It raises; an admin decides.
 */
const prisma = require('../lib/prismaClient');
const gcpClient = require('../services/gcp/gcpClient');
const instanceStore = require('../services/gcp/deploymentInstanceService');
const gcpDriver = require('../services/gcp/gcpDriver');
const classifier = require('../services/gcp/gcpErrorClassifier');
const naming = require('../services/gcp/gcpInstanceNaming');
const adminSettingsService = require('../services/admin/adminSettingsService');

/** How long a machine may sit mid-build before a human is told. */
const STALE_AFTER_MINUTES = 20;

/* ────────────────────────────────────────────────────────────────────────────
 * The decisions, with no I/O in them
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * What does a Compute long-running operation tell us?
 *
 * Separated out because the three outcomes — still going, finished, finished
 * badly — are the whole logic of this job, and GCP's shape for them is fiddly
 * enough to be worth asserting directly: `status` is a string, the error lives
 * at `error.errors[0]`, and a DONE operation with an error in it is a failure
 * even though `httpErrorStatusCode` may be absent.
 *
 * @returns {{state: 'pending'|'done'|'error', at: Date|null, error: object|null}}
 */
const readOperation = (op) => {
  if (!op) return { state: 'pending', at: null, error: null };

  const firstError = op.error?.errors?.[0] || null;
  if (firstError) {
    return {
      state: 'error',
      at: op.endTime ? new Date(op.endTime) : null,
      error: {
        code: firstError.code || op.httpErrorMessage || 'OPERATION_FAILED',
        message: firstError.message || op.httpErrorMessage || 'The operation failed.',
        status: op.httpErrorStatusCode || null,
      },
    };
  }

  if (op.status === 'DONE') {
    /*
     * `endTime` is when GCP finished, and it is the only timestamp that can
     * honestly start a customer's meter. A DONE operation without one is
     * possible in principle, and the caller falls back — but it falls back to
     * `insertTime`/`startTime` before it falls back to our own clock, because
     * every one of those is closer to the truth than "now".
     */
    const at = op.endTime || op.startTime || op.insertTime;
    return { state: 'done', at: at ? new Date(at) : null, error: null };
  }

  return { state: 'pending', at: null, error: null };
};

/**
 * Has a dry-run instance "finished" building?
 *
 * Dry run exists so the entire chain — including the money — can be exercised
 * before an account exists. That means a dry-run machine has to start reporting
 * RUNNING at some point, and `dryRunRunningAfterSeconds` is how long it
 * pretends to take.
 */
const dryRunReady = (instance, { afterSeconds, now }) => {
  const from = instance.operationAt || instance.requestedAt || instance.createdAt;
  if (!from) return false;
  return now.getTime() - new Date(from).getTime() >= Math.max(0, Number(afterSeconds) || 0) * 1000;
};

const isDryRunOperation = (name) => typeof name === 'string' && name.startsWith('dryrun-');

/* ────────────────────────────────────────────────────────────────────────────
 * Starting and stopping the meter
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The machine is up: start charging for it.
 *
 * Written through `deploymentService`'s wrapper rather than with a raw Prisma
 * update, because `Deployment` is behind a hand-rolled ORM whose `save()`
 * writes from an in-memory snapshot — a raw update here would be overwritten by
 * the next `save()` anywhere else.
 *
 * Idempotent: a clock that is already running is left exactly where it is.
 * Re-planting it would move the watermark forward and write off the hours in
 * between.
 */
const startComputeClock = async (deploymentId, runningAt) => {
  const deploymentService = require('../services/deployment/deploymentService');
  const deployment = await deploymentService.findById(deploymentId);
  if (!deployment) return { started: false, reason: 'deployment is gone' };

  if (deployment.computeClockStartedAt) {
    return { started: false, reason: 'already running', at: deployment.computeClockStartedAt };
  }

  // Never ahead of the present. A clock in the future would make the first
  // billing pass compute negative hours.
  const at = new Date(Math.min(new Date(runningAt).getTime(), Date.now()));

  deployment.computeClockStartedAt = at;
  /*
   * The watermark. `deploymentBilling` bills from `lastBilledAt || startedAt`
   * and plants its own watermark at `now` when both are missing — so leaving
   * this unset would give away everything between the machine starting and the
   * first billing pass noticing. Only moved forward, never back.
   */
  if (!deployment.lastBilledAt || new Date(deployment.lastBilledAt) < at) {
    deployment.lastBilledAt = at;
  }
  await deployment.save();

  return { started: true, at };
};

/**
 * The machine is down: stop charging compute for it.
 *
 * Clearing the clock is what makes `isComputeBillable` false again, so the
 * elapsed time has to be settled *first* — otherwise the hours between the last
 * billing pass and the machine stopping become unbillable the instant the clock
 * is cleared, which is a silent write-off of delivered compute.
 */
const stopComputeClock = async (deploymentId, stoppedAt) => {
  const deploymentService = require('../services/deployment/deploymentService');
  const deploymentBilling = require('../services/billing/deploymentBilling');

  const deployment = await deploymentService.findById(deploymentId);
  if (!deployment || !deployment.computeClockStartedAt) return { stopped: false };

  const at = new Date(Math.min(new Date(stoppedAt || Date.now()).getTime(), Date.now()));

  try {
    await deploymentBilling.billOutstanding(deployment, { now: at, save: false });
  } catch (err) {
    // Not fatal, and not silent: the watermark has not moved, so the hours are
    // still owed and the next pass bills them — as long as the deployment is
    // still billable by something, which a paused one is.
    console.error(`[GCP] Could not settle compute before stopping the clock on ${deploymentId}:`, err.message);
  }

  deployment.computeClockStartedAt = null;
  await deployment.save();
  return { stopped: true, at };
};

/* ────────────────────────────────────────────────────────────────────────────
 * One instance at a time
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Retry a build that is due.
 *
 * The attempt number is what rotates the zone — `pickZone` derives the zone
 * from it — so a zone with no capacity is not retried against the same zone
 * forever. That is also why placement is recomputed here instead of reusing
 * whatever was planned the first time.
 */
const retryBuild = async (instance, summary) => {
  const deploymentService = require('../services/deployment/deploymentService');
  const deployment = await deploymentService.findById(instance.deploymentId);

  if (!deployment) {
    await instanceStore.markFailed(instance.id, {
      code: 'DEPLOYMENT_GONE',
      message: 'The deployment this machine belongs to no longer exists.',
    });
    summary.failed += 1;
    return;
  }

  // A deployment that is no longer on its way to running must not have a
  // machine built for it — a retry firing after the customer terminated it
  // would create a machine nobody will ever pay for.
  if (!['provisioning', 'approved', 'paused'].includes(deployment.status)) {
    await instanceStore.markFailed(instance.id, {
      code: 'NO_LONGER_WANTED',
      message: `The deployment moved to "${deployment.status}" before this machine could be built.`,
    });
    summary.failed += 1;
    return;
  }

  const placement = gcpDriver.planFor(deployment, instance.attempt);
  if (!placement.ok) {
    await instanceStore.markFailed(instance.id, { code: placement.code, message: placement.message });
    summary.failed += 1;
    return;
  }

  try {
    const created = await gcpClient.createInstance({
      plan: placement.plan,
      zone: placement.zone,
      deploymentId: deployment.id,
      teamId: deployment.teamId,
    });
    await instanceStore.markCreating(instance.id, {
      operationName: created.operationName,
      operationType: 'insert',
      zone: placement.zone,
    });
    summary.retried += 1;
  } catch (err) {
    const verdict = classifier.classify(err);

    if (verdict.action === 'adopt') {
      // An earlier attempt got further than we recorded. Not a failure.
      await instanceStore.markCreating(instance.id, {
        operationName: null, operationType: 'adopt', zone: placement.zone,
      });
      summary.retried += 1;
      return;
    }

    if (verdict.action === 'retry' || verdict.action === 'move_zone') {
      const seconds = classifier.backoffSeconds(instance.attempt + 1, { seed: instance.deploymentId });
      await instanceStore.markRetry(instance.id, {
        code: verdict.code,
        message: verdict.message,
        nextAttemptAt: new Date(Date.now() + seconds * 1000),
      });
      summary.deferred += 1;
      return;
    }

    await instanceStore.markFailed(instance.id, { code: verdict.code, message: verdict.message });
    summary.failed += 1;
  }
};

/**
 * A build or start finished. Record the machine and start the meter.
 */
const settleRunning = async (instance, { runningAt, dryRun }, summary) => {
  let live = null;
  if (!dryRun) {
    // What GCP says the machine is, rather than what we asked for. An external
    // IP appearing here would mean the security posture was not applied, and
    // the column exists so that is visible rather than invisible.
    live = await gcpClient.getInstance({ zone: instance.zone, name: instance.instanceName })
      .catch((err) => {
        console.error(`[GCP] Could not read ${instance.instanceName} after it came up:`, err.message);
        return null;
      });
  }

  const nic = live?.networkInterfaces?.[0] || null;
  await instanceStore.markRunning(instance.id, {
    runningAt,
    instanceId: live?.id ? String(live.id) : null,
    internalIp: nic?.networkIP || null,
    externalIp: nic?.accessConfigs?.[0]?.natIP || null,
    machineType: live?.machineType ? String(live.machineType).split('/').pop() : null,
  });

  const clock = await startComputeClock(instance.deploymentId, runningAt);
  summary.running += 1;
  if (clock.started) summary.clocksStarted += 1;

  console.log(
    `[GCP] ${instance.instanceName} is running${dryRun ? ' (dry run)' : ''}`
    + `${clock.started ? `, compute clock started at ${clock.at.toISOString()}` : ''}`
  );

  if (nic?.accessConfigs?.[0]?.natIP) {
    // Worth shouting about: no instance this platform builds asks for an
    // external IP, so one existing means something else created it or the
    // posture regressed.
    console.error(
      `[GCP] SECURITY: ${instance.instanceName} has an external IP (${nic.accessConfigs[0].natIP}). `
      + 'No machine this platform creates requests one.'
    );
  }
};

/** Follow up one instance with an open question. */
const reconcileOne = async (instance, { gcp, now }, summary) => {
  // ── A retry that has come due ──
  if (instance.phase === 'planned') {
    await retryBuild(instance, summary);
    return;
  }

  const dryRun = isDryRunOperation(instance.operationName) || gcp.dryRun !== false;

  // ── Dry run: no operation to poll, so time is the only signal ──
  if (dryRun) {
    if (!dryRunReady(instance, { afterSeconds: gcp.dryRunRunningAfterSeconds, now })) {
      summary.pending += 1;
      return;
    }
    if (instance.phase === 'stopping') {
      await instanceStore.markStopped(instance.id, { stoppedAt: now });
      await stopComputeClock(instance.deploymentId, now);
      summary.stopped += 1;
      return;
    }
    await settleRunning(instance, { runningAt: now, dryRun: true }, summary);
    return;
  }

  /*
   * ── Adopted: GCP has the machine but we never saw an operation ──
   *
   * `operationType === 'adopt'` with no operation name. There is nothing to
   * poll, so the instance itself is the source of truth.
   */
  if (!instance.operationName) {
    const live = await gcpClient.getInstance({ zone: instance.zone, name: instance.instanceName })
      .catch(() => null);
    if (live?.status === 'RUNNING') {
      await settleRunning(
        instance,
        { runningAt: live.lastStartTimestamp || live.creationTimestamp || now, dryRun: false },
        summary,
      );
      return;
    }
    if (live?.status === 'TERMINATED' || live?.status === 'STOPPED') {
      await instanceStore.markStopped(instance.id, { stoppedAt: now });
      await stopComputeClock(instance.deploymentId, now);
      summary.stopped += 1;
      return;
    }
    if (!live) {
      // GCP does not have it. Back to the retry queue rather than stuck.
      await instanceStore.markRetry(instance.id, {
        code: 'NOT_FOUND',
        message: 'Google does not have this machine, so it will be built again.',
        nextAttemptAt: now,
      });
      summary.deferred += 1;
      return;
    }
    summary.pending += 1;
    return;
  }

  // ── Poll the operation ──
  let op = null;
  try {
    op = await gcpClient.getZoneOperation({ zone: instance.zone, operationName: instance.operationName });
  } catch (err) {
    console.error(`[GCP] Could not read operation ${instance.operationName}:`, err.message);
    summary.pending += 1;
    return;
  }

  const verdict = readOperation(op);

  if (verdict.state === 'pending') {
    summary.pending += 1;
    return;
  }

  if (verdict.state === 'error') {
    const classified = classifier.classify({
      code: verdict.error.code,
      message: verdict.error.message,
      status: verdict.error.status,
    });

    if (classified.action === 'retry' || classified.action === 'move_zone') {
      const seconds = classifier.backoffSeconds(instance.attempt + 1, { seed: instance.deploymentId });
      await instanceStore.markRetry(instance.id, {
        code: classified.code,
        message: classified.message,
        nextAttemptAt: new Date(now.getTime() + seconds * 1000),
      });
      summary.deferred += 1;
      return;
    }

    if (classified.action === 'adopt') {
      await instanceStore.markCreating(instance.id, {
        operationName: null, operationType: 'adopt', zone: instance.zone,
      });
      summary.pending += 1;
      return;
    }

    await instanceStore.markFailed(instance.id, { code: classified.code, message: classified.message });
    await failDeployment(instance, classified);
    summary.failed += 1;
    return;
  }

  // ── Done ──
  const at = verdict.at || now;
  if (instance.phase === 'stopping') {
    await instanceStore.markStopped(instance.id, { stoppedAt: at });
    await stopComputeClock(instance.deploymentId, at);
    summary.stopped += 1;
    return;
  }

  await settleRunning(instance, { runningAt: at, dryRun: false }, summary);
};

/**
 * The machine will not be built. Tell the customer, rather than leaving a
 * deployment in `provisioning` forever.
 */
const failDeployment = async (instance, classified) => {
  try {
    const deploymentService = require('../services/deployment/deploymentService');
    const deployment = await deploymentService.findById(instance.deploymentId);
    if (!deployment || !['provisioning', 'approved'].includes(deployment.status)) return;

    await deploymentService.transition(deployment, 'failed', {
      note: `Google Cloud could not build this machine: ${classified.message}`,
    });
  } catch (err) {
    console.error(`[GCP] Could not mark ${instance.deploymentId} failed:`, err.message);
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * Stuck builds
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Anything that has been mid-build far longer than it should be.
 *
 * Latched on the instance row — `lastErrorCode = 'STALE'` — so an admin is told
 * once rather than every time this job runs, which is the same shape as
 * `notifyStaleProvisioning`.
 */
const alertStale = async ({ now }, summary) => {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MINUTES * 60 * 1000);
  const stuck = await prisma.deploymentInstance.findMany({
    where: {
      // Google's own, so this job does not raise an alert naming Google about
      // a machine that is on AWS.
      provider: 'gcp',
      phase: { in: ['planned', 'creating'] },
      operationAt: { lt: cutoff },
      NOT: { lastErrorCode: 'STALE' },
    },
    include: { deployment: { select: { id: true, deploymentName: true } } },
    take: 25,
  });

  if (!stuck.length) return;

  for (const instance of stuck) {
    await prisma.deploymentInstance.update({
      where: { id: instance.id },
      data: {
        lastErrorCode: 'STALE',
        lastError: `Still ${instance.phase} after ${STALE_AFTER_MINUTES} minutes.`,
        lastErrorAt: now,
      },
    });
  }

  summary.stale += stuck.length;

  try {
    const notificationService = require('../services/notification/notificationService');
    const userService = require('../services/user/userService');
    const admins = await userService.listActiveAdmins();
    if (!admins.length) return;
    const adminUrl = (process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003').replace(/\/$/, '');

    await notificationService.createMany(admins.map((admin) => ({
      recipientId: admin.id,
      recipientType: 'admin',
      type: 'system_alert',
      title: 'Machines stuck mid-build',
      message:
        `${stuck.length} machine${stuck.length === 1 ? '' : 's'} on Google Cloud have been building for `
        + `over ${STALE_AFTER_MINUTES} minutes: ${stuck.map((i) => i.instanceName).slice(0, 5).join(', ')}.`,
      priority: 'high',
      action: { label: 'Open deployments', url: `${adminUrl}/deployments` },
      metadata: { instanceNames: stuck.map((i) => i.instanceName) },
    })));
  } catch (err) {
    console.error('[GCP] Could not raise the stale-build alert:', err.message);
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * The orphan sweep
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Machines on GCP that this platform created and can no longer account for.
 *
 * Recorded, never destroyed — see the file header for why that is not timidity.
 *
 * The comparison is by instance name, which is derived from the deployment id,
 * so a name tells us which deployment it *claims* to belong to even when no row
 * exists for it. That makes the reason specific ("the deployment was deleted")
 * instead of just "unknown".
 */
const sweepOrphans = async ({ gcp, now }, summary) => {
  if (gcp.dryRun !== false) return; // nothing was ever created, so nothing can be orphaned

  let live;
  try {
    live = await gcpClient.listManagedInstances();
  } catch (err) {
    console.error('[GCP] Orphan sweep could not list instances:', err.message);
    return;
  }
  if (!Array.isArray(live) || live.length === 0) return;

  const known = await prisma.deploymentInstance.findMany({
    where: { instanceName: { in: live.map((i) => i.name).filter(Boolean) } },
    select: { instanceName: true, phase: true, deploymentId: true },
  });
  const byName = new Map(known.map((k) => [k.instanceName, k]));

  for (const machine of live) {
    if (!machine.name || !naming.isOurs(machine.name)) continue;

    const row = byName.get(machine.name);
    const suspectedDeploymentId = naming.deploymentIdFromName(machine.name);

    let reason = '';
    if (!row) {
      reason = suspectedDeploymentId
        ? 'No instance record exists for this machine — its deployment was probably deleted.'
        : 'No instance record exists for this machine.';
    } else if (row.phase === 'terminated') {
      // We believe we destroyed it and GCP still has it. The most expensive
      // disagreement there is: nothing on this platform bills it, and nothing
      // on this platform is watching it.
      reason = 'This platform recorded the machine as destroyed, but Google still has it.';
    } else if (row.phase === 'failed') {
      reason = 'This platform recorded the build as failed, but the machine exists.';
    } else {
      continue; // accounted for
    }

    await prisma.orphanInstance.upsert({
      where: {
        provider_projectId_zone_instanceName: {
          provider: 'gcp',
          projectId: machine.projectId || gcp.projectId || '',
          zone: machine.zone || '',
          instanceName: machine.name,
        },
      },
      create: {
        provider: 'gcp',
        projectId: machine.projectId || gcp.projectId || '',
        zone: machine.zone || '',
        instanceName: machine.name,
        instanceId: machine.id ? String(machine.id) : null,
        machineType: machine.machineType || '',
        labels: machine.labels || null,
        cloudStatus: machine.status || '',
        reason,
        suspectedDeploymentId: suspectedDeploymentId || null,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        lastSeenAt: now,
        cloudStatus: machine.status || '',
        reason,
        // A machine seen again after an admin resolved it is a new problem:
        // the resolution did not take.
        resolvedAt: null,
        resolution: '',
      },
    });
    summary.orphans += 1;
  }

  if (summary.orphans > 0) {
    console.error(`[GCP] Orphan sweep found ${summary.orphans} machine(s) nobody owns.`);
    try {
      const notificationService = require('../services/notification/notificationService');
      const userService = require('../services/user/userService');
      const admins = await userService.listActiveAdmins();
      const adminUrl = (process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003').replace(/\/$/, '');
      await notificationService.createMany(admins.map((admin) => ({
        recipientId: admin.id,
        recipientType: 'admin',
        type: 'system_alert',
        title: 'Machines on Google Cloud with no owner',
        message:
          `${summary.orphans} machine${summary.orphans === 1 ? '' : 's'} exist on Google Cloud with no live `
          + 'deployment behind them. They are billing and nothing on this platform is watching them.',
        priority: 'urgent',
        action: { label: 'Review orphans', url: `${adminUrl}/deployments/orphans` },
        metadata: { count: summary.orphans },
      })));
    } catch (err) {
      console.error('[GCP] Could not raise the orphan alert:', err.message);
    }
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * The job
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One pass.
 *
 * Returns a summary rather than logging only, so the job registry's run history
 * and a manual "run now" from the admin center both show what happened.
 */
const run = async () => {
  const summary = {
    checked: 0,
    pending: 0,
    running: 0,
    clocksStarted: 0,
    stopped: 0,
    retried: 0,
    deferred: 0,
    failed: 0,
    stale: 0,
    orphans: 0,
    skipped: null,
  };

  const settings = await adminSettingsService.getSettings();
  const gcp = settings?.gcpSettings || {};

  /*
   * Switched off means switched off. Not "poll anyway in case there is
   * something left over": if an operator turns GCP off while machines exist,
   * acting on them without being asked is the opposite of what the switch
   * means. The orphan sweep is what finds anything left behind, and it runs
   * when GCP is back on.
   */
  if (!gcp.enabled) {
    summary.skipped = 'Google Cloud provisioning is switched off.';
    return summary;
  }

  const now = new Date();
  // Google's rows only. This job can only talk to Google, and an AWS row
  // handed to `gcpClient` gets marked failed for a machine that is running.
  const pending = await instanceStore.listPending({ limit: 50, now, provider: 'gcp' });
  summary.checked = pending.length;

  for (const instance of pending) {
    try {
      await reconcileOne(instance, { gcp, now }, summary);
    } catch (err) {
      // One bad instance must never stop the pass. The next run picks it up.
      console.error(`[GCP] Reconciling ${instance.instanceName} threw:`, err.message);
    }
  }

  await alertStale({ now }, summary).catch((err) => {
    console.error('[GCP] Stale check failed:', err.message);
  });

  await sweepOrphans({ gcp, now }, summary).catch((err) => {
    console.error('[GCP] Orphan sweep failed:', err.message);
  });

  if (summary.checked || summary.orphans) {
    console.log('[GCP] Reconciler:', JSON.stringify(summary));
  }

  return summary;
};

module.exports = {
  run,
  STALE_AFTER_MINUTES,
  // Exported for tests: the decisions with no I/O in them.
  readOperation,
  dryRunReady,
  isDryRunOperation,
  // Exported for the admin UI's manual actions.
  startComputeClock,
  stopComputeClock,
};
