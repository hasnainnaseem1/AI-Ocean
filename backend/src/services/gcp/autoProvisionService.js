/**
 * Auto Provision Service
 *
 * The first caller `provisioningDriver.provision` has ever had.
 *
 * Everything else in the provisioning seam was already wired: `suspend`,
 * `resume` and `terminate` are called by `endpointService` on every status
 * change. `provision` was written, documented, and never invoked, because a
 * human did that job. This file is the one taar that was missing.
 *
 * ── Two doors into the same room ──
 *
 * `onDeploymentCreated` runs when a customer places an order. For almost every
 * customer that is the whole story: the machine is built, no admin touches it.
 *
 * `onAdminApproved` runs when an admin approves a deployment that was waiting.
 * A deployment waits only when its account has `autoDeploy = false`, which an
 * admin sets on that account when they want to see its requests first. The
 * approval IS that review, so this door skips the account switch and runs
 * every other check exactly as the automatic door does.
 *
 * Both funnel into `provisionNow`, so there is one description of what
 * provisioning means and one place where the money checks happen. Two copies
 * of this logic would drift, and the half that drifted would be the one nobody
 * watches.
 *
 * ── The contract with the caller ──
 *
 * `onDeploymentCreated` runs inside the request that creates a customer's
 * deployment, so it has one absolute rule: **it cannot fail that request.** A
 * deployment that exists and is waiting for an admin is a working outcome. A
 * 500 on the create call because Google was slow is not. So every branch
 * resolves, nothing throws, and anything unexpected leaves the deployment
 * exactly where the manual flow would have left it — in `pending_review`, in
 * the fulfilment queue.
 *
 * ── Why not a queue ──
 *
 * There is no Redis and no BullMQ in this project; the established pattern is a
 * node-cron reconciler whose every decision is "due and not yet done". So this
 * does the minimum synchronously — decide, record, ask GCP — and the reconciler
 * owns everything after that. The synchronous part is two database writes and
 * one API call that returns in about a second.
 */
const capGuard = require('./capGuard');
const deploymentHold = require('../deployment/deploymentHold');
const regionDemand = require('../cloud/regionDemand');
// No cloud driver is imported here any more: the driver comes from
// `provisioningDriver.getDriver(deployment)`, which resolves it from the
// deployment's own frozen cloud. Importing one would quietly reintroduce the
// assumption that there is only ever one.
const instances = require('./deploymentInstanceService');

/**
 * The refusals that mean "this platform is not doing automatic provisioning",
 * as opposed to "it is, and this particular deployment cannot have a machine".
 *
 * The difference matters: the first set is the normal state of every install
 * that has not been set up for the cloud, and logging or alerting on it would
 * make the log useless. The second set is a decision worth a record.
 *
 * `ACCOUNT_ON_MANUAL_REVIEW` is deliberately NOT in here. It is quiet in the
 * sense that nothing is wrong — but it is also the reason a deployment is
 * sitting in a queue waiting for a person, and that person has to be told.
 */
const QUIET_CODES = [
  capGuard.CODES.NOT_A_CLOUD,
  capGuard.CODES.GCP_DISABLED,
];

/** Tell the admins what the platform did on its own. Never allowed to throw. */
const notifyAdmins = async (deployment, { title, message, priority = 'medium', metadata = {} }) => {
  try {
    const notificationService = require('../notification/notificationService');
    const userService = require('../user/userService');
    const admins = await userService.listActiveAdmins();
    if (!admins.length) return;

    const adminUrl = (process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003').replace(/\/$/, '');
    await notificationService.createMany(admins.map((admin) => ({
      recipientId: admin.id,
      recipientType: 'admin',
      type: 'deployment_requested',
      title,
      message,
      priority,
      action: { label: 'Open deployment', url: `${adminUrl}/deployments/${deployment.id}` },
      metadata: { deploymentId: deployment.id, ...metadata },
    })));
  } catch (err) {
    console.error('[AutoProvision] Could not notify admins:', err.message);
  }
};

const logDecision = async (deployment, description, metadata) => {
  try {
    const activityLogService = require('../admin/activityLogService');
    await activityLogService.logActivity({
      userId: deployment.userId,
      userName: 'System',
      userEmail: 'system@platform.local',
      userRole: 'system',
      action: 'deployment_status_changed',
      actionType: 'update',
      targetModel: 'Deployment',
      targetId: deployment.id,
      targetName: deployment.deploymentName,
      description,
      metadata,
      status: 'success',
    });
  } catch (err) {
    console.error('[AutoProvision] Could not write activity log:', err.message);
  }
};

const idle = (code, message) => ({ attempted: false, provisioned: false, code, message });

/**
 * Build the machine, having decided that it should be built.
 *
 * @param {object} deployment  a wrapped deployment
 * @param {object} opts
 * @param {object} opts.settings
 * @param {string} opts.cloud  the cloud this deployment is frozen to
 * @param {boolean} [opts.approvedByAdmin]  true when an admin is the one who
 *   said yes. The account's own `autoDeploy` switch is then not consulted —
 *   that switch asks for a human to look, and a human has just looked.
 * @param {object} [opts.actor]  the approving admin, for the status history
 */
const provisionNow = async (deployment, opts) => {
  const { settings, cloud, approvedByAdmin = false, actor = null } = opts;
  const deploymentService = require('../deployment/deploymentService');

  /*
   * The driver for THIS deployment's cloud, resolved from its frozen field
   * rather than from any platform-wide setting. Every cloud's driver answers
   * the same four methods plus `planFor`, so nothing below this line knows or
   * cares which cloud it is talking to.
   */
  const { getDriver } = require('../deployment/provisioningDriver');
  const driver = await getDriver(deployment);

  if (typeof driver.planFor !== 'function') {
    return idle(
      'NO_DRIVER',
      `No driver is registered for "${cloud}", so this deployment cannot be built automatically.`
    );
  }

  /*
   * The machine shape comes first, because the guard needs the machine type to
   * look up what it costs. A tier the cloud cannot build is a permanent,
   * catalogue-level problem.
   */
  const placement = driver.planFor(deployment, 0);
  if (!placement.ok) {
    /*
     * The platform wants to build this and cannot. Left where it is on
     * purpose: the order is still good, the catalogue is what is wrong, and an
     * admin can fulfil it by hand today and fix the tier tomorrow.
     */
    await logDecision(
      deployment,
      `Automatic provisioning could not size "${deployment.deploymentName}": ${placement.message}`,
      { code: placement.code, tier: deployment.tier?.name || deployment.tierName || null },
    );
    await notifyAdmins(deployment, {
      title: 'Deployment needs manual fulfilment',
      message:
        `"${deployment.deploymentName}" could not be built automatically — ${placement.message} `
        + 'It is waiting in the queue.',
      priority: 'high',
      metadata: { code: placement.code },
    });
    return idle(placement.code, placement.message);
  }

  const verdict = await capGuard.evaluate(deployment, {
    settings,
    plan: placement.plan,
    cloud,
    // The cloud's own region string. Each driver resolved it already; deriving
    // it again from the zone would need a different rule per cloud.
    region: placement.region?.awsRegion || placement.region?.gcpRegion,
    // An admin approving IS the review the account switch asks for.
    ...(approvedByAdmin ? { overrideAccountSwitch: true } : {}),
  });

  if (!verdict.ok) {
    if (QUIET_CODES.includes(verdict.code)) return idle(verdict.code, verdict.reason);

    /*
     * A real refusal: out of funds, at a cap, or the machine would lose money.
     * All three are things an operator must see, and none of them is a reason
     * to fail the customer's order — it stays in the queue.
     */
    await logDecision(
      deployment,
      `Automatic provisioning refused for "${deployment.deploymentName}": ${verdict.reason}`,
      { code: verdict.code, machineType: placement.plan.machineType },
    );
    await notifyAdmins(deployment, {
      title: 'Automatic provisioning refused',
      message: `"${deployment.deploymentName}" was not built: ${verdict.reason}`,
      priority: 'high',
      metadata: { code: verdict.code, machineType: placement.plan.machineType },
    });

    /*
     * Tell the CUSTOMER too.
     *
     * Keeping the order rather than failing it is right — they did nothing
     * wrong and the price is ours to fix — but "kept" used to be all that
     * happened. They saw "Pending review" with no reason and no end to it,
     * and the only way out was to give up. A correct decision delivered as
     * silence reads as a broken product.
     *
     * The words they see are written in `deploymentHold`, and never include
     * what a machine costs us or what margin we need.
     */
    const holdKind = deploymentHold.FROM_GUARD_CODE[verdict.code];
    if (holdKind) {
      await deploymentHold.place(deployment, { kind: holdKind, reason: verdict.reason })
        .catch((err) => console.error('[AutoProvision] Could not record the hold:', err.message));
    }

    return idle(verdict.code, verdict.reason);
  }

  /*
   * Past every refusal: whatever was holding this order is over, so the
   * customer-facing notice comes down. Cleared here rather than by a sweep
   * because the only proof a hold is finished is that the thing it blocked
   * has gone through.
   */
  await deploymentHold.clear(deployment)
    .catch((err) => console.error('[AutoProvision] Could not clear the hold:', err.message));

  /*
   * ── On the way to a machine ──
   *
   * `approved` is the record that the order was accepted, and it is what the
   * customer is told — the approval notification says "approved and is being
   * set up", which is exactly true here. An admin-approved deployment is
   * already there, so only the automatic path makes that move.
   *
   * `provisioning` is silent because it sends nothing to the customer anyway,
   * and because the honest customer-facing event is the model going live,
   * which is a later phase's job.
   */
  if (deployment.status === 'pending_review') {
    await deploymentService.transition(deployment, 'approved', {
      actor,
      note: 'Approved automatically for cloud provisioning',
    });
  }
  if (deployment.status !== 'provisioning') {
    await deploymentService.transition(deployment, 'provisioning', {
      actor,
      note: `Building ${placement.plan.machineType} in ${placement.zone}`,
      silent: true,
    });
  }

  const result = await driver.provision(deployment);

  if (!result.ok && result.detail?.permanent) {
    /*
     * Unbuildable, and no retry will change that. The deployment is moved to
     * `failed` rather than left in `provisioning` forever — a customer watching
     * a spinner that will never resolve is worse than being told it did not
     * work, and `failed → provisioning` is a legal move, so an admin who fixes
     * the cause can simply try again.
     */
    await deploymentService.transition(deployment, 'failed', {
      actor,
      note: `The cloud provider could not build this machine: ${result.message}`,
    }).catch((err) => {
      console.error(`[AutoProvision] Could not mark ${deployment.id} failed:`, err.message);
    });
    await notifyAdmins(deployment, {
      title: 'Automatic provisioning failed',
      message: `"${deployment.deploymentName}" could not be built: ${result.message}`,
      priority: 'high',
      metadata: { code: result.detail?.code || null },
    });
    return {
      attempted: true,
      provisioned: false,
      code: result.detail?.code || 'PROVISION_FAILED',
      message: result.message,
    };
  }

  /*
   * ── The first order in a region nobody has used yet ──
   *
   * Not a failure and not really a retry: the network this machine needs does
   * not exist in that region, and building it is the platform's own job. The
   * order is held with something the customer can read, the region is marked
   * as wanted, and the reconciler keeps trying — so the moment the ids land in
   * settings the machine starts with no further intervention.
   *
   * The customer-facing wait and the admin's work item are deliberately two
   * different texts. The customer is told a region is being set up; the admin
   * is told which region, how many orders are waiting on it, and what to run.
   */
  if (!result.ok && result.detail?.needsRegion) {
    /*
     * The provider's own name for the region, from whichever driver answered
     * — `awsRegion` from AWS, `gcpRegion` from Google. Falling back to the
     * deployment's own region keeps this working for a driver that reports
     * neither.
     */
    const awsRegion = result.detail.awsRegion
      || result.detail.gcpRegion
      || deployment.region
      || '';

    await deploymentHold.place(deployment, {
      kind: deploymentHold.KINDS.REGION,
      reason: result.message,
    }).catch((err) => console.error('[AutoProvision] Could not hold for the region:', err.message));

    const want = await regionDemand.want({
      cloud,
      region: awsRegion,
      deploymentId: deployment.id,
      missing: result.detail.missing || [],
    }).catch((err) => {
      console.error('[AutoProvision] Could not record the region demand:', err.message);
      return null;
    });

    // Named from the cloud this deployment is actually frozen to. The text
    // used to say AWS whatever answered, which sent an admin to the wrong
    // screen and the wrong folder.
    const cloudLabel = cloud === 'gcp' ? 'Google Cloud' : 'AWS';
    const cloudTab = cloud === 'gcp' ? 'Google Cloud' : 'AWS';

    await notifyAdmins(deployment, {
      title: `${cloudLabel} is not built in ${awsRegion} yet`,
      message:
        `"${deployment.deploymentName}" is waiting for a network in ${awsRegion}`
        + `${want?.waiting > 1 ? `, along with ${want.waiting - 1} other order(s)` : ''}. `
        + `Build it from Admin → Cloud → ${cloudTab}, or apply infra/${cloud}/live/<env>. `
        + 'The order starts on its own once the ids are saved — nothing is charged while it waits.',
      priority: 'high',
      metadata: {
        code: 'REGION_NOT_CONFIGURED',
        awsRegion,
        missing: result.detail.missing || [],
        waiting: want?.waiting || 1,
      },
    });

    return {
      attempted: true,
      provisioned: false,
      code: 'REGION_NOT_CONFIGURED',
      message: result.message,
      awaitingRegion: awsRegion,
    };
  }

  if (!result.ok) {
    // Transient. The row carries a due date and the reconciler will pick it
    // up; the deployment stays in `provisioning`, which is the truth.
    await notifyAdmins(deployment, {
      title: 'Provisioning retrying',
      message: `"${deployment.deploymentName}": ${result.message}`,
      metadata: { code: result.detail?.code || null },
    });
    return {
      attempted: true,
      provisioned: false,
      code: result.detail?.code || 'PROVISION_RETRY',
      message: result.message,
    };
  }

  /*
   * Only the automatic path announces itself. When an admin approved it they
   * are looking at the screen that is about to show them the machine, and a
   * notification telling them what they just did is noise.
   */
  if (!approvedByAdmin) {
    await notifyAdmins(deployment, {
      title: result.detail?.dryRun ? 'Deployment provisioned (dry run)' : 'Deployment provisioned automatically',
      message:
        `"${deployment.deploymentName}" — ${placement.plan.machineType} in ${placement.zone}. `
        + (result.detail?.dryRun
          ? 'Dry run: nothing was created on Google Cloud.'
          : 'Billing starts when the provider reports it running.'),
      metadata: {
        machineType: placement.plan.machineType,
        zone: placement.zone,
        dryRun: !!result.detail?.dryRun,
      },
    });
  }

  return {
    attempted: true,
    provisioned: true,
    code: null,
    message: result.message,
    instance: result.detail || null,
  };
};

/**
 * Resolve the settings and the cloud both doors need.
 *
 * ── Where the cloud comes from, and why it differs by door ──
 *
 * For a deployment that has already been routed once — an admin approving one
 * that was waiting, or a retry — the answer is its own frozen field, and it
 * must not be recomputed. For a brand-new deployment there is no frozen field
 * yet, so the router decides from the model's assignment and the settings, and
 * the caller freezes the answer before anything is built.
 */
const context = async (deployment, options = {}) => {
  const adminSettingsService = require('../admin/adminSettingsService');
  const cloudRouter = require('../cloud/cloudRouter');

  const settings = options.settings || (await adminSettingsService.getSettings());

  // Already routed: use what was frozen, full stop.
  const frozen = cloudRouter.cloudOf(deployment);
  if (frozen !== cloudRouter.MANUAL) {
    return { settings, cloud: frozen, route: { cloud: frozen, code: 'FROZEN', reason: 'Already routed.' } };
  }

  /*
   * Not routed yet. The model's assignment is the first thing the router
   * looks at, so it has to be loaded — `deployment.model` carries only the
   * snapshot taken at order time, which deliberately does not include the
   * assignment (that would freeze the wrong thing).
   */
  let model = null;
  const modelId = deployment?.model?.modelId || deployment?.modelId || null;
  if (modelId) {
    const prisma = require('../../lib/prismaClient');
    model = await prisma.aIModel
      .findUnique({ where: { id: modelId }, select: { cloudProvider: true, name: true } })
      .catch(() => null);
  }

  const route = await cloudRouter.resolve({ model, settings });
  return { settings, cloud: route.cloud, route };
};

/**
 * Door one: a customer has just placed an order.
 *
 * @returns {Promise<{attempted: boolean, provisioned: boolean, code: string|null,
 *   message: string, needsApproval?: boolean, instance?: object}>}
 */
const onDeploymentCreated = async (deployment, options = {}) => {
  try {
    // Only a brand-new request. Re-provisioning a running deployment is the
    // kind of mistake that bills twice.
    if (deployment.status !== 'pending_review') {
      return idle('NOT_PENDING', `Deployment is ${deployment.status}, not a new request.`);
    }

    const { settings, cloud, route } = await context(deployment, options);

    // The cheap refusals, before any database work. A platform with the cloud
    // switched off must not pay for extra queries on every deployment.
    /*
     * That cloud's own settings, not Google's.
     *
     * This read `settings.gcpSettings` whatever cloud the deployment was
     * routed to, so an AWS deployment was judged against Google's switches:
     * with Google off — the normal state of an AWS-only platform — every AWS
     * order was refused `GCP_DISABLED` and sent quietly to the queue. The
     * argument is named `gcp` because the guard predates the second cloud;
     * `capGuard.evaluate` already looks its settings up this way.
     */
    const gate = capGuard.decide({ cloud, gcp: settings?.[`${cloud}Settings`] || {} });
    if (!gate.ok && QUIET_CODES.includes(gate.code)) return idle(gate.code, route.reason || gate.reason);

    /*
     * ── Is this account on manual review? ──
     *
     * Checked here rather than left to `provisionNow`, because the answer
     * changes what everyone is told: the customer is not getting a machine
     * yet, and an admin has something to do. Every other refusal is a problem;
     * this one is the system working as configured.
     */
    const prisma = require('../../lib/prismaClient');
    const account = await prisma.team
      .findUnique({ where: { id: deployment.teamId }, select: { autoDeploy: true, name: true } })
      .catch(() => null);

    if (account && account.autoDeploy === false) {
      await notifyAdmins(deployment, {
        title: 'Deployment waiting for your approval',
        message:
          `"${deployment.deploymentName}" is from ${account.name}, which is set to manual review. `
          + 'Approving it builds the machine automatically.',
        priority: 'high',
        metadata: { reason: 'account_on_manual_review' },
      });
      return {
        ...idle(capGuard.CODES.ACCOUNT_ON_MANUAL_REVIEW,
          'This account is set to manual review, so an admin approves its deployments.'),
        needsApproval: true,
      };
    }

    /*
     * ── Freeze the cloud, before anything is built ──
     *
     * From here on this deployment belongs to one cloud, whatever the settings
     * or the model's assignment say afterwards. Written BEFORE the machine is
     * created, deliberately: if the process dies between the two, the worst
     * case is a deployment pointing at a cloud with no machine on it, which
     * the reconciler retries. The other order would leave a real machine on a
     * cloud this platform has no record of choosing — and nothing would ever
     * go looking for it there.
     */
    deployment.cloudProvider = cloud;
    await deployment.save();

    return await provisionNow(deployment, { settings, cloud });
  } catch (err) {
    /*
     * The catch-all that keeps the promise at the top of this file. Whatever
     * went wrong, the deployment is in the fulfilment queue and a human can
     * finish it — which is precisely how this platform worked yesterday.
     */
    console.error(`[AutoProvision] Unhandled failure for ${deployment?.id}:`, err);
    await notifyAdmins(deployment, {
      title: 'Deployment needs manual fulfilment',
      message:
        `Automatic provisioning of "${deployment?.deploymentName}" hit an unexpected error `
        + `(${err.message}). It is waiting in the queue.`,
      priority: 'high',
    }).catch(() => {});
    return idle('UNEXPECTED', err.message);
  }
};

/**
 * Door two: an admin has approved a deployment that was waiting.
 *
 * The caller has already moved it to `approved`; this builds the machine. It
 * is allowed to report a failure — unlike door one, there is a person looking
 * at the result, and telling them "approved" while nothing happened would be
 * the worse outcome.
 *
 * @param {object} deployment  already transitioned to `approved`
 * @param {object} [options]
 * @param {object} [options.actor]  the approving admin
 */
const onAdminApproved = async (deployment, options = {}) => {
  try {
    if (!['approved', 'failed'].includes(deployment.status)) {
      return idle('NOT_APPROVED', `Deployment is ${deployment.status}, not approved.`);
    }

    const { settings, cloud, route } = await context(deployment, options);

    /*
     * That cloud's own settings, not Google's.
     *
     * This read `settings.gcpSettings` whatever cloud the deployment was
     * routed to, so an AWS deployment was judged against Google's switches:
     * with Google off — the normal state of an AWS-only platform — every AWS
     * order was refused `GCP_DISABLED` and sent quietly to the queue. The
     * argument is named `gcp` because the guard predates the second cloud;
     * `capGuard.evaluate` already looks its settings up this way.
     */
    const gate = capGuard.decide({ cloud, gcp: settings?.[`${cloud}Settings`] || {} });
    if (!gate.ok && QUIET_CODES.includes(gate.code)) {
      // The cloud is switched off platform-wide. The approval still stands —
      // it just means a human fulfils it, exactly as before any of this.
      return idle(gate.code, route.reason || gate.reason);
    }

    // An approved deployment that was never routed is being routed now, for
    // the first time. One that already has a cloud keeps it — `context` gave
    // back the frozen value and this write is a no-op.
    if (deployment.cloudProvider !== cloud) {
      deployment.cloudProvider = cloud;
      await deployment.save();
    }

    return await provisionNow(deployment, {
      settings,
      cloud,
      approvedByAdmin: true,
      actor: options.actor || null,
    });
  } catch (err) {
    console.error(`[AutoProvision] Approval of ${deployment?.id} could not be built:`, err);
    return idle('UNEXPECTED', err.message);
  }
};

/**
 * Is this platform set up to provision automatically at all?
 *
 * For callers that want to change what they say to a customer — "our team will
 * review it" versus "we are building it now" — without re-running the whole
 * decision.
 */
/**
 * Try again on an order that was held, not failed.
 *
 * ── Why this is a third door and not a flag on the other two ──
 *
 * The other two doors each assert a status: `onDeploymentCreated` refuses
 * anything that is not `pending_review`, and `onAdminApproved` anything that
 * is not `approved` or `failed`. Both assertions are load-bearing — they are
 * what stops a running deployment being provisioned twice, which bills twice.
 *
 * A held order is in neither state. By the time a hold is placed the order has
 * already been moved through `approved` to `provisioning`, because the hold
 * happens at the launch, after the status moves. So retrying one through
 * either existing door returns `NOT_PENDING` and nothing ever starts.
 *
 * Widening either door to let `provisioning` through would remove exactly the
 * check that stops a double build. So this door makes the opposite assertion:
 * it accepts ONLY an order that is actually on hold, and the hold is what
 * makes a retry safe — a held order is one the platform has already decided
 * not to build, so there is nothing running to build twice.
 *
 * Idempotent against itself: `provisionNow` goes through the driver, and the
 * driver's `claim` refuses a second instance for a deployment that has one.
 */
const onHoldRetry = async (deployment, options = {}) => {
  try {
    if (!deployment?.holdKind) {
      return idle('NOT_HELD', 'This deployment is not on hold, so there is nothing to retry.');
    }
    if (!['pending_review', 'approved', 'provisioning'].includes(deployment.status)) {
      return idle('NOT_RETRYABLE', `Deployment is ${deployment.status}.`);
    }

    const { settings, cloud, route } = await context(deployment, options);

    const gate = capGuard.decide({ cloud, gcp: settings?.[`${cloud}Settings`] || {} });
    if (!gate.ok && QUIET_CODES.includes(gate.code)) {
      // The cloud was switched off while the order waited. The hold stands.
      return idle(gate.code, route.reason || gate.reason);
    }

    return await provisionNow(deployment, {
      settings,
      cloud,
      approvedByAdmin: false,
      actor: options.actor || null,
    });
  } catch (err) {
    console.error(`[AutoProvision] Retry of held ${deployment?.id} failed:`, err);
    return idle('UNEXPECTED', err.message);
  }
};

const isAutomatic = async (settings = null) => {
  try {
    const adminSettingsService = require('../admin/adminSettingsService');
    const resolved = settings || (await adminSettingsService.getSettings());
    const { getDriver } = require('../deployment/provisioningDriver');
    const driver = await getDriver();
    const gcp = resolved?.gcpSettings || {};
    return driver.name === 'gcp' && !!gcp.enabled;
  } catch {
    return false;
  }
};

module.exports = {
  onDeploymentCreated,
  onAdminApproved,
  // The third door: an order that was held rather than failed — see its header.
  onHoldRetry,
  isAutomatic,
  QUIET_CODES,
  // Re-exported so a caller does not have to require two modules to read a
  // phase back.
  LIVE_PHASES: instances.LIVE_PHASES,
};
