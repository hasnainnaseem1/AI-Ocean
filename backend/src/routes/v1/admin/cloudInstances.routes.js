/**
 * Admin — Cloud Machines
 *
 * What an operator needs when the platform builds machines on its own.
 *
 * ── Why these routes exist at all ──
 *
 * The owner asked for no review step: a customer deploys and a VM appears. That
 * removes the admin from the *decision*, and it must not remove them from the
 * *facts*. Finding out from a Google invoice that the platform built forty
 * machines overnight would be a worse product, not a leaner one. So:
 *
 *   - the instance panel answers "what is actually running for this deployment,
 *     and is it what the customer paid for"
 *   - the orphan list answers "what is Google charging us for that nothing on
 *     this platform is watching"
 *
 * ── Two deliberate asymmetries ──
 *
 * **Destroying is `deployments.manage`, resolving an orphan is not enough on its
 * own.** Marking an orphan "destroyed" from this screen really does delete a
 * machine, so it takes the same permission as destroying one through a
 * deployment. Marking it "kept" or "not ours" only writes a note.
 *
 * **Nothing here is automatic.** The reconciler records orphans and never
 * deletes them, because a bug in the sweep would then destroy live customer
 * workloads. These routes are where a person decides, one machine at a time,
 * with the machine's labels and status in front of them.
 */
const express = require('express');
const router = express.Router();
const prisma = require('../../../lib/prismaClient');
const { failure } = require('../../../utils/helpers/apiError');
const { paginate, meta } = require('../../../utils/helpers/pagination');
const { checkPermission } = require('../../../middleware/security');
const activityLogService = require('../../../services/admin/activityLogService');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const gcpClient = require('../../../services/gcp/gcpClient');
const awsClient = require('../../../services/aws/awsClient');
const instanceStore = require('../../../services/gcp/deploymentInstanceService');

/**
 * One instance row, shaped for the admin screen.
 *
 * `requested` versus what was built is the part worth having: GCP has no shape
 * that matches some tiers exactly, and the mapper's rule is never to give less
 * than was sold — so when it had to give *more*, or could not match a figure at
 * all, that is recorded in the plan and shown here rather than buried.
 */
const serializeInstance = (row) => {
  if (!row) return null;
  const plan = row.specPlan || {};
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    provider: row.provider,
    projectId: row.projectId,
    zone: row.zone,
    instanceName: row.instanceName,
    instanceId: row.instanceId,

    machineType: row.machineType,
    acceleratorType: row.acceleratorType,
    acceleratorCount: row.acceleratorCount,
    bootDiskType: row.bootDiskType,
    bootDiskSizeGb: row.bootDiskSizeGb,

    internalIp: row.internalIp,
    // Always shown, precisely because it should always be empty. A value here
    // means the security posture did not hold.
    externalIp: row.externalIp,

    phase: row.phase,

    operationName: row.operationName,
    operationType: row.operationType,
    operationAt: row.operationAt,

    attempt: row.attempt,
    nextAttemptAt: row.nextAttemptAt,
    lastErrorCode: row.lastErrorCode,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,

    requestedAt: row.requestedAt,
    runningAt: row.runningAt,
    stoppedAt: row.stoppedAt,
    deletedAt: row.deletedAt,

    // What was sold, and what the mapper had to say about building it.
    sold: plan.requested || null,
    built: {
      vcpu: plan.vcpu ?? null,
      ramGb: plan.ramGb ?? null,
      accelerator: plan.acceleratorLabel || plan.accelerator || null,
      acceleratorCount: plan.acceleratorCount ?? 0,
    },
    notes: Array.isArray(plan.notes) ? plan.notes : [],
  };
};

/* ────────────────────────────────────────────────────────────────────────────
 * One deployment's machine
 * ──────────────────────────────────────────────────────────────────────────── */

// @route   GET /api/v1/admin/cloud/deployments/:deploymentId/instance
// @desc    The machine behind one deployment, if there is one
router.get('/deployments/:deploymentId/instance', checkPermission('deployments.view'), async (req, res) => {
  try {
    const row = await instanceStore.byDeployment(req.params.deploymentId);
    res.json({ success: true, instance: serializeInstance(row) });
  } catch (error) {
    return failure(res, error, 'Error fetching the cloud machine');
  }
});

/**
 * The actions an operator can take by hand.
 *
 * Every one of them goes through the same driver the platform uses itself,
 * rather than touching GCP directly — so an admin pressing "destroy" and the
 * billing job terminating a deployment do exactly the same thing, and there is
 * one place where "destroy a machine" is implemented.
 */
const ACTIONS = {
  retry: {
    label: 'retry the build',
    permission: 'deployments.manage',
    /*
     * Retry is a due-date change, not a GCP call. The reconciler owns building;
     * an admin asking for a retry is asking for it to happen now rather than at
     * the back-off time, and letting this route call GCP as well would mean two
     * things could create the same machine.
     */
    run: async (instance) => {
      if (!['failed', 'planned'].includes(instance.phase)) {
        const err = new Error(`A machine that is "${instance.phase}" is not waiting to be retried.`);
        err.status = 400;
        throw err;
      }
      await instanceStore.markRetry(instance.id, {
        code: null,
        message: 'Retry requested by an administrator.',
        nextAttemptAt: new Date(),
      });
      return { message: 'The build will be retried on the next reconciler pass, within a minute.' };
    },
  },
  stop: {
    label: 'stop the machine',
    permission: 'deployments.manage',
    run: async (instance, deployment) => {
      const driver = require('../../../services/gcp/gcpDriver');
      const result = await driver.suspend(deployment);
      if (!result.ok) {
        const err = new Error(result.message);
        err.status = 502;
        throw err;
      }
      return { message: result.message };
    },
  },
  start: {
    label: 'start the machine',
    permission: 'deployments.manage',
    run: async (instance, deployment) => {
      const driver = require('../../../services/gcp/gcpDriver');
      const result = await driver.resume(deployment);
      if (!result.ok) {
        const err = new Error(result.message);
        err.status = 502;
        throw err;
      }
      return { message: result.message };
    },
  },
  destroy: {
    label: 'destroy the machine',
    permission: 'deployments.manage',
    run: async (instance, deployment) => {
      const driver = require('../../../services/gcp/gcpDriver');
      const result = await driver.terminate(deployment);
      if (!result.ok) {
        const err = new Error(result.message);
        err.status = 502;
        throw err;
      }
      return { message: result.message };
    },
  },
};

// @route   POST /api/v1/admin/cloud/deployments/:deploymentId/instance/:action
// @desc    retry | stop | start | destroy, by hand
router.post(
  '/deployments/:deploymentId/instance/:action',
  checkPermission('deployments.manage'),
  async (req, res) => {
    try {
      const action = ACTIONS[req.params.action];
      if (!action) {
        return res.status(400).json({ success: false, message: 'Unknown action' });
      }

      const instance = await instanceStore.byDeployment(req.params.deploymentId);
      if (!instance) {
        return res.status(404).json({ success: false, message: 'This deployment has no cloud machine' });
      }

      const deploymentService = require('../../../services/deployment/deploymentService');
      const deployment = await deploymentService.findById(req.params.deploymentId);
      if (!deployment) {
        return res.status(404).json({ success: false, message: 'Deployment not found' });
      }

      const result = await action.run(instance, deployment);

      await activityLogService.logActivity({
        userId: req.userId,
        userName: req.user.name,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: 'deployment_status_changed',
        actionType: 'update',
        targetModel: 'Deployment',
        targetId: deployment.id,
        targetName: deployment.deploymentName,
        description: `Admin asked to ${action.label} for "${deployment.deploymentName}" (${instance.instanceName})`,
        metadata: { instanceName: instance.instanceName, zone: instance.zone, action: req.params.action },
        ipAddress: getClientIP(req),
        userAgent: req.get('user-agent'),
        status: 'success',
      }).catch(() => {});

      const fresh = await instanceStore.byDeployment(req.params.deploymentId);
      res.json({ success: true, message: result.message, instance: serializeInstance(fresh) });
    } catch (error) {
      // A deliberate 4xx/502 from an action carries the message a person needs.
      if (error.status) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      return failure(res, error, 'Error acting on the cloud machine');
    }
  }
);

/* ────────────────────────────────────────────────────────────────────────────
 * Account lookup for the allowlist
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * @route   GET /api/v1/admin/cloud/accounts?search=…&ids=…
 * @desc    Accounts that could be put on the provisioning allowlist
 *
 * Its own endpoint rather than reusing `/admin/teams`, for one reason that
 * matters: that list filters to `kind: 'team'`, because the Organizations page
 * is about shared accounts and a personal account *is* the customer. The
 * allowlist is about **who can be given a machine**, and a personal account can
 * own a deployment exactly like an organization can — so leaving them out would
 * make the single most likely first entry (the owner's own test account)
 * impossible to pick.
 *
 * `ids` is how the form resolves what is already stored back into names. Without
 * it the field would render saved entries as bare UUIDs, which is the thing this
 * endpoint exists to stop.
 */
router.get('/accounts', checkPermission('customers.view'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const ids = String(req.query.ids || '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => /^[0-9a-f-]{36}$/i.test(v));

    const where = ids.length
      ? { id: { in: ids } }
      : {
        deletedAt: null,
        ...(search
          ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { createdBy: { email: { contains: search, mode: 'insensitive' } } },
              { createdBy: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
          : {}),
      };

    const rows = await prisma.team.findMany({
      where,
      take: ids.length ? ids.length : 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        kind: true,
        createdBy: { select: { email: true, name: true } },
        _count: { select: { deployments: true } },
      },
    });

    res.json({
      success: true,
      accounts: rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        ownerEmail: r.createdBy?.email || '',
        ownerName: r.createdBy?.name || '',
        deployments: r._count?.deployments ?? 0,
      })),
    });
  } catch (error) {
    return failure(res, error, 'Error looking up accounts');
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * Where prices are coming from right now
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * @route   GET /api/v1/admin/cloud/pricing-status
 * @desc    Can prices be read automatically, and if not, why not
 *
 * The question the pricing screen has to answer before it shows anything else.
 * Without it, an operator sees a hand-filled cost table and cannot tell whether
 * it is load-bearing or dead weight — and a screen that leaves that ambiguous
 * gets filled in "just in case", with figures that then go stale and quietly
 * override nothing or everything.
 *
 * It does a real lookup rather than only reporting configuration, because
 * "credentials are stored" and "prices actually come back" are different
 * things: a key can be present and lack the billing permission, and the
 * difference only shows up on a call.
 */
router.get('/pricing-status', checkPermission('deployments.view'), async (req, res) => {
  try {
    const cloudPricing = require('../../../services/cloud/cloudPricing');
    const adminSettingsService = require('../../../services/admin/adminSettingsService');
    const settings = await adminSettingsService.getSettings();

    const providers = await cloudPricing.providerStatus();

    /*
     * Which cloud is being asked about. Defaults to Google so an older client
     * that does not send it behaves exactly as before.
     */
    const cloudRouter = require('../../../services/cloud/cloudRouter');
    const cloud = cloudRouter.isCloud(req.query.cloud) ? req.query.cloud : 'gcp';
    const cloudSettings = settings?.[`${cloud}Settings`] || {};

    /*
     * A probe against a machine type that cloud really uses, in a region it
     * really has. Cached by the provider, so pressing refresh on this screen
     * does not re-page a whole catalogue.
     */
    const PROBE = {
      gcp: { region: 'europe-west4', machineType: 'e2-medium' },
      aws: { region: 'eu-west-1', machineType: 'm6i.xlarge' },
    };

    let live = null;
    const providerStatus = providers.find((p) => p.name === cloud);
    if (providerStatus?.configured) {
      const probe = await cloudPricing.getProvider(cloud)
        .fetchRates(PROBE[cloud])
        .catch((err) => ({ ok: false, reason: err.message }));

      live = {
        ok: !!probe.ok,
        reason: probe.reason || null,
        source: probe.source || null,
        fetchedAt: probe.fetchedAt || null,
        cached: !!probe.cached,
        // Which prices actually came back, so a gap is visible rather than
        // only showing up later as a refused deployment.
        found: probe.ok
          ? {
            vcpu: probe.rates?.vcpuHour !== null && probe.rates?.vcpuHour !== undefined,
            ram: probe.rates?.ramGbHour !== null && probe.rates?.ramGbHour !== undefined,
            gpuModels: Object.keys(probe.rates?.gpuHour || {}),
            diskTypes: Object.keys(probe.rates?.diskGbMonth || {}),
          }
          : null,
        notes: probe.notes || [],
      };
    }

    const recorded = cloudSettings.machineCostPerHour && typeof cloudSettings.machineCostPerHour === 'object'
      ? cloudSettings.machineCostPerHour
      : {};

    res.json({
      success: true,
      cloud,
      providers,
      live,
      // Whether the hand-filled table is doing any work at all right now.
      recorded: {
        count: Object.keys(recorded).length,
        machineTypes: Object.keys(recorded),
        // True when live prices are unavailable, so this table is the only
        // thing standing between the margin guard and "unknown".
        loadBearing: !live?.ok,
      },
      // Google only: whether prices come from this account's contract rather
      // than from the public list. AWS has no equivalent — its Price List API
      // already answers for the calling account.
      billingAccountConfigured: !!String(cloudSettings.billingAccountId || '').trim(),
      policy: settings?.cloudPricingSettings || {},
    });
  } catch (error) {
    return failure(res, error, 'Error reading the pricing status');
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * What a tier costs, and the floor under its price
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * @route   POST /api/v1/admin/cloud/price-quote
 * @desc    What would this machine cost us, and what is the least we may charge
 *
 * Answers the one question a catalogue screen cannot answer on its own: the
 * admin types specs and a price, and this says whether that price makes money.
 *
 * It runs the same two steps provisioning does — the spec mapper turns specs
 * into a real machine type, then the pricing engine costs it — so the number
 * shown while a tier is being written is the number the margin guard will use
 * when a customer buys it. Two implementations would drift, and the one that
 * drifted would be the screen, which is the one people trust.
 *
 * Read-only. Creates nothing, changes nothing, and is safe to call on every
 * keystroke.
 */
router.post('/price-quote', checkPermission('deployments.view'), async (req, res) => {
  try {
    const {
      vcpu, ramGb, gpuModel, gpuCount, vramGb,
      storageGb, storageType, networkGbps, region, sellPricePerHour,
      machineType: machineTypeOverride,
    } = req.body || {};

    const specMapper = require('../../../services/gcp/gcpSpecMapper');
    const regionMap = require('../../../services/gcp/gcpRegionMap');
    const cloudPricing = require('../../../services/cloud/cloudPricing');

    const resolved = regionMap.resolveRegion(region);
    if (!resolved.ok) {
      return res.json({
        success: true,
        ok: false,
        reason: resolved.message,
        stage: 'region',
      });
    }

    const zone = regionMap.pickZone({ zones: resolved.zones, deploymentId: 'quote', attempt: 0 });

    /*
     * The mapper reads a deployment row, so the tier's specs are handed to it
     * in that shape. Doing it this way rather than giving the mapper a second
     * entry point means the quote cannot describe a machine the provisioner
     * would not build.
     */
    const planned = specMapper.planInstance({
      tierName: 'quote',
      tierVcpu: Number(vcpu) || 0,
      tierRamGb: Number(ramGb) || 0,
      tierGpuModel: gpuModel || '',
      tierGpuCount: Number(gpuCount) || 0,
      tierVramGb: Number(vramGb) || 0,
      tierStorageGb: Number(storageGb) || 0,
      tierStorageType: storageType || 'SSD',
      tierNetworkGbps: Number(networkGbps) || 0,
      tierIsCustom: false,
    }, { zone });

    if (!planned.ok) {
      // The tier cannot be built at all. Worth saying plainly while somebody is
      // still writing it, rather than at the moment a customer tries to buy it.
      return res.json({
        success: true,
        ok: false,
        stage: 'shape',
        code: planned.code,
        reason: planned.message,
      });
    }

    const plan = planned.plan;
    const machineType = machineTypeOverride || plan.machineType;

    const quote = await cloudPricing.assess({
      provider: 'gcp',
      region: resolved.gcpRegion,
      machineType,
      components: {
        vcpu: plan.vcpu,
        ramGb: plan.ramGb,
        gpuModel: plan.acceleratorLabel || plan.accelerator,
        gpuCount: plan.acceleratorCount,
        storageGb: plan.bootDisk?.sizeGb,
        storageType: storageType || 'SSD',
      },
      sellPrice: Number(sellPricePerHour) || 0,
    });

    res.json({
      success: true,
      ok: quote.ok,
      stage: 'priced',
      machineType,
      zone,
      gcpRegion: resolved.gcpRegion,
      // What was asked for versus what the provider can actually build. The
      // mapper never gives less than was sold, so a difference here is always
      // the customer getting more — and that is the platform paying for it.
      built: { vcpu: plan.vcpu, ramGb: plan.ramGb },
      asked: { vcpu: Number(vcpu) || 0, ramGb: Number(ramGb) || 0 },
      planNotes: plan.notes || [],
      source: quote.source,
      currency: quote.currency,
      cost: quote.cost,
      floorPrice: quote.floorPrice,
      verdict: quote.verdict,
      marginPercent: quote.marginPercent,
      shortfall: quote.shortfall,
      notes: quote.notes || [],
      reason: quote.reason || null,
    });
  } catch (error) {
    return failure(res, error, 'Error pricing this machine');
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * Per-account automatic provisioning
 * ──────────────────────────────────────────────────────────────────────────── */

// @route   GET /api/v1/admin/cloud/accounts/:id/auto-deploy
// @desc    Is this account automatic, and if not, why not
router.get('/accounts/:id/auto-deploy', checkPermission('deployments.view'), async (req, res) => {
  try {
    const account = await prisma.team.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, name: true, kind: true,
        autoDeploy: true, autoDeployOffReason: true, autoDeployChangedAt: true,
      },
    });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, account });
  } catch (error) {
    return failure(res, error, 'Error reading the account');
  }
});

/**
 * @route   PUT /api/v1/admin/cloud/accounts/:id/auto-deploy
 * @desc    Turn automatic provisioning off for one account, or back on
 *
 * Deliberately not restricted to `kind: 'team'`. The pay-as-you-go route next
 * door answers 404 for a personal account, which means that control simply
 * cannot be applied to an individual customer — a gap nobody notices until
 * they try. Deployments belong to accounts of both kinds, so this works on
 * both kinds.
 *
 * Turning it OFF changes nothing that is already running. It only decides
 * where this account's NEXT deployment goes: straight to a machine, or into
 * the queue for an admin to approve. Nothing is torn down, and no customer is
 * told anything — "your account needs review" is a support conversation, not a
 * status message.
 */
router.put('/accounts/:id/auto-deploy', checkPermission('deployments.manage'), async (req, res) => {
  try {
    const { autoDeploy, reason } = req.body || {};
    if (typeof autoDeploy !== 'boolean') {
      return res.status(400).json({ success: false, message: 'autoDeploy must be true or false' });
    }

    const account = await prisma.team.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, kind: true, autoDeploy: true },
    });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const before = account.autoDeploy !== false;
    const updated = await prisma.team.update({
      where: { id: account.id },
      data: {
        autoDeploy,
        // Cleared when it goes back on, so a stale reason never sits beside an
        // account that is automatic again.
        autoDeployOffReason: autoDeploy ? '' : String(reason || '').trim().slice(0, 500),
        autoDeployChangedAt: new Date(),
      },
      select: {
        id: true, name: true, kind: true,
        autoDeploy: true, autoDeployOffReason: true, autoDeployChangedAt: true,
      },
    });

    // How many of this account's deployments are sitting in the queue right
    // now, so the admin screen can say "and 3 are waiting" rather than making
    // them go and look.
    const waiting = await prisma.deployment.count({
      where: { teamId: account.id, status: 'pending_review' },
    });

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'deployment_status_changed',
      actionType: 'update',
      targetModel: 'Team',
      targetId: account.id,
      targetName: account.name,
      description: `Automatic cloud provisioning for ${account.name}: ${before ? 'on' : 'off'} → ${autoDeploy ? 'on' : 'off'}`,
      metadata: { before, after: autoDeploy, reason: reason || '', pendingDeployments: waiting },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    }).catch(() => {});

    res.json({
      success: true,
      message: autoDeploy
        ? `${account.name} is back on automatic provisioning.`
        : `${account.name} now needs an admin to approve each deployment.`,
      account: updated,
      pendingDeployments: waiting,
    });
  } catch (error) {
    return failure(res, error, 'Error changing automatic provisioning for this account');
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * Orphans
 * ──────────────────────────────────────────────────────────────────────────── */

// @route   GET /api/v1/admin/cloud/orphans
// @desc    Machines on Google Cloud with no live deployment behind them
router.get('/orphans', checkPermission('deployments.view'), async (req, res) => {
  try {
    const query = paginate(req.query);
    // Unresolved first, because those are the ones costing money. `resolved`
    // is opt-in so the history stays readable without cluttering the default.
    const where = req.query.resolved === 'true'
      ? { resolvedAt: { not: null } }
      : { resolvedAt: null };

    /*
     * Optionally one cloud's, so each cloud's page can show its own. Without
     * it the answer is every cloud — which is what the platform-wide count on
     * the Cloud overview needs, and what an admin wants when the question is
     * "is anything billing that shouldn't be?" rather than "how is AWS doing?".
     */
    const cloud = String(req.query.cloud || '').trim();
    if (cloud) where.provider = cloud;

    const [rows, total, unresolved, byCloud] = await Promise.all([
      prisma.orphanInstance.findMany({
        where,
        orderBy: { firstSeenAt: 'desc' },
        skip: query.skip,
        take: query.limit,
        include: { resolvedBy: { select: { id: true, name: true, email: true } } },
      }),
      prisma.orphanInstance.count({ where }),
      prisma.orphanInstance.count({ where: { resolvedAt: null, ...(cloud ? { provider: cloud } : {}) } }),
      // Per cloud, so each cloud's tab can carry its own badge from one call.
      prisma.orphanInstance.groupBy({
        by: ['provider'],
        where: { resolvedAt: null },
        _count: { _all: true },
      }).catch(() => []),
    ]);

    res.json({
      success: true,
      orphans: rows,
      // Surfaced separately so a badge can be shown whatever filter is applied.
      unresolved,
      unresolvedByCloud: Object.fromEntries(
        (byCloud || []).map((r) => [r.provider, r._count?._all || 0])
      ),
      pagination: meta(query, total),
    });
  } catch (error) {
    return failure(res, error, 'Error fetching orphaned machines');
  }
});

/**
 * Really delete one orphaned machine, on whichever cloud it is on.
 *
 * ── Why this dispatches on `orphan.provider` ──
 *
 * This used to call Google unconditionally. With one cloud that was merely
 * redundant; with two it is the most expensive bug this file could have.
 * Asking Google to delete an AWS machine gets a 404, and the caller below
 * treats 404 as "already gone — the outcome we wanted". So the row would be
 * marked `destroyed`, the sweep would stop reporting it, and the real machine
 * would keep running and keep billing with nothing left watching it.
 *
 * The same reasoning as the frozen `cloudProvider` on a deployment: which
 * cloud a machine is on is a recorded fact, and every destructive call has to
 * read it rather than assume.
 */
const deleteOrphanOnCloud = async (orphan) => {
  if (orphan.provider === 'aws') {
    /*
     * By instance id, not by name. On AWS the name is only a tag and a tag can
     * be edited; the id is the handle. The AZ is what tells the client which
     * region to send the call to — a terminate sent to the wrong region
     * answers "no such instance", which reads exactly like success.
     */
    const id = orphan.instanceId;
    if (!id) {
      const err = new Error(
        `No AWS instance id is recorded for ${orphan.instanceName}, so this platform cannot `
        + 'destroy it. Delete it in the AWS console and mark this one "kept" afterwards.'
      );
      err.noHandle = true;
      throw err;
    }
    return awsClient.terminateInstance(id, orphan.zone);
  }

  return gcpClient.deleteInstance({ zone: orphan.zone, name: orphan.instanceName });
};

/**
 * @route   POST /api/v1/admin/cloud/orphans/:id/resolve
 * @desc    Decide what an orphan is
 *
 * Three answers, and only one of them touches a cloud:
 *
 *   destroyed — delete it. This really deletes a machine, which is why the
 *               reconciler never does it on its own.
 *   kept      — it is ours and it should keep running. Recorded, not deleted.
 *   not_ours  — the label matched but it is not this platform's. Left alone.
 */
router.post('/orphans/:id/resolve', checkPermission('deployments.manage'), async (req, res) => {
  try {
    const { resolution } = req.body;
    if (!['destroyed', 'kept', 'not_ours'].includes(resolution)) {
      return res.status(400).json({
        success: false,
        message: 'Resolution must be destroyed, kept or not_ours',
      });
    }

    const orphan = await prisma.orphanInstance.findUnique({ where: { id: req.params.id } });
    if (!orphan) {
      return res.status(404).json({ success: false, message: 'Orphan not found' });
    }

    if (resolution === 'destroyed') {
      /*
       * The one irreversible action on this screen. Done before the row is
       * marked, so a failed delete does not leave a record claiming the machine
       * is gone — which would make it invisible to the next sweep as well.
       */
      try {
        await deleteOrphanOnCloud(orphan);
      } catch (err) {
        /*
         * "Already gone" is the outcome we wanted — but only when it comes
         * from the cloud the machine is actually on. `deleteOrphanOnCloud`
         * guarantees that; what must never be swallowed is a missing handle,
         * because then nothing was asked of any cloud at all.
         */
        const alreadyGone = !err.noHandle
          && (err.status === 404 || err.awsCode === 'InvalidInstanceID.NotFound');

        if (!alreadyGone) {
          const cloud = orphan.provider === 'aws' ? 'AWS' : 'Google';
          return res.status(502).json({
            success: false,
            message: `${cloud} could not delete ${orphan.instanceName}: ${err.message}`,
          });
        }
      }
    }

    const updated = await prisma.orphanInstance.update({
      where: { id: orphan.id },
      data: { resolution, resolvedAt: new Date(), resolvedById: req.userId },
    });

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'deployment_status_changed',
      actionType: resolution === 'destroyed' ? 'delete' : 'update',
      targetModel: 'Deployment',
      targetId: orphan.suspectedDeploymentId || null,
      targetName: orphan.instanceName,
      description: `Orphaned machine ${orphan.instanceName} in ${orphan.zone} resolved as "${resolution}"`,
      metadata: {
        instanceName: orphan.instanceName,
        zone: orphan.zone,
        projectId: orphan.projectId,
        resolution,
      },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    }).catch(() => {});

    res.json({ success: true, message: `Marked as ${resolution.replace('_', ' ')}.`, orphan: updated });
  } catch (error) {
    return failure(res, error, 'Error resolving the orphaned machine');
  }
});

/**
 * @route   POST /api/v1/admin/cloud/sweep
 * @desc    Check one cloud now rather than waiting for its next scheduled run
 *
 * ── Why both clouds have this, even though their jobs differ ──
 *
 * The Google job does more than sweep: it also polls operations and starts the
 * billing clock. The AWS job only sweeps for orphans so far. But from the
 * admin's side the question is identical — "is anything on this cloud running
 * that nobody owns, right now?" — so the button is the same on both pages and
 * each one runs whatever its cloud has.
 *
 * Offering it on one page and not the other would read as "AWS cannot be
 * checked", which is not true and is the more alarming reading of the two.
 */
const SWEEPERS = {
  gcp: () => require('../../../jobs/gcpReconciler').run(),
  aws: () => require('../../../jobs/awsReconciler').runOnce(),
};

router.post('/sweep', checkPermission('deployments.manage'), async (req, res) => {
  try {
    // Defaults to Google so an older client that sends no cloud keeps working.
    const cloud = String(req.query.cloud || req.body?.cloud || 'gcp').trim();

    if (!Object.hasOwn(SWEEPERS, cloud)) {
      return res.status(400).json({
        success: false,
        message: `"${cloud}" is not a cloud this platform can sweep.`,
      });
    }

    const summary = await SWEEPERS[cloud]();
    res.json({ success: true, cloud, summary });
  } catch (error) {
    return failure(res, error, 'Error running the cloud reconciler');
  }
});

module.exports = router;
// Shared with deployments.routes.js, which folds the machine into the
// deployment detail response — one definition of what a machine looks like.
module.exports.serializeInstance = serializeInstance;
