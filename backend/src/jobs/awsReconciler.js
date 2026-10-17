/**
 * The AWS orphan sweep.
 *
 * ── What this is, and what it deliberately is not ──
 *
 * This is the half of the AWS reconciler that costs money to leave out: finding
 * machines on AWS that this platform created and can no longer account for. An
 * orphan bills by the hour, appears on no invoice, and is attached to no
 * customer — it is the one failure that is both invisible and unbounded.
 *
 * Status polling and the billing clock are **not** here yet. Those decide when
 * a customer starts being charged, and getting them half-right is worse than
 * not having them: a clock that starts early charges for minutes nobody used,
 * and one that starts late gives away machines this platform is paying for.
 * They are a separate piece of work with their own proof.
 *
 * The sweep, by contrast, is complete on its own — it only ever *records*. It
 * does not need the rest of the reconciler to be correct, and leaving it out
 * until the rest exists means every mistake in between bills forever.
 *
 * ── Why it records and never destroys ──
 *
 * Same rule as the Google sweep: a bug in the sweep that destroys machines
 * would destroy live customer machines. Nothing here deletes anything. An
 * admin resolves each one by hand, and that is the only path to a delete.
 *
 * ── The one thing AWS adds ──
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
const adminSettingsService = require('../services/admin/adminSettingsService');

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

module.exports = { runOnce, sweepOrphans };
