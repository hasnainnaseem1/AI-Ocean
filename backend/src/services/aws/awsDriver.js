/**
 * AWS Provisioning Driver.
 *
 * The third implementation of the interface in
 * `services/deployment/provisioningDriver.js`, and the second that can reach
 * hardware. Same four methods plus `planFor`, same `{ ok, requiresHumanAction,
 * message, detail? }` shape — so the billing job, the status machine, the
 * endpoint service, the reconciler and the admin screens all keep speaking
 * through the seam they already use, and nothing above this file knows which
 * cloud it is talking to.
 *
 * ── Where this differs from the GCP driver, and why ──
 *
 * **Idempotency is asked for, not given.** GCP's instance names are unique per
 * zone, so a duplicate create is rejected by the cloud itself. AWS will happily
 * run two instances for two identical calls — so `ClientToken` carries the
 * deployment id and the attempt number, and AWS honours it for 24 hours. A
 * double-fire of the same attempt returns the original instance; a deliberate
 * retry after a real failure gets a new token and is allowed to create one.
 *
 * **The instance id comes from AWS, not from us.** The GCP driver names the
 * machine and can therefore find it again by name. Here the name is a tag and
 * the real handle is `i-0abc…`, assigned at launch — so the instance record is
 * written before the call, updated with the id after it, and the orphan sweep
 * matches on the tag.
 *
 * ── What is deliberately NOT here ──
 *
 * No funding check, no caps, no allowlist — those are `capGuard`, and the
 * caller applies them before calling `provision`. A driver that also policed
 * money would be two things at once, and the guard would be bypassed by every
 * other caller of this interface.
 */
const awsClient = require('./awsClient');
const instances = require('../gcp/deploymentInstanceService');
const specMapper = require('./awsSpecMapper');
const regionMap = require('./awsRegionMap');
const naming = require('./awsInstanceNaming');
const classifier = require('./awsErrorClassifier');

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
 * The half with no I/O in it: given a deployment and an attempt number, it
 * either returns a complete placement or says why it cannot. Both failure
 * modes — an unmapped region and a tier AWS cannot build — are permanent, and
 * both name the thing to fix.
 */
const planFor = (deployment, attempt = 0) => {
  const region = regionMap.resolveRegion(deployment.region);
  if (!region.ok) {
    return { ok: false, permanent: true, code: region.code, message: region.message };
  }

  if (regionMap.exhaustedAzs({ azs: region.azs, attempt })) {
    return {
      ok: false,
      permanent: true,
      code: 'REGION_CAPACITY',
      message: `Every availability zone in ${region.awsRegion} has been tried and none could place `
        + 'this instance. Either the type is unavailable there right now or a quota is exhausted.',
    };
  }

  const az = regionMap.pickAz({ azs: region.azs, deploymentId: deployment.id, attempt });
  const mapped = specMapper.planInstance(deployment, { az });
  if (!mapped.ok) {
    return { ok: false, permanent: true, code: mapped.code || 'SPEC_UNMAPPABLE', message: mapped.message };
  }

  return { ok: true, az, zone: az, region, plan: mapped.plan };
};

/**
 * Ask AWS for the instance.
 *
 * Returns as soon as AWS has accepted. `RunInstances` comes back with an
 * instance in `pending`, which becomes `running` in anything from seconds to a
 * couple of minutes; the reconciler finds out how it went.
 */
const provision = async (deployment) => {
  const placement = planFor(deployment, 0);
  if (!placement.ok) {
    // Nothing was attempted and nothing will work on a retry. An unbuildable
    // tier is a catalogue problem, so it goes where a person looks.
    return outcome(false, true, placement.message, { code: placement.code, permanent: true });
  }

  const { az, plan, region } = placement;

  /*
   * Is AWS actually built in this region?
   *
   * Checked before the instance row is claimed, not left to the launch call.
   * A VPC, security group, subnet and AMI are all regional on AWS, so "we sell
   * this region" and "we have built this region" are different facts, and only
   * the second one can place a machine. Reaching the launch instead would
   * leave a failed row behind and report it as an unrecognised AWS error —
   * when it is our own configuration, and the fix is a Terragrunt apply.
   *
   * ── Why this is NOT permanent ──
   *
   * It used to be, and that was wrong in a way that cost orders. "Not built
   * here yet" is the expected state of every region on the day its first
   * customer arrives: the platform costs and sells a region before it builds
   * it, deliberately, so the region's standing cost is in the price from the
   * start. Marking it permanent moved the deployment to `failed` — a dead end
   * for an order that only needed to wait — and put our own message, naming
   * an `infra/aws/live/...` path, in front of the customer.
   *
   * So it is transient and carries `needsRegion`. The caller holds the order,
   * tells the customer a region is being set up, and asks for the build. The
   * reconciler retries, and the moment the ids land in settings the same code
   * path goes through with nothing else changed.
   */
  const infra = await awsClient.infraFor(region.awsRegion).catch((err) => ({
    ok: false,
    code: err.code || 'REGION_NOT_CONFIGURED',
    message: err.message,
    missing: err.missing || [],
  }));
  if (!infra.ok) {
    const needsRegion = infra.code === 'REGION_NOT_CONFIGURED';
    return outcome(false, true, infra.message, {
      code: infra.code,
      permanent: !needsRegion,
      needsRegion,
      awsRegion: region.awsRegion,
      // What is still missing, so an admin screen can say so without
      // re-deriving it and the builder knows there is work to do.
      missing: infra.missing || [],
    });
  }

  const config = await awsClient.config().catch(() => ({}));

  // The row first, always — see the GCP driver's header for why. The worst
  // case of this order is a `planned` row with no instance, which the
  // reconciler retries; the other order leaves a real instance running that
  // nothing in this database knows about.
  const { instance } = await instances.claim({
    deploymentId: deployment.id,
    provider: 'aws',
    projectId: config.accountId || '(dry-run)',
    zone: az,
    instanceName: naming.instanceName(deployment.id),
    plan,
  });

  if (instance.phase !== 'planned' && instance.phase !== 'failed') {
    return outcome(
      true,
      false,
      `An instance for "${deployment.deploymentName}" already exists (${instance.phase}).`,
      { instanceId: instance.id, phase: instance.phase, idempotent: true },
    );
  }

  try {
    const launched = await awsClient.runInstance({
      plan,
      az,
      deploymentId: deployment.id,
      teamId: deployment.teamId,
      attempt: instance.attempt,
    });

    /*
     * AWS has no long-running operation to poll — `RunInstances` returns the
     * instance id immediately and the state becomes `running` on its own. So
     * the id is stored as the operation handle, and the reconciler polls
     * `DescribeInstances` with it rather than an operation name.
     */
    await instances.markCreating(instance.id, {
      operationName: launched.instanceId,
      operationType: 'run-instances',
      zone: az,
    });

    return outcome(
      true,
      false,
      launched.dryRun
        ? `Dry run: recorded a ${plan.instanceType} in ${az} for "${deployment.deploymentName}". `
          + 'Nothing was sent to AWS.'
        : `AWS accepted a ${plan.instanceType} in ${az} for "${deployment.deploymentName}". `
          + 'It will report running shortly.',
      {
        instanceId: instance.id,
        awsInstanceId: launched.instanceId,
        zone: az,
        machineType: plan.instanceType,
        dryRun: !!launched.dryRun,
        requested: plan.requested,
        notes: plan.notes || [],
      },
    );
  } catch (err) {
    const verdict = classifier.classify(err);

    if (verdict.action === 'adopt') {
      await instances.markCreating(instance.id, { operationName: null, operationType: 'adopt', zone: az });
      return outcome(true, false, verdict.message, { instanceId: instance.id, adopted: true });
    }

    if (verdict.action === 'retry' || verdict.action === 'move_az') {
      const seconds = classifier.backoffSeconds(instance.attempt + 1, { seed: deployment.id });
      await instances.markRetry(instance.id, {
        code: verdict.code,
        message: verdict.message,
        nextAttemptAt: new Date(Date.now() + seconds * 1000),
        // The next attempt rotates to another AZ; `pickAz` derives that from
        // the attempt number, so the zone is recomputed rather than guessed.
      });
      return outcome(false, false, `${verdict.message} Retrying in ${seconds}s.`, {
        instanceId: instance.id, code: verdict.code, retryInSeconds: seconds,
      });
    }

    await instances.markFailed(instance.id, { code: verdict.code, message: verdict.message });
    return outcome(false, true, verdict.message, { instanceId: instance.id, code: verdict.code, permanent: true });
  }
};

/** The AWS instance id this deployment's machine is, or null. */
const awsIdOf = (instance) => instance?.instanceId || instance?.operationName || null;

/**
 * Stop the instance, keep the volume.
 *
 * A stopped EC2 instance costs no compute and keeps its EBS volume, which is
 * exactly what the platform charges a storage rate for while a deployment is
 * paused.
 */
const suspend = async (deployment) => {
  const instance = await instances.byDeployment(deployment.id);
  if (!instance || ['terminated', 'failed'].includes(instance.phase)) {
    return outcome(true, false, 'No instance to stop.', { noop: true });
  }
  if (['stopped', 'stopping'].includes(instance.phase)) {
    return outcome(true, false, 'The instance is already stopped.', { noop: true });
  }

  const awsId = awsIdOf(instance);
  if (!awsId) {
    return outcome(false, true, 'No AWS instance id is recorded, so it cannot be stopped by this platform.', {
      instanceId: instance.id,
    });
  }

  try {
    // The AZ comes from the instance row, which is the record of where the
    // machine actually is. See `awsClient.regionForAz` for why the
    // deployment's own region must not be trusted here.
    const r = await awsClient.stopInstance(awsId, instance.zone);
    /*
     * Recorded as `stopping`, not `stopped`. The compute clock is cleared by
     * the reconciler when AWS confirms the instance is down — stopping it here
     * would stop billing for minutes the platform is still paying for.
     */
    await instances.markStopping(instance.id, { operationName: awsId, operationType: 'stop' });
    return outcome(true, false, `Stopping the instance for "${deployment.deploymentName}".`, {
      instanceId: instance.id, awsInstanceId: awsId, dryRun: !!r.dryRun,
    });
  } catch (err) {
    const verdict = classifier.classify(err);
    await instances.markRetry(instance.id, {
      code: verdict.code,
      message: verdict.message,
      nextAttemptAt: new Date(Date.now() + classifier.backoffSeconds(1, { seed: deployment.id }) * 1000),
    });
    // An instance we could not stop is still running and still billable, and
    // the customer's access has already been cut. Somebody has to know.
    return outcome(false, true, `Could not stop the instance: ${verdict.message}`, {
      instanceId: instance.id, code: verdict.code,
    });
  }
};

/** Start a stopped instance back up. */
const resume = async (deployment) => {
  const instance = await instances.byDeployment(deployment.id);
  if (!instance || ['terminated', 'failed'].includes(instance.phase)) {
    return outcome(true, false, 'No instance to start — it needs provisioning again.', {
      needsProvision: true,
    });
  }
  if (instance.phase === 'running') {
    return outcome(true, false, 'The instance is already running.', { noop: true });
  }

  const awsId = awsIdOf(instance);
  if (!awsId) {
    return outcome(true, false, 'No AWS instance id is recorded — it needs provisioning again.', {
      needsProvision: true,
    });
  }

  try {
    const r = await awsClient.startInstance(awsId, instance.zone);
    // `creating` rather than `running`: the same wait as a fresh launch, and
    // the same reconciler step decides when the clock starts again.
    await instances.markCreating(instance.id, {
      operationName: awsId, operationType: 'start', zone: instance.zone,
    });
    return outcome(true, false, `Starting the instance for "${deployment.deploymentName}".`, {
      instanceId: instance.id, awsInstanceId: awsId, dryRun: !!r.dryRun,
    });
  } catch (err) {
    const verdict = classifier.classify(err);
    await instances.markRetry(instance.id, {
      code: verdict.code,
      message: verdict.message,
      nextAttemptAt: new Date(Date.now() + classifier.backoffSeconds(1, { seed: deployment.id }) * 1000),
    });
    return outcome(false, false, `Could not start the instance: ${verdict.message}`, {
      instanceId: instance.id, code: verdict.code,
    });
  }
};

/**
 * Destroy the instance and its volume.
 *
 * The root volume carries `DeleteOnTermination`, so terminating takes the disk
 * with it. A volume that outlives its instance is a bill nobody is watching.
 *
 * The row is marked terminated only once AWS has accepted. A tombstone written
 * first would hide an instance the terminate then failed to remove — the one
 * failure that costs money indefinitely and that nothing else would notice.
 */
const terminate = async (deployment) => {
  const instance = await instances.byDeployment(deployment.id);
  if (!instance || instance.phase === 'terminated') {
    return outcome(true, false, 'No instance to destroy.', { noop: true });
  }

  const awsId = awsIdOf(instance);
  if (!awsId) {
    // Nothing was ever launched, so there is nothing to destroy — but the row
    // should not sit as live forever either.
    await instances.markTerminated(instance.id);
    return outcome(true, false, 'No AWS instance was ever launched for this deployment.', {
      instanceId: instance.id, noop: true,
    });
  }

  try {
    const r = await awsClient.terminateInstance(awsId, instance.zone);
    await instances.markTerminated(instance.id);
    return outcome(true, false, `Destroyed the instance for "${deployment.deploymentName}".`, {
      instanceId: instance.id, awsInstanceId: awsId, dryRun: !!r.dryRun,
    });
  } catch (err) {
    const verdict = classifier.classify(err);

    /*
     * AWS does not have it. That is the outcome we wanted — and leaving the
     * row live would make the orphan sweep hunt for an instance that does not
     * exist.
     */
    if (err.awsCode === 'InvalidInstanceID.NotFound' || err.status === 404) {
      await instances.markTerminated(instance.id);
      return outcome(true, false, 'The instance was already gone.', { instanceId: instance.id, noop: true });
    }

    await instances.markRetry(instance.id, {
      code: verdict.code,
      message: verdict.message,
      nextAttemptAt: new Date(Date.now() + classifier.backoffSeconds(1, { seed: deployment.id }) * 1000),
    });
    // The worst failure in this file: an instance still running, still being
    // paid for, attached to a deployment the platform has written off.
    return outcome(false, true, `Could not destroy the instance: ${verdict.message}`, {
      instanceId: instance.id, code: verdict.code,
    });
  }
};

module.exports = {
  name: 'aws',
  canReachHardware: true,
  provision,
  suspend,
  resume,
  terminate,
  // Used by the caller before provisioning (to cost the machine) and by the
  // reconciler on a retry, which recomputes placement to rotate the AZ.
  planFor,
};
