/**
 * The AWS reconciler: did the machine come up, and when does the meter start.
 *
 * Two jobs live here, on two schedules, because they answer different
 * questions and cost different amounts to be late with:
 *
 *   `pollPending()`  every minute   — did the machine come up? start the meter
 *   `sweepOrphans()` every 15 min   — is anything running that nobody owns?
 *
 * ── How AWS differs from Google, and why this file is shaped for it ──
 *
 * Google's `instances.insert` returns a long-running **operation** that can be
 * polled for success or failure. AWS has nothing of the kind: `RunInstances`
 * returns an instance id immediately, and the instance's own state moves
 * `pending → running` on its own. So the instance *is* the operation, and
 * polling means asking `DescribeInstances` what it is doing now.
 *
 * That difference creates a failure mode Google does not have. On AWS a launch
 * can be **accepted and then fail**: the instance goes `pending → terminated`
 * seconds later with a `stateReason` such as
 * `Server.InsufficientInstanceCapacity`. Without reading that reason, a failed
 * launch looks exactly like a machine somebody stopped on purpose — the
 * deployment would sit in `provisioning` forever while the customer waits.
 *
 * ── The meter ──
 *
 * `computeClock` is shared with the Google reconciler, deliberately: when a
 * customer starts being charged is a fact about this platform, not about a
 * provider, and two copies of that decision would drift. The timestamp handed
 * to it is **AWS's own** `launchTime`, never this job's clock — a machine that
 * came up 50 seconds before the pass must not get those 50 seconds free.
 *
 * ── Why the sweep records and never destroys ──
 *
 * Same rule as the Google sweep: a bug in the sweep that destroys machines
 * would destroy live customer machines. Nothing here deletes anything. An
 * admin resolves each one by hand, and that is the only path to a delete.
 *
 * ── The one thing AWS adds to the sweep ──
 *
 * `DescribeInstances` is regional: it answers for the region it was sent to
 * and says nothing about any other. So the sweep asks every configured region,
 * and a region that fails to answer makes the result `partial`. A partial
 * sweep is still recorded — recording only ever *adds* what was seen, so a
 * missing region can hide an orphan but can never invent one. What a partial
 * sweep must not do is claim it is all-clear, so the alert says so.
 */
const prisma = require('../lib/prismaClient');
const awsClient = require('../services/aws/awsClient');
const naming = require('../services/aws/awsInstanceNaming');
const instanceStore = require('../services/gcp/deploymentInstanceService');
const classifier = require('../services/aws/awsErrorClassifier');
const regionMap = require('../services/aws/awsRegionMap');
const adminSettingsService = require('../services/admin/adminSettingsService');
// Whether each region's network exists yet, re-derived every pass from the
// saved ids — see services/cloud/regionDemand.js.
const regionDemand = require('../services/cloud/regionDemand');
// The meter. Shared with the Google reconciler so both clouds charge by
// exactly the same rules — see services/billing/computeClock.js.
const computeClock = require('../services/billing/computeClock');

/** How long a build may sit mid-flight before an admin is told. */
const STALE_AFTER_MINUTES = 20;

/**
 * EC2 instance states, grouped by what this platform should do about them.
 *
 * `shutting-down` counts as down rather than as "still deciding": the machine
 * is on its way out and will not serve anything again, so the meter stops now
 * rather than running through the shutdown.
 */
const STATE = {
  pending: 'waiting',
  running: 'up',
  stopping: 'down',
  stopped: 'down',
  'shutting-down': 'down',
  terminated: 'gone',
};

/* ────────────────────────────────────────────────────────────────────────────
 * Polling: did the machine come up?
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * In dry run there is no AWS to ask, so elapsed time is the only signal.
 *
 * Mirrors the Google reconciler's `dryRunReady`, so a dry-run rehearsal on
 * either cloud behaves the same way and takes about as long.
 */
const dryRunReady = (instance, { afterSeconds, now }) => {
  const from = instance.operationAt || instance.requestedAt || instance.createdAt;
  if (!from) return false;
  return now.getTime() - new Date(from).getTime() >= Math.max(0, Number(afterSeconds) || 0) * 1000;
};

const isDryRunInstance = (id) => typeof id === 'string' && id.startsWith('i-dryrun');

/**
 * The machine is up: record what AWS actually built, then start the meter.
 *
 * The order matters. The instance row is written first so that, if starting
 * the meter throws, the machine is still recorded and the next pass finds it
 * — rather than a running machine with no record, which is an orphan we made
 * ourselves.
 */
const settleRunning = async (instance, { live, runningAt, dryRun }, summary) => {
  await instanceStore.markRunning(instance.id, {
    runningAt,
    instanceId: live?.instanceId || instance.operationName || null,
    internalIp: live?.privateIp || null,
    externalIp: live?.publicIp || null,
    machineType: live?.instanceType || null,
  });

  const clock = await computeClock.start(instance.deploymentId, runningAt, { cloud: 'AWS' });
  summary.running += 1;
  if (clock.started) summary.clocksStarted += 1;

  console.log(
    `[AWS] ${instance.instanceName} is running${dryRun ? ' (dry run)' : ''}`
    + `${clock.started ? `, compute clock started at ${clock.at.toISOString()}` : ''}`
  );

  if (live?.publicIp) {
    /*
     * Worth shouting about. Every instance this platform launches sets
     * `AssociatePublicIpAddress: false`, so a public IP means either the
     * posture regressed or something else created this machine. Either way it
     * is reachable from the internet, which no customer machine should be.
     */
    console.error(
      `[AWS] SECURITY: ${instance.instanceName} has a public IP (${live.publicIp}). `
      + 'No machine this platform creates requests one.'
    );
  }
};

/**
 * The machine will not be built. Tell the customer rather than leaving the
 * deployment in `provisioning` forever.
 */
const failDeployment = async (instance, verdict) => {
  try {
    const deploymentService = require('../services/deployment/deploymentService');
    const deployment = await deploymentService.findById(instance.deploymentId);
    if (!deployment || !['provisioning', 'approved'].includes(deployment.status)) return;

    await deploymentService.transition(deployment, 'failed', {
      note: `AWS could not build this machine: ${verdict.message}`,
    });
  } catch (err) {
    console.error(`[AWS] Could not mark ${instance.deploymentId} failed:`, err.message);
  }
};

/**
 * A retry that has come due: ask the driver to build it again.
 *
 * `planFor` recomputes placement from the attempt number, which is what
 * rotates the availability zone — so a region that is full in one AZ gets
 * tried in another rather than retried into the same wall.
 */
const retryBuild = async (instance, summary) => {
  const deploymentService = require('../services/deployment/deploymentService');
  const awsDriver = require('../services/aws/awsDriver');

  const deployment = await deploymentService.findById(instance.deploymentId);
  if (!deployment) {
    await instanceStore.markFailed(instance.id, {
      code: 'NO_DEPLOYMENT',
      message: 'The deployment this machine was for no longer exists.',
    });
    summary.failed += 1;
    return;
  }

  const result = await awsDriver.provision(deployment);
  if (result.ok) summary.retried += 1;
  else summary.failed += 1;
};

/**
 * Follow up one instance with an open question.
 *
 * Every branch ends in one of four places: still waiting, running (meter on),
 * stopped (meter off), or failed. An instance that falls through all of them
 * would sit mid-flight forever, which is what `alertStale` exists to catch.
 */
const reconcileOne = async (instance, { aws, now }, summary) => {
  // ── A retry that has come due ──
  if (instance.phase === 'planned') {
    await retryBuild(instance, summary);
    return;
  }

  const awsId = instance.instanceId || instance.operationName;
  const dryRun = isDryRunInstance(awsId) || aws.dryRun !== false;

  // ── Dry run: nothing was ever sent, so time is the only signal ──
  if (dryRun) {
    if (!dryRunReady(instance, { afterSeconds: aws.dryRunRunningAfterSeconds, now })) {
      summary.pending += 1;
      return;
    }
    if (instance.phase === 'stopping') {
      await instanceStore.markStopped(instance.id, { stoppedAt: now });
      await computeClock.stop(instance.deploymentId, now, { cloud: 'AWS' });
      summary.stopped += 1;
      return;
    }
    await settleRunning(instance, { live: null, runningAt: now, dryRun: true }, summary);
    return;
  }

  /*
   * ── Adopted: the launch was accepted but we never recorded an id ──
   *
   * The machine may well exist. Found by the Name tag this platform gave it,
   * because without an id there is nothing else to go on — and a real instance
   * nobody has a handle for is an orphan we created.
   */
  if (!awsId) {
    const resolved = regionMap.regionOfAz(instance.zone);
    if (!resolved.ok) {
      await instanceStore.markFailed(instance.id, {
        code: 'AZ_NOT_MAPPED',
        message: resolved.message,
      });
      summary.failed += 1;
      return;
    }

    const found = await awsClient.findInstanceByName(instance.instanceName, resolved.awsRegion)
      .catch((err) => {
        console.error(`[AWS] Could not look up ${instance.instanceName}:`, err.message);
        return undefined; // undefined = could not ask; null = asked, nothing there
      });

    if (found === undefined) {
      summary.pending += 1;
      return;
    }

    if (!found) {
      // AWS does not have it, so nothing was built. Back to the retry queue
      // rather than stuck.
      await instanceStore.markRetry(instance.id, {
        code: 'NOT_FOUND',
        message: 'AWS does not have this machine, so it will be built again.',
        nextAttemptAt: now,
      });
      summary.deferred += 1;
      return;
    }

    if (STATE[found.state] === 'up') {
      await settleRunning(
        instance,
        { live: found, runningAt: found.launchTime || now, dryRun: false },
        summary,
      );
      return;
    }

    // It exists but is not up yet. Record the id so the next pass can poll it
    // directly instead of searching by tag again.
    await instanceStore.markCreating(instance.id, {
      operationName: found.instanceId,
      operationType: 'adopt',
      zone: found.az || instance.zone,
    });
    summary.pending += 1;
    return;
  }

  // ── Ask AWS what the instance is doing ──
  let live = null;
  try {
    live = await awsClient.describeInstance(awsId, instance.zone);
  } catch (err) {
    if (err.awsCode === 'InvalidInstanceID.NotFound') {
      /*
       * AWS has never heard of it. Either the launch did not take or somebody
       * removed it. Either way this platform is not paying for it, so the
       * meter stops and the build is retried.
       */
      await computeClock.stop(instance.deploymentId, now, { cloud: 'AWS' });
      await instanceStore.markRetry(instance.id, {
        code: 'NOT_FOUND',
        message: 'AWS does not have this instance, so it will be built again.',
        nextAttemptAt: now,
      });
      summary.deferred += 1;
      return;
    }
    // A network blip or a throttle. Leave it alone; the next pass asks again.
    console.error(`[AWS] Could not read ${awsId}:`, err.awsMessage || err.message);
    summary.pending += 1;
    return;
  }

  const where = STATE[live.state] || 'waiting';

  // ── Still coming up ──
  if (where === 'waiting') {
    summary.pending += 1;
    return;
  }

  // ── Gone: terminated. Was it a failure, or did somebody destroy it? ──
  if (where === 'gone') {
    await computeClock.stop(instance.deploymentId, now, { cloud: 'AWS' });

    /*
     * `pending → terminated` without ever running is a failed launch, and AWS
     * says why in `stateReason`. The classifier decides whether another AZ
     * would help — insufficient capacity usually would; a bad AMI never will.
     */
    if (instance.phase === 'creating') {
      const verdict = classifier.classify({
        awsCode: live.stateReasonCode,
        awsMessage: live.stateReasonMessage,
        message: live.stateReasonMessage || `The instance terminated itself (${live.stateReasonCode || 'no reason given'}).`,
      });

      if (verdict.action === 'retry' || verdict.action === 'move_az') {
        const seconds = classifier.backoffSeconds(instance.attempt + 1, { seed: instance.deploymentId });
        await instanceStore.markRetry(instance.id, {
          code: verdict.code,
          message: verdict.message,
          nextAttemptAt: new Date(now.getTime() + seconds * 1000),
        });
        summary.deferred += 1;
        return;
      }

      await instanceStore.markFailed(instance.id, { code: verdict.code, message: verdict.message });
      await failDeployment(instance, verdict);
      summary.failed += 1;
      return;
    }

    // It had been running, and now it is gone. Not a failure — a destroy.
    await instanceStore.markTerminated(instance.id);
    summary.stopped += 1;
    return;
  }

  // ── Down: stopped or stopping. Meter off. ──
  if (where === 'down') {
    await instanceStore.markStopped(instance.id, { stoppedAt: now });
    await computeClock.stop(instance.deploymentId, now, { cloud: 'AWS' });
    summary.stopped += 1;
    return;
  }

  // ── Up: meter on, at AWS's timestamp ──
  if (instance.phase === 'stopping') {
    /*
     * We asked it to stop and it is still running. Not an error — AWS takes a
     * moment — so it stays billable until AWS says otherwise. Stopping the
     * meter here would stop charging for compute this platform is still paying
     * for.
     */
    summary.pending += 1;
    return;
  }

  await settleRunning(
    instance,
    { live, runningAt: live.launchTime || now, dryRun: false },
    summary,
  );
};

/**
 * Everything mid-build for far longer than it should be.
 *
 * Latched on the row — `lastErrorCode = 'STALE'` — so an admin is told once
 * rather than every pass. The same shape as the Google side.
 */
const alertStale = async ({ now }, summary) => {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MINUTES * 60 * 1000);
  const stuck = await prisma.deploymentInstance.findMany({
    where: {
      provider: 'aws',
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
  console.error(`[AWS] ${stuck.length} machine(s) have been mid-build for over ${STALE_AFTER_MINUTES} minutes.`);
};

/**
 * One polling pass.
 *
 * Runs every minute. Every decision is "due and not yet done", so a pass with
 * nothing to do costs one indexed query.
 */
const pollPending = async ({ now = new Date() } = {}) => {
  const summary = {
    ran: false,
    checked: 0,
    pending: 0,
    running: 0,
    clocksStarted: 0,
    stopped: 0,
    retried: 0,
    deferred: 0,
    failed: 0,
    stale: 0,
  };

  const settings = await adminSettingsService.getSettings();
  const aws = settings?.awsSettings || {};

  if (!aws.enabled) {
    summary.skipped = 'AWS provisioning is switched off.';
    return summary;
  }

  summary.ran = true;

  /*
   * ── Did a region get built since the last pass? ──
   *
   * Re-derived from the saved ids rather than from anything an apply reported,
   * because the ids are what a launch actually uses: an apply can succeed
   * while the transcription into settings is still missing, and settings can
   * be edited by hand at any time.
   *
   * This runs here, every minute, because this is the promise made to a
   * customer whose order is waiting on a new region: it starts on its own. A
   * region promoted to `built` leaves the held order to the ordinary
   * provisioning retry, which finds the infra present and goes through with
   * nothing else changed.
   */
  const promoted = await regionDemand.sync({ settings }).catch((err) => {
    console.error('[AWS] Region sync failed:', err.message);
    return { changes: [] };
  });
  summary.regionsBuilt = promoted.changes.filter((c) => c.to === 'built').length;
  if (summary.regionsBuilt) {
    for (const change of promoted.changes.filter((c) => c.to === 'built')) {
      console.log(
        `[AWS] ${change.region} is now built`
        + `${change.waiting ? ` — ${change.waiting} held order(s) will be retried` : ''}`
      );
    }
  }

  // AWS rows only. The Google job has its own, and handing an AWS instance id
  // to `gcpClient` marks a running machine failed.
  const pending = await instanceStore.listPending({ limit: 50, now, provider: 'aws' });
  summary.checked = pending.length;

  for (const instance of pending) {
    try {
      await reconcileOne(instance, { aws, now }, summary);
    } catch (err) {
      console.error(`[AWS] Could not reconcile ${instance.instanceName}:`, err.message);
    }
  }

  /*
   * Orders waiting on a region that now exists. After the instance pass, so a
   * region promoted in this same pass releases its orders in this same pass —
   * the customer was promised their machine starts on its own, and a minute's
   * extra wait per order is a minute of a promise not quite kept.
   */
  await retryRegionHeld({ now }, summary).catch((err) => {
    console.error('[AWS] Region-held retry failed:', err.message);
  });

  await alertStale({ now }, summary).catch((err) => {
    console.error('[AWS] Stale check failed:', err.message);
  });

  if (summary.checked || summary.clocksStarted) {
    console.log(
      `[AWS] polled ${summary.checked}: ${summary.running} running `
      + `(${summary.clocksStarted} meters started), ${summary.pending} waiting, `
      + `${summary.stopped} stopped, ${summary.deferred} deferred, ${summary.failed} failed`
    );
  }

  return summary;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Orders waiting on a region
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Retry the orders that are waiting for a region to exist.
 *
 * ── Why this needs its own sweep ──
 *
 * Every other retry in this platform hangs off a `DeploymentInstance` row: the
 * row carries `nextAttemptAt`, and `listPending` picks it up when it comes
 * due. A region-held order has no such row, and deliberately — the driver
 * checks the region BEFORE claiming one, because claiming a row for a machine
 * that cannot be placed leaves a `planned` row pointing at a region with no
 * VPC.
 *
 * The consequence was that nothing retried these orders at all. The hold was
 * placed, the admin was told, the region was eventually built — and the
 * customer's order sat there, because the only two things that ever call
 * `provisionNow` are order creation and admin approval, and both had already
 * happened.
 *
 * So the promise in the customer's own message — "you can wait, it will start
 * on its own" — is kept here or nowhere.
 *
 * Deliberately not filtered on build state: it retries every region-held
 * order whose region now resolves, and lets the driver be the one that decides
 * whether the infra is really there. The driver reads the same ids a launch
 * uses, which is the only test that cannot be wrong.
 */
const retryRegionHeld = async ({ now = new Date() }, summary) => {
  const held = await prisma.deployment.findMany({
    where: {
      holdKind: 'region',
      cloudProvider: 'aws',
      status: { in: ['pending_review', 'approved', 'provisioning'] },
    },
    orderBy: { heldAt: 'asc' },
    take: 25,
    select: { id: true, region: true, deploymentName: true, heldAt: true },
  });

  summary.regionHeld = held.length;
  if (!held.length) return;

  const shape = require('../services/aws/awsSettingsShape');
  const settings = await adminSettingsService.getSettings();
  const ready = new Set(shape.configuredRegions(settings?.awsSettings || {}));

  const autoProvision = require('../services/gcp/autoProvisionService');
  const deploymentService = require('../services/deployment/deploymentService');

  for (const row of held) {
    /*
     * The deployment's region is the PLATFORM name the customer chose
     * (`ap-south`); `configuredRegions` answers in AWS's own names
     * (`ap-south-1`). Comparing them directly matches nothing — every held
     * order would be skipped forever, which is the exact failure this sweep
     * exists to prevent, and it would do it silently.
     */
    const resolved = regionMap.resolveRegion(row.region);
    if (!resolved.ok) {
      console.error(`[AWS] ${row.id} is held for region "${row.region}", which maps nowhere.`);
      continue;
    }

    // Still nothing in that region. The hold stands and the customer's
    // message already says why; retrying would only cost a round trip.
    if (!ready.has(resolved.awsRegion)) continue;

    try {
      /*
       * Loaded through the service rather than used as the bare row: the hold
       * is cleared and the status moved by code that expects the wrapped
       * document, with its `save()` and its transition rules.
       */
      const deployment = await deploymentService.findById(row.id);
      if (!deployment) continue;

      const result = await autoProvision.onHoldRetry(deployment);

      if (result?.provisioned) {
        summary.regionReleased = (summary.regionReleased || 0) + 1;
        const waited = row.heldAt
          ? Math.round((now.getTime() - new Date(row.heldAt).getTime()) / 60000)
          : null;
        console.log(
          `[AWS] "${row.deploymentName}" started in ${row.region} after waiting for the region`
          + `${waited !== null ? ` (${waited} min)` : ''}`
        );
      }
    } catch (err) {
      console.error(`[AWS] Could not retry ${row.id} after ${row.region} was built:`, err.message);
    }
  }
};

/* ────────────────────────────────────────────────────────────────────────────
 * The orphan sweep
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Machines on AWS that this platform created and can no longer account for.
 *
 * The comparison is by the Name tag, which is derived from the deployment id,
 * so a name says which deployment a machine *claims* to belong to even when no
 * row exists for it — which makes the reason specific ("its deployment was
 * deleted") instead of just "unknown".
 */
const sweepOrphans = async ({ aws, now }, summary) => {
  // Nothing was ever created in dry run, so nothing can be orphaned.
  if (aws.dryRun !== false) return;

  let result;
  try {
    result = await awsClient.listManagedInstances();
  } catch (err) {
    console.error('[AWS] Orphan sweep could not list instances:', err.message);
    return;
  }

  const live = result?.instances || [];
  summary.partial = !!result?.partial;
  summary.regionsSwept = result?.regions || [];
  summary.regionFailures = result?.failures || [];

  if (summary.partial) {
    console.error(
      `[AWS] Orphan sweep was PARTIAL — could not read ${summary.regionFailures
        .map((f) => `${f.region} (${f.message})`).join('; ')}. `
      + 'A machine in an unread region would not be found by this run.'
    );
  }

  if (!live.length) return;

  const names = live.map((i) => i.name).filter(Boolean);
  const known = names.length
    ? await prisma.deploymentInstance.findMany({
      where: { instanceName: { in: names }, provider: 'aws' },
      select: { instanceName: true, phase: true, deploymentId: true },
    })
    : [];
  const byName = new Map(known.map((k) => [k.instanceName, k]));

  for (const machine of live) {
    if (!machine.name || !naming.isOurs(machine.name)) continue;

    /*
     * A terminated EC2 instance lingers in `DescribeInstances` for up to an
     * hour as a tombstone. It costs nothing and owns nothing — reporting it
     * would be a false alarm that teaches an admin to ignore this screen.
     */
    if (machine.state === 'terminated' || machine.state === 'shutting-down') continue;

    const row = byName.get(machine.name);
    const suspectedDeploymentId = naming.deploymentIdFromName(machine.name);

    let reason = '';
    if (!row) {
      reason = suspectedDeploymentId
        ? 'No instance record exists for this machine — its deployment was probably deleted.'
        : 'No instance record exists for this machine.';
    } else if (row.phase === 'terminated') {
      // We believe we destroyed it and AWS still has it. The most expensive
      // disagreement there is: nothing on this platform bills it, and nothing
      // on this platform is watching it.
      reason = 'This platform recorded the machine as destroyed, but AWS still has it.';
    } else if (row.phase === 'failed') {
      reason = 'This platform recorded the build as failed, but the machine exists.';
    } else {
      continue; // accounted for
    }

    await prisma.orphanInstance.upsert({
      where: {
        provider_projectId_zone_instanceName: {
          provider: 'aws',
          projectId: aws.accountId || '',
          // The AZ, which is what `awsClient.regionForAz` turns back into a
          // region when an admin asks for this machine to be destroyed.
          zone: machine.az || '',
          instanceName: machine.name,
        },
      },
      create: {
        provider: 'aws',
        projectId: aws.accountId || '',
        zone: machine.az || '',
        instanceName: machine.name,
        // On AWS the real handle is the instance id, not the name — the name
        // is only a tag, and a tag can be edited. Destroying one goes by id.
        instanceId: machine.instanceId || null,
        machineType: machine.instanceType || '',
        labels: { region: machine.region || '', state: machine.state || '' },
        cloudStatus: machine.state || '',
        reason,
        suspectedDeploymentId: suspectedDeploymentId || null,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        lastSeenAt: now,
        instanceId: machine.instanceId || null,
        cloudStatus: machine.state || '',
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
    console.error(`[AWS] Orphan sweep found ${summary.orphans} machine(s) nobody owns.`);
    try {
      // The same shape the Google sweep uses — one notification per admin,
      // rather than a broadcast, so each can be marked read independently.
      const notificationService = require('../services/notification/notificationService');
      const userService = require('../services/user/userService');
      const admins = await userService.listActiveAdmins();
      const adminUrl = (process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003').replace(/\/$/, '');

      await notificationService.createMany(admins.map((admin) => ({
        recipientId: admin.id,
        recipientType: 'admin',
        type: 'system_alert',
        title: 'Machines on AWS with no owner',
        message: (summary.orphans === 1
          ? '1 machine exists on AWS with no live deployment behind it. It is billing by the hour '
            + 'and nothing on this platform is watching it.'
          : `${summary.orphans} machines exist on AWS with no live deployment behind them. They are `
            + 'billing by the hour and nothing on this platform is watching them.')
          + (summary.partial
            ? ' This sweep was incomplete — at least one region could not be read, so there may be more.'
            : ''),
        priority: 'urgent',
        action: { label: 'Review orphans', url: `${adminUrl}/cloud/aws?tab=orphans` },
        metadata: {
          count: summary.orphans,
          partial: summary.partial,
          regions: summary.regionsSwept,
        },
      })));
    } catch (err) {
      console.error('[AWS] Could not raise the orphan alert:', err.message);
    }
  }
};

/**
 * One pass.
 *
 * Returns a summary rather than logging only, so a test and the admin screen
 * can both see what it decided.
 */
const runOnce = async ({ now = new Date() } = {}) => {
  const summary = {
    ran: false,
    orphans: 0,
    partial: false,
    regionsSwept: [],
    regionFailures: [],
  };

  const settings = await adminSettingsService.getSettings();
  const aws = settings?.awsSettings || {};

  // Switched off means no machines are being created, but machines created
  // before it was switched off are exactly the ones most likely to be orphans.
  // The sweep still runs; only dry run skips it, because dry run never built
  // anything in the first place.
  if (!aws.enabled || aws.dryRun !== false) return summary;

  summary.ran = true;

  await sweepOrphans({ aws, now }, summary).catch((err) => {
    console.error('[AWS] Orphan sweep failed:', err.message);
  });

  return summary;
};

module.exports = {
  // Every minute: did the machine come up, and start the meter.
  pollPending,
  // Every 15 minutes: is anything running that nobody owns.
  runOnce,
  sweepOrphans,
  STALE_AFTER_MINUTES,
  // Exported for tests: the decisions with no I/O in them.
  dryRunReady,
  isDryRunInstance,
  STATE,
};
