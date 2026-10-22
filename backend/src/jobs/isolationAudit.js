/**
 * Asking AWS, on a schedule, whether customers are still isolated from each other.
 *
 * ── Why a build-time check is not enough ──
 *
 * The region build worker holds a credential that can create network ACLs, and
 * on AWS that unavoidably means it can rewrite them — `CreateNetworkAclEntry`
 * and `ReplaceNetworkAclEntry` cannot be separated when the ACL does not exist
 * yet. The build worker verifies its own work before publishing a region, and
 * that catches a broken apply.
 *
 * It does not catch anything that happens afterwards. A credential that leaks
 * next month, a console edit made to debug something at 3am and never undone,
 * a rule renumbered by a well-meaning script: each of these changes one word
 * in one rule, and every customer machine in that region can reach every
 * other. Nothing else moves. No instance is created, no setting changes, no
 * bill jumps. There is no symptom to notice.
 *
 * So the question gets asked again, on a schedule, for as long as the platform
 * runs.
 *
 * ── What it does when the answer is wrong ──
 *
 * Takes the region out of service: its build state goes to `failed`, so
 * nothing new is placed there, and admins are told at the highest priority.
 *
 * It deliberately does NOT stop the machines already running there. Those
 * customers are paying for work in progress, and the platform cannot tell
 * whether anyone actually reached anything. Killing live machines on the
 * strength of a rule-order check would be its own incident. Stopping the
 * bleeding — no new placements — and putting a human in front of it within
 * minutes is the proportionate response, and the message says plainly that
 * the running machines are the admin's decision.
 *
 * ── Why it reads with the runtime credential ──
 *
 * The runtime key has `DescribeNetworkAcls` and an explicit deny on every
 * mutating NACL action. An answer from a credential that demonstrably cannot
 * change what it is inspecting is worth more than one from the key that built
 * it — which is the key this is partly watching for.
 */
const adminSettingsService = require('../services/admin/adminSettingsService');
const isolationCheck = require('../services/aws/isolationCheck');
const shape = require('../services/aws/awsSettingsShape');
const regionDemand = require('../services/cloud/regionDemand');
const awsClient = require('../services/aws/awsClient');

/**
 * The VPC's address range, which the check needs and settings do not store.
 *
 * Read from AWS rather than kept in settings on purpose: the range the DENY
 * rule has to name is the VPC's ACTUAL range, and a copy in our database
 * could be stale in exactly the case that matters — a VPC rebuilt with a
 * different CIDR would be checked against the old one and pass while
 * protecting nothing.
 */
const vpcCidrFor = async (awsRegion, vpcId) => {
  const xml = await awsClient.call('DescribeVpcs', { 'VpcId.1': vpcId }, { region: awsRegion });
  const text = typeof xml === 'string' ? xml : JSON.stringify(xml || {});
  return (text.match(/<cidrBlock>([^<]+)<\/cidrBlock>/) || [])[1] || null;
};

/**
 * One pass over every region that is actually in service.
 *
 * Only configured regions are checked: a region with no VPC has no isolation
 * to verify and no customers to protect, and asking about it would produce a
 * failure that means nothing.
 */
const run = async ({ now = new Date() } = {}) => {
  const summary = {
    ran: false, checked: 0, ok: 0, broken: 0, unreadable: 0, regions: [],
  };

  const settings = await adminSettingsService.getSettings();
  const aws = settings?.awsSettings || {};

  if (!aws.enabled) {
    summary.skipped = 'AWS is switched off.';
    return summary;
  }

  /*
   * Dry run means nothing was ever built, so there is nothing to inspect and
   * every call would fail for the wrong reason.
   */
  if (aws.dryRun !== false) {
    summary.skipped = 'AWS is in dry run, so no real network exists to check.';
    return summary;
  }

  const regions = shape.configuredRegions(aws);
  if (!regions.length) {
    summary.skipped = 'No AWS region is built yet.';
    return summary;
  }

  summary.ran = true;

  for (const awsRegion of regions) {
    const infra = shape.infraFor(aws, awsRegion);
    if (!infra.ok) continue;

    summary.checked += 1;

    try {
       
      const vpcCidr = await vpcCidrFor(awsRegion, infra.vpcId);
      if (!vpcCidr) {
        summary.unreadable += 1;
        summary.regions.push({ region: awsRegion, state: 'unreadable', reason: 'no CIDR returned' });
        console.error(`[IsolationAudit] ${awsRegion}: could not read the VPC's address range`);
        continue;
      }

      const verdict = await isolationCheck.verify({
        awsRegion, vpcId: infra.vpcId, vpcCidr,
      });
       

      if (verdict.ok) {
        summary.ok += 1;
        summary.regions.push({ region: awsRegion, state: 'ok' });
        continue;
      }

      /*
       * `COULD_NOT_CHECK` is not a breach — it is an unanswered question, and
       * treating the two the same would take regions out of service every
       * time AWS has a bad minute. Recorded loudly, acted on differently.
       */
      if (verdict.code === 'COULD_NOT_CHECK') {
        summary.unreadable += 1;
        summary.regions.push({ region: awsRegion, state: 'unreadable', reason: verdict.message });
        console.error(`[IsolationAudit] ${awsRegion}: ${verdict.message}`);
        continue;
      }

      summary.broken += 1;
      summary.regions.push({ region: awsRegion, state: 'broken', reason: verdict.message });
       
      await takeOutOfService(awsRegion, verdict, now);
    } catch (err) {
      summary.unreadable += 1;
      summary.regions.push({ region: awsRegion, state: 'unreadable', reason: err.message });
      console.error(`[IsolationAudit] ${awsRegion} could not be checked:`, err.message);
    }
  }

  if (summary.broken) {
    console.error(
      `[IsolationAudit] ${summary.broken} region(s) are NOT isolating customers. `
      + 'No new machines will be placed there.'
    );
  } else if (summary.checked) {
    console.log(
      `[IsolationAudit] ${summary.ok}/${summary.checked} regions verified`
      + `${summary.unreadable ? `, ${summary.unreadable} could not be read` : ''}`
    );
  }

  return summary;
};

/**
 * Stop placing customers in a region whose isolation does not hold.
 *
 * The build state carries this rather than a separate flag, because the
 * question a placement asks is already "is this region fit to build in" — and
 * one answer to that question is easier to keep true than two.
 */
const takeOutOfService = async (awsRegion, verdict, now) => {
  await regionDemand.markFailed({
    cloud: 'aws',
    region: awsRegion,
    error: `ISOLATION BROKEN (checked ${now.toISOString()}) — ${verdict.message}`,
  }).catch((err) => console.error('[IsolationAudit] Could not mark the region:', err.message));

  try {
    // One notification per admin rather than a broadcast, so each can be
    // marked read independently — the same shape the orphan sweep uses.
    const notificationService = require('../services/notification/notificationService');
    const userService = require('../services/user/userService');
    const admins = await userService.listActiveAdmins();
    if (!admins.length) return;

    const adminUrl = (process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003').replace(/\/$/, '');

    await notificationService.createMany(admins.map((admin) => ({
      recipientId: admin.id,
      recipientType: 'admin',
      type: 'system_alert',
      title: `URGENT: customer isolation is not in place in ${awsRegion}`,
      message:
        `${verdict.message} No new machines will be placed in ${awsRegion}. `
        + 'Machines already running there have NOT been stopped — this check cannot tell whether '
        + 'anything was actually reached, and stopping live customer work on a rule check would '
        + `be its own incident. That call is yours. Re-applying ${awsRegion} restores the rules.`,
      priority: 'urgent',
      action: { label: 'Open AWS regions', url: `${adminUrl}/cloud/aws?tab=regions` },
      metadata: { awsRegion, code: verdict.code, failures: verdict.failures || [] },
    })));
  } catch (err) {
    console.error('[IsolationAudit] Could not notify admins:', err.message);
  }
};

module.exports = { run, takeOutOfService, vpcCidrFor };
