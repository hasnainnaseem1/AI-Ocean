/**
 * GCP Provisioning Driver
 *
 * The second implementation of the interface in
 * `services/deployment/provisioningDriver.js`, and the first one that can
 * actually reach hardware. Same four methods, same `{ ok, requiresHumanAction,
 * message, detail? }` shape — so the billing job, the status machine, the
 * endpoint service and the admin UI all keep speaking through the seam they
 * already use, and nothing above this file changes.
 *
 * ── What each method really promises ──
 *
 * `provision` does **not** promise a running machine. `instances.insert`
 * returns in about a second with an operation that takes 30 to 90 to finish, so
 * this method promises something narrower and truer: GCP has accepted the
 * request and the operation has been written down. The reconciler finds out how
 * it went. Claiming more than that is how a deployment ends up marked running
 * with nothing behind it.
 *
 * `suspend` **stops** the machine rather than deleting it. A pause is
 * reversible and the customer's disk is the thing they would lose; a stopped
 * instance costs no compute and keeps its boot disk, which is exactly what the
 * platform charges storage for while a deployment is paused.
 *
 * `terminate` deletes the instance and its boot disk together
 * (`autoDelete: true` on the disk, set in `buildInstanceBody`). A deleted
 * instance whose disk survives is a bill nobody is watching.
 *
 * ── The one rule this file follows everywhere ──
 *
 * Write the row before calling GCP, never after. If the process dies in
 * between, a row that says `planned` with a real machine behind it is
 * recoverable — the reconciler sees the name already exists and adopts it. The
 * other order leaves a machine running that nothing in this database knows
 * about, and the orphan sweep is a worse answer than not needing one.
 *
 * ── What is deliberately NOT here ──
 *
 * No funding check, no caps, no allowlist — those are `capGuard.evaluate`, and
 * the caller applies them before calling `provision`. A driver that also
 * policed money would be two things at once, and the guard would be bypassed
 * by every other caller of this interface.
 */
const gcpClient = require('./gcpClient');
const instances = require('./deploymentInstanceService');
const specMapper = require('./gcpSpecMapper');
const regionMap = require('./gcpRegionMap');
const naming = require('./gcpInstanceNaming');
const classifier = require('./gcpErrorClassifier');

/** The shape every driver method returns. */
const outcome = (ok, requiresHumanAction, message, detail = undefined) => ({
  ok,
  requiresHumanAction,
  message,
  ...(detail === undefined ? {} : { detail }),
});

/**
 * Work out where and what to build.
 *
 * Pulled out because it is the half with no I/O in it: given a deployment and
 * an attempt number, it either returns a complete placement or says why it
 * cannot. Both failure modes — an unmapped region and a tier GCP cannot
 * build — are permanent, and both name the thing to fix.
 */
const planFor = (deployment, attempt = 0) => {
  const region = regionMap.resolveRegion(deployment.region);
  if (!region.ok) {
    return { ok: false, permanent: true, code: region.code, message: region.message };
  }

  if (regionMap.exhaustedZones({ zones: region.zones, attempt })) {
    return {
      ok: false,
      permanent: true,
      code: 'REGION_CAPACITY',
      message:
        `Every zone in ${region.gcpRegion} has been tried and none could place this machine. `
        + 'Either the shape is unavailable in that region right now or a quota is exhausted.',
    };
  }

  const zone = regionMap.pickZone({ zones: region.zones, deploymentId: deployment.id, attempt });
  const mapped = specMapper.planInstance(deployment, { zone });
  if (!mapped.ok) {
    return { ok: false, permanent: true, code: mapped.code || 'SPEC_UNMAPPABLE', message: mapped.message };
  }

  return { ok: true, zone, region, plan: mapped.plan };
};

/**
 * Ask GCP for the machine.
 *
 * Returns as soon as GCP has accepted — see the note at the top of the file.
 */
const provision = async (deployment) => {
  const placement = planFor(deployment, 0);
  if (!placement.ok) {
    /*
     * Nothing was attempted and nothing will work on a retry. The deployment
     * has to end up somewhere a person looks, so this is the one provisioning
     * failure that raises `requiresHumanAction` — an unbuildable tier is a
     * catalogue problem, not a transient one.
     */
    return outcome(false, true, placement.message, { code: placement.code, permanent: true });
  }

  const { zone, plan } = placement;

  /*
   * Is Google actually built in this region?
   *
   * Checked before the instance row is claimed, for the same reason the AWS
   * driver does it: claiming a row for a machine that cannot be placed leaves
   * a `planned` row pointing at a region with no subnet.
   *
   * Google's VPC is global but its SUBNETS are regional, so a region the
   * platform sells can still have nothing to place a machine in. Reaching the
   * insert instead returns a raw Google error about a subnetwork resource —
   * which reads as our fault and tells the customer nothing.
   *
   * NOT permanent: "not built here yet" is the expected state of every region
   * on the day its first customer arrives. The caller holds the order, tells
   * the customer a region is being set up, and asks for it to be built.
   */
  const gcpRegion = String(zone).replace(/-[a-z]$/, '');
  const ready = await gcpClient.regionReady(gcpRegion).catch((err) => ({
    ok: false, code: 'REGION_NOT_CONFIGURED', message: err.message, missing: [],
  }));

  if (!ready.ok) {
    const needsRegion = ready.code === 'REGION_NOT_CONFIGURED';
    return outcome(false, true, ready.message, {
      code: ready.code,
      permanent: !needsRegion,
      needsRegion,
      gcpRegion,
      missing: ready.missing || [],
    });
  }

  const config = await gcpClient.config().catch(() => ({}));
  const instanceName = naming.instanceName(deployment.id);

  // The row first, always. See the file header.
  const { instance } = await instances.claim({
    deploymentId: deployment.id,
    projectId: config.projectId || '(dry-run)',
    zone,
    instanceName,
    plan,
  });

  // Already built, or already being built. A second call must never produce a
  // second machine.
  if (instance.phase !== 'planned' && instance.phase !== 'failed') {
    return outcome(
      true,
      false,
      `A machine for "${deployment.deploymentName}" already exists (${instance.phase}).`,
      { instanceId: instance.id, phase: instance.phase, idempotent: true },
    );
  }

  try {
    const created = await gcpClient.createInstance({
      plan,
      zone,
      deploymentId: deployment.id,
      teamId: deployment.teamId,
    });

    await instances.markCreating(instance.id, {
      operationName: created.operationName,
      operationType: 'insert',
      zone,
    });

    return outcome(
      true,
      false,
      created.dryRun
        ? `Dry run: recorded a ${plan.machineType} in ${zone} for "${deployment.deploymentName}". Nothing was sent to Google.`
        : `Google accepted a ${plan.machineType} in ${zone} for "${deployment.deploymentName}". It will report running shortly.`,
      {
        instanceId: instance.id,
        instanceName,
        zone,
        machineType: plan.machineType,
        operationName: created.operationName,
        dryRun: !!created.dryRun,
        /*
         * What the customer bought, and what the mapper had to say about
         * building it. Carried through rather than re-derived, so the admin
         * screen shows the same answer this attempt actually acted on — the
         * catalogue can be re-priced tomorrow and this stays true.
         */
        requested: plan.requested,
        notes: plan.notes || [],
      },
    );
  } catch (err) {
    const verdict = classifier.classify(err);

    /*
     * `adopt` means the name is already taken — which, because the name is
     * derived from the deployment id, means an earlier attempt of OURS got
     * further than we recorded. That is a success, not a failure: the
     * reconciler picks the machine up from here.
     */
    if (verdict.action === 'adopt') {
      await instances.markCreating(instance.id, { operationName: null, operationType: 'adopt', zone });
      return outcome(true, false, verdict.message, {
        instanceId: instance.id, instanceName, zone, adopted: true,
      });
    }

    if (verdict.action === 'retry' || verdict.action === 'move_zone') {
      const seconds = classifier.backoffSeconds(instance.attempt + 1, { seed: deployment.id });
      await instances.markRetry(instance.id, {
        code: verdict.code,
        message: verdict.message,
        nextAttemptAt: new Date(Date.now() + seconds * 1000),
        // On a capacity failure the next attempt rotates to another zone;
        // `pickZone` does that from the attempt number, so the zone is left for
        // the reconciler to recompute rather than guessed here.
      });
      return outcome(false, false, `${verdict.message} Retrying in ${seconds}s.`, {
        instanceId: instance.id, code: verdict.code, retryInSeconds: seconds,
      });
    }

    await instances.markFailed(instance.id, { code: verdict.code, message: verdict.message });
    return outcome(false, true, verdict.message, { instanceId: instance.id, code: verdict.code, permanent: true });
  }
};

/**
 * Stop the machine, keep the disk.
 *
 * Idempotent in the direction that matters: a deployment with no machine, or
 * one already stopped, reports success with nothing to do. The endpoint service
 * calls this on every pause, including pauses of deployments that were never
 * provisioned.
 */
const suspend = async (deployment) => {
  const instance = await instances.byDeployment(deployment.id);
  if (!instance || ['terminated', 'failed'].includes(instance.phase)) {
    return outcome(true, false, 'No machine to stop.', { noop: true });
  }
  if (['stopped', 'stopping'].includes(instance.phase)) {
    return outcome(true, false, 'The machine is already stopped.', { noop: true });
  }

  try {
    const op = await gcpClient.stopInstance({ zone: instance.zone, name: instance.instanceName });
    /*
     * Recorded as `stopping`, not `stopped`. The compute clock is cleared by
     * the reconciler when GCP confirms the machine is down — stopping it here
     * would stop billing for minutes the platform is still paying Google for.
     */
    await instances.markStopping(instance.id, { operationName: op.operationName, operationType: 'stop' });
    return outcome(true, false, `Stopping the machine for "${deployment.deploymentName}".`, {
      instanceId: instance.id, operationName: op.operationName, dryRun: !!op.dryRun,
    });
  } catch (err) {
    const verdict = classifier.classify(err);
    await instances.markRetry(instance.id, {
      code: verdict.code,
      message: verdict.message,
      nextAttemptAt: new Date(Date.now() + classifier.backoffSeconds(1, { seed: deployment.id }) * 1000),
    });
    /*
     * A machine we could not stop is still running and still billable, and the
     * customer's access has already been cut. Somebody has to know — this is
     * the case the fulfilment queue exists for.
     */
    return outcome(false, true, `Could not stop the machine: ${verdict.message}`, {
      instanceId: instance.id, code: verdict.code,
    });
  }
};

/** Start a stopped machine back up. */
const resume = async (deployment) => {
  const instance = await instances.byDeployment(deployment.id);

  // Never provisioned, or destroyed. Resuming is not this driver's job to
  // invent a machine for — the caller re-provisions.
  if (!instance || ['terminated', 'failed'].includes(instance.phase)) {
    return outcome(true, false, 'No machine to start — it needs provisioning again.', {
      needsProvision: true,
    });
  }
  if (instance.phase === 'running') {
    return outcome(true, false, 'The machine is already running.', { noop: true });
  }

  try {
    const op = await gcpClient.startInstance({ zone: instance.zone, name: instance.instanceName });
    // `creating` rather than `running`: the same wait as a fresh build, and the
    // same reconciler step decides when the clock starts again.
    await instances.markCreating(instance.id, {
      operationName: op.operationName, operationType: 'start', zone: instance.zone,
    });
    return outcome(true, false, `Starting the machine for "${deployment.deploymentName}".`, {
      instanceId: instance.id, operationName: op.operationName, dryRun: !!op.dryRun,
    });
  } catch (err) {
    const verdict = classifier.classify(err);
    await instances.markRetry(instance.id, {
      code: verdict.code,
      message: verdict.message,
      nextAttemptAt: new Date(Date.now() + classifier.backoffSeconds(1, { seed: deployment.id }) * 1000),
    });
    return outcome(false, false, `Could not start the machine: ${verdict.message}`, {
      instanceId: instance.id, code: verdict.code,
    });
  }
};

/**
 * Destroy the machine and its disk.
 *
 * The row is marked terminated only once GCP has accepted the delete. A
 * tombstone written before the call would hide a machine the delete then failed
 * to remove — the one failure mode that costs money indefinitely and that
 * nothing else would ever notice.
 */
const terminate = async (deployment) => {
  const instance = await instances.byDeployment(deployment.id);
  if (!instance || instance.phase === 'terminated') {
    return outcome(true, false, 'No machine to destroy.', { noop: true });
  }

  try {
    const op = await gcpClient.deleteInstance({ zone: instance.zone, name: instance.instanceName });
    await instances.markTerminated(instance.id);
    return outcome(true, false, `Destroyed the machine for "${deployment.deploymentName}".`, {
      instanceId: instance.id, operationName: op.operationName, dryRun: !!op.dryRun,
    });
  } catch (err) {
    const verdict = classifier.classify(err);

    /*
     * A 404 on delete is the outcome we wanted. GCP does not have it, so
     * neither should we — and leaving the row live would make the orphan sweep
     * hunt for a machine that does not exist.
     */
    if (err.status === 404 || verdict.code === 'NOT_FOUND') {
      await instances.markTerminated(instance.id);
      return outcome(true, false, 'The machine was already gone.', { instanceId: instance.id, noop: true });
    }

    await instances.markRetry(instance.id, {
      code: verdict.code,
      message: verdict.message,
      nextAttemptAt: new Date(Date.now() + classifier.backoffSeconds(1, { seed: deployment.id }) * 1000),
    });
    // The worst failure in this file: a machine that is still running, still
    // being paid for, attached to a deployment the platform has written off.
    return outcome(false, true, `Could not destroy the machine: ${verdict.message}`, {
      instanceId: instance.id, code: verdict.code,
    });
  }
};

module.exports = {
  name: 'gcp',
  canReachHardware: true,
  provision,
  suspend,
  resume,
  terminate,
  // Exported for the reconciler, which recomputes placement on a retry, and
  // for tests.
  planFor,
};
