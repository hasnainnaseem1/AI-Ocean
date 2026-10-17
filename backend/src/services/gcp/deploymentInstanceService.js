/**
 * Deployment Instance Service
 *
 * The only place that reads or writes the `deployment_instances` table.
 *
 * Narrow on purpose. Two things write to it — the driver, when it asks GCP for
 * a machine, and the reconciler, when it finds out what happened — and they run
 * at the same time as a customer renaming or pausing the deployment. Every
 * write below touches only the columns it means to, so a reconciler poll can
 * never clobber something the driver just recorded, or vice versa.
 *
 * That is also why this is not folded into `deploymentService`: that file
 * carries a hand-rolled ORM that writes all ~70 columns of a deployment from an
 * in-memory snapshot, and a row written once a minute by a background job is
 * exactly the wrong thing to put behind it.
 */
const prisma = require('../../lib/prismaClient');

/**
 * Phases where a machine exists, or is about to, and therefore costs money.
 *
 * `planned` counts. It means we are about to call GCP — and the moment where a
 * crash leaves a row saying "planned" with a real machine behind it is exactly
 * the moment this must not be read as "nothing exists". `failed` and
 * `terminated` do not count: nothing is running under either.
 */
const LIVE_PHASES = ['planned', 'creating', 'running', 'stopping', 'stopped'];

/** Phases with an open question for the reconciler to resolve. */
const PENDING_PHASES = ['planned', 'creating', 'stopping'];

const byDeployment = (deploymentId) =>
  prisma.deploymentInstance.findUnique({ where: { deploymentId } });

/**
 * Record the intention to build a machine, before anything is asked of GCP.
 *
 * Written first, deliberately. If the process dies between this row and the
 * API call, the worst case is a `planned` row with no machine — which the
 * reconciler retries. Calling GCP first and dying before the write is the
 * other way round: a real machine, running, costing money, that nothing in this
 * database knows about. The orphan sweep is the net for that, and a net is a
 * worse answer than not falling.
 *
 * Idempotent: a second call for the same deployment returns the existing row
 * rather than creating a second machine. The unique index on `deployment_id`
 * is what makes that true even for two requests racing.
 */
const claim = async ({ deploymentId, projectId, zone, instanceName, plan, provider = 'gcp' }) => {
  const existing = await byDeployment(deploymentId);
  if (existing) return { instance: existing, created: false };

  try {
    const instance = await prisma.deploymentInstance.create({
      data: {
        deploymentId,
        provider,
        projectId,
        zone,
        instanceName,
        machineType: plan?.machineType || '',
        acceleratorType: plan?.accelerator || null,
        acceleratorCount: Number(plan?.acceleratorCount) || 0,
        bootDiskType: plan?.bootDisk?.type || '',
        bootDiskSizeGb: Number(plan?.bootDisk?.sizeGb) || 0,
        phase: 'planned',
        specPlan: plan || null,
        attempt: 0,
      },
    });
    return { instance, created: true };
  } catch (err) {
    // P2002 is the unique index doing its job: the other request won. Hand
    // back its row, which is the whole point of having the index.
    if (err.code === 'P2002') {
      const winner = await byDeployment(deploymentId);
      if (winner) return { instance: winner, created: false };
    }
    throw err;
  }
};

/** GCP accepted the create and gave us an operation to follow. */
const markCreating = (id, { operationName, operationType = 'insert', zone }) =>
  prisma.deploymentInstance.update({
    where: { id },
    data: {
      phase: 'creating',
      operationName: operationName || null,
      operationType,
      operationAt: new Date(),
      ...(zone ? { zone } : {}),
      attempt: { increment: 1 },
      // The attempt is in flight; the reconciler polls the operation rather
      // than waiting for a retry window.
      nextAttemptAt: null,
      lastErrorCode: null,
      lastError: null,
    },
  });

/**
 * The machine is up.
 *
 * `runningAt` comes from the caller, which takes it from GCP's own operation
 * timestamp — never from this process's clock. The reconciler may notice a
 * machine minutes after it started, and billing from when we noticed charges
 * the customer for our polling interval.
 */
const markRunning = (id, { runningAt, instanceId, internalIp, externalIp, machineType }) =>
  prisma.deploymentInstance.update({
    where: { id },
    data: {
      phase: 'running',
      runningAt: runningAt || new Date(),
      operationName: null,
      operationType: null,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastError: null,
      ...(instanceId ? { instanceId: String(instanceId) } : {}),
      ...(internalIp !== undefined ? { internalIp } : {}),
      ...(externalIp !== undefined ? { externalIp } : {}),
      ...(machineType ? { machineType } : {}),
    },
  });

/**
 * This attempt failed, and it is worth another go later.
 *
 * `nextAttemptAt` is a due date, not a sleep: the reconciler asks "what is due"
 * so a run that comes late does the work the missed run should have done. Same
 * shape as collectionSchedule.js.
 */
const markRetry = (id, { code, message, nextAttemptAt, zone }) =>
  prisma.deploymentInstance.update({
    where: { id },
    data: {
      phase: 'planned',
      operationName: null,
      operationType: null,
      nextAttemptAt: nextAttemptAt || new Date(),
      lastErrorCode: code || null,
      lastError: message ? String(message).slice(0, 1000) : null,
      lastErrorAt: new Date(),
      ...(zone ? { zone } : {}),
    },
  });

/** This will not work however many times it is tried. */
const markFailed = (id, { code, message }) =>
  prisma.deploymentInstance.update({
    where: { id },
    data: {
      phase: 'failed',
      operationName: null,
      operationType: null,
      nextAttemptAt: null,
      lastErrorCode: code || null,
      lastError: message ? String(message).slice(0, 1000) : null,
      lastErrorAt: new Date(),
    },
  });

const markStopping = (id, { operationName, operationType }) =>
  prisma.deploymentInstance.update({
    where: { id },
    data: {
      phase: 'stopping',
      operationName: operationName || null,
      operationType: operationType || 'stop',
      operationAt: new Date(),
    },
  });

const markStopped = (id, { stoppedAt } = {}) =>
  prisma.deploymentInstance.update({
    where: { id },
    data: {
      phase: 'stopped',
      stoppedAt: stoppedAt || new Date(),
      operationName: null,
      operationType: null,
      runningAt: null,
    },
  });

/**
 * The machine is gone.
 *
 * The row stays as a tombstone rather than being deleted. It is what lets the
 * orphan sweep tell "ours, and we destroyed it" from "ours, and nobody knows
 * about it" — delete the row and a machine GCP has not finished deleting yet
 * looks like an orphan on the very next sweep.
 */
const markTerminated = (id, { deletedAt } = {}) =>
  prisma.deploymentInstance.update({
    where: { id },
    data: {
      phase: 'terminated',
      deletedAt: deletedAt || new Date(),
      stoppedAt: deletedAt || new Date(),
      runningAt: null,
      operationName: null,
      operationType: null,
      nextAttemptAt: null,
      internalIp: null,
      externalIp: null,
    },
  });

/** Everything the reconciler has an open question about, oldest first. */
/**
 * Rows one cloud's reconciler should look at.
 *
 * ── `provider` is not optional in practice ──
 *
 * Each cloud has its own reconciler, and each one can only speak to its own
 * cloud. Without this filter the Google job picks up AWS rows every minute and
 * hands an AWS instance id (`i-0abc…`) and an AWS availability zone to
 * `gcpClient.getZoneOperation`. Google has never heard of either, so the call
 * fails, the error classifier reads it as a failed build, and the row for a
 * machine that is **running and billing on AWS** gets marked failed or retried
 * by a job that cannot see it.
 *
 * The caller must say which cloud it is. Omitting it is allowed only for a
 * platform-wide count, and never for anything that then acts on the rows.
 */
const listPending = ({ limit = 50, now = new Date(), provider = null } = {}) =>
  prisma.deploymentInstance.findMany({
    where: {
      ...(provider ? { provider } : {}),
      OR: [
        // An operation we are waiting on.
        { phase: { in: ['creating', 'stopping'] } },
        // A retry that has come due. A `planned` row with no due date is one
        // the driver is about to act on itself, so it is left alone.
        { phase: 'planned', nextAttemptAt: { not: null, lte: now } },
      ],
    },
    orderBy: { operationAt: 'asc' },
    take: limit,
  });

const countLive = (where = {}) =>
  prisma.deploymentInstance.count({ where: { phase: { in: LIVE_PHASES }, ...where } });

module.exports = {
  LIVE_PHASES,
  PENDING_PHASES,
  byDeployment,
  claim,
  markCreating,
  markRunning,
  markRetry,
  markFailed,
  markStopping,
  markStopped,
  markTerminated,
  listPending,
  countLive,
};
