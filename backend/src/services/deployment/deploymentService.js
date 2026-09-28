/**
 * Deployment Service
 *
 * A deployment is one customer's model running on one machine, and this file
 * owns its whole life: creation, every status change, the endpoint, the
 * billing watermark, and the queries the admin fulfilment queue runs.
 *
 * The table is wide and flat — `tierGpuModel`, `endpointApiKeyEncrypted`,
 * `sizingConfidence` and so on — because a deployment freezes a snapshot of
 * the model and machine it was ordered with, and those fields are indexed and
 * filtered on. `wrapDeployment` folds that flat row back into the nested shape
 * the rest of the code reads (`deployment.model.name`,
 * `deployment.endpoint.active`) and attaches the behaviour that belongs to a
 * deployment rather than to a caller: `effectiveRate()`, `pushStatus()`,
 * `hasLiveAccess()`, and a `save()` that writes the mutated object back.
 *
 * Every deployment status transition goes through `transition()` here — from
 * the customer routes, the admin fulfillment queue, and the hourly billing
 * job alike.
 */
const prisma = require('../../lib/prismaClient');
const { paginate } = require('../../utils/helpers/pagination');
const notificationService = require('../notification/notificationService');
const activityLogService = require('../admin/activityLogService');
const userService = require('../user/userService');
const catalogService = require('../catalog/catalogService');
const deploymentBilling = require('../billing/deploymentBilling');
const fundingService = require('../billing/fundingService');
const debtService = require('../billing/debtService');
const endpointService = require('./endpointService');
const emailService = require('../email/emailService');
const { pgId } = require('./pgLookup');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');
const {
  BILLABLE_STATUSES, STORAGE_BILLABLE_STATUSES, ACTIVE_STATUSES, TERMINAL_STATUSES,
  hasLiveAccess, applyDiscount, currentRateFor,
} = require('./deploymentConstants');

const num = (d) => (d === null || d === undefined ? 0 : (typeof d === 'object' && d.toNumber ? d.toNumber() : Number(d)));

/**
 * Which statuses can follow which. Guards against nonsense transitions like
 * reviving a terminated deployment.
 */
const ALLOWED_TRANSITIONS = {
  pending_review: ['approved', 'rejected', 'terminated'],
  approved: ['provisioning', 'running', 'rejected', 'failed', 'terminated'],
  rejected: ['terminated'],
  provisioning: ['running', 'failed', 'terminated'],
  running: ['paused', 'stopped', 'failed', 'terminated'],
  paused: ['running', 'stopped', 'terminated'],
  stopped: ['running', 'terminated'],
  failed: ['provisioning', 'terminated'],
  terminated: [],
};

const canTransition = (from, to) => (ALLOWED_TRANSITIONS[from] || []).includes(to);

const CUSTOMER_URL = () =>
  (process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002').replace(/\/$/, '');

// ── Shared include / doc-shape ───────────────────────────────────────────

const DEPLOYMENT_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true, createdAt: true } },
  model: { select: { id: true } },
  tier: { select: { id: true } },
  sizingRecommendedTier: { select: { id: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  endpointShutdownCompletedBy: { select: { id: true } },
  statusHistory: { orderBy: { order: 'asc' }, include: { by: { select: { id: true } } } },
  billingMethodHistory: { orderBy: { order: 'asc' }, include: { actor: { select: { id: true } } } },
  requirements: { orderBy: { order: 'asc' } },
};

/** The shape a deployment takes in an API response. */
const toDeploymentDoc = (row) => ({
  id: row.id,
  // The account that owns and pays for it — every billing decision uses this.
  teamId: row.teamId,
  // The member who created it. Not the payer: notifications and per-member
  // spend limits use it, money never does.
  userId: row.user.id,
  deploymentName: row.deploymentName,
  model: {
    modelId: row.model?.id || null,
    name: row.modelName,
    slug: row.modelSlug,
    family: row.modelFamily,
    version: row.modelVersion,
    parameterSize: row.modelParameterSize,
    contextLength: row.modelContextLength,
  },
  tier: {
    tierId: row.tier?.id || null,
    name: row.tierName,
    categoryName: row.tierCategoryName,
    gpuModel: row.tierGpuModel,
    gpuCount: row.tierGpuCount,
    vramGb: num(row.tierVramGb),
    vcpu: num(row.tierVcpu),
    ramGb: num(row.tierRamGb),
    storageGb: num(row.tierStorageGb),
    storageType: row.tierStorageType,
    // Built to order rather than picked off the catalogue. The parts list is
    // what the admin provisions from — nothing else records it.
    isCustom: !!row.tierIsCustom,
    customBuild: row.tierCustomBuild || null,
  },
  region: row.region,
  pricePerHour: num(row.pricePerHour),
  stoppedPricePerHour: num(row.stoppedPricePerHour),
  planDiscountPercent: num(row.planDiscountPercent),
  currency: row.currency,
  billingMethod: row.billingMethod,
  billingMethodHistory: (row.billingMethodHistory || []).map((h) => ({
    method: h.method, at: h.at, actor: h.actor?.id || null, actorName: h.actorName, reason: h.reason,
  })),
  requirements: (row.requirements || []).map((r) => ({
    questionKey: r.questionKey, question: r.question, type: r.type, answer: r.answer,
  })),
  sizing: {
    journeyKey: row.sizingJourneyKey,
    recommendedTierId: row.sizingRecommendedTier?.id || null,
    recommendedTierName: row.sizingRecommendedTierName,
    followedRecommendation: row.sizingFollowedRecommendation,
    requirementProfile: row.sizingRequirementProfile,
    reasons: row.sizingReasons,
    suitabilityVerdict: row.sizingSuitabilityVerdict,
    confidence: row.sizingConfidence,
    computedAt: row.sizingComputedAt,
  },
  status: row.status,
  statusHistory: (row.statusHistory || []).map((h) => ({
    status: h.status, at: h.at, by: h.by?.id || null, byName: h.byName, note: h.note,
  })),
  endpoint: {
    url: row.endpointUrl,
    apiKeyEncrypted: row.endpointApiKeyEncrypted,
    apiKeyMasked: row.endpointApiKeyMasked,
    docsUrl: row.endpointDocsUrl,
    extra: row.endpointExtra || {},
    active: row.endpointActive,
    keyVersion: row.endpointKeyVersion,
    suspendedAt: row.endpointSuspendedAt,
    suspendReason: row.endpointSuspendReason,
    suspendedForEnforcement: row.endpointSuspendedForEnforcement,
    revokedAt: row.endpointRevokedAt,
    revokeReason: row.endpointRevokeReason,
    shutdownRequired: row.endpointShutdownRequired,
    shutdownRequestedAt: row.endpointShutdownRequestedAt,
    shutdownCompletedAt: row.endpointShutdownCompletedAt,
    shutdownCompletedBy: row.endpointShutdownCompletedBy?.id || null,
  },
  adminNotes: row.adminNotes,
  rejectionReason: row.rejectionReason,
  assignedTo: row.assignedTo?.id || null,
  provisionedAt: row.provisionedAt,
  startedAt: row.startedAt,
  lastBilledAt: row.lastBilledAt,
  stoppedAt: row.stoppedAt,
  terminatedAt: row.terminatedAt,
  totalRuntimeHours: num(row.totalRuntimeHours),
  totalCost: num(row.totalCost),
  autoSuspendedForCredit: row.autoSuspendedForCredit,
  debtLimitSuspended: row.debtLimitSuspended,
  hasUnpaidStorage: row.hasUnpaidStorage,
  storageDebtNotifiedAt: row.storageDebtNotifiedAt,
  paygOfferedAt: row.paygOfferedAt,
  cardGateSuspended: row.cardGateSuspended,
  storageGraceWarnedAt: row.storageGraceWarnedAt,
  staleProvisioningNotifiedAt: row.staleProvisioningNotifiedAt,
  idempotencyKey: row.idempotencyKey,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const DOC_KEYS = Object.keys(toDeploymentDoc({
  teamId: null, user: {}, model: null, tier: null, sizingRecommendedTier: null,
  assignedTo: null, endpointShutdownCompletedBy: null, statusHistory: [], billingMethodHistory: [],
  requirements: [], endpointExtra: {},
}));

/**
 * Attach the original instance methods (+ `save()`) onto a plain doc, so
 * every caller in this domain that mutates fields and then calls
 * `deployment.save()` keeps working unchanged.
 *
 * Bookkeeping needed only by `save()` — the Postgres row id, the FK ids that
 * never change after creation, and how many history entries were already
 * persisted — is attached as a single non-enumerable property so it never
 * leaks into `JSON.stringify`/`{...deployment}`/`toObject()`.
 */
const wrapDeployment = (row) => {
  const wrapped = toDeploymentDoc(row);

  Object.defineProperty(wrapped, '__internal', {
    enumerable: false,
    value: {
      pgId: row.id,
      modelIdPg: row.modelId,
      tierIdPg: row.tierId,
      sizingRecommendedTierIdPg: row.sizingRecommendedTierId,
      persistedStatusCount: wrapped.statusHistory.length,
      persistedBillingCount: wrapped.billingMethodHistory.length,
    },
  });

  /**
   * Convenience name/email for the owner and (if any) the assignee — not part
   * of the old original schema, so kept off `DOC_KEYS`/`toObject()`/the mirror
   * doc, but handy for the admin queue, which used to get this via
   * `.populate('userId', 'name email')`.
   */
  wrapped.ownerRef = { name: row.user.name, email: row.user.email, phone: row.user.phone, createdAt: row.user.createdAt };
  wrapped.assignedToRef = row.assignedTo ? { name: row.assignedTo.name, email: row.assignedTo.email } : null;

  wrapped.effectiveRate = () => applyDiscount(wrapped.pricePerHour, wrapped.planDiscountPercent);
  wrapped.effectiveStoppedRate = () => applyDiscount(wrapped.stoppedPricePerHour, wrapped.planDiscountPercent);
  wrapped.currentRate = () => {
    if (BILLABLE_STATUSES.includes(wrapped.status)) return wrapped.effectiveRate();
    if (STORAGE_BILLABLE_STATUSES.includes(wrapped.status)) return wrapped.effectiveStoppedRate();
    return 0;
  };
  wrapped.isBillable = () => BILLABLE_STATUSES.includes(wrapped.status) || STORAGE_BILLABLE_STATUSES.includes(wrapped.status);
  wrapped.isActive = () => ACTIVE_STATUSES.includes(wrapped.status);
  wrapped.hasLiveAccess = () => hasLiveAccess(wrapped);
  wrapped.isTerminal = () => TERMINAL_STATUSES.includes(wrapped.status);

  wrapped.pushStatus = (status, actor = null, note = '', at = null) => {
    wrapped.statusHistory.push({
      status,
      at: at || new Date(),
      by: actor?.id || null,
      byName: actor?.name || (actor === null ? 'system' : ''),
      note,
    });
  };

  wrapped.setBillingMethod = (method, options = {}) => {
    if (wrapped.billingMethod === method) return;
    wrapped.billingMethod = method;
    wrapped.billingMethodHistory.push({
      method,
      at: options.at || new Date(),
      actor: options.actor?.id || null,
      actorName: options.actor?.name || (options.actor === null ? 'system' : ''),
      reason: options.reason || '',
    });
  };

  wrapped.toObject = () => {
    const out = {};
    for (const key of DOC_KEYS) out[key] = wrapped[key];
    return JSON.parse(JSON.stringify(out));
  };

  wrapped.save = async () => {
    const internal = wrapped.__internal;

    const [assignedToPg, shutdownCompletedByPg] = await Promise.all([
      pgId(prisma.user, wrapped.assignedTo),
      pgId(prisma.user, wrapped.endpoint.shutdownCompletedBy),
    ]);

    const newStatusRows = wrapped.statusHistory.slice(internal.persistedStatusCount);
    const newBillingRows = wrapped.billingMethodHistory.slice(internal.persistedBillingCount);

    const [statusByPgIds, billingActorPgIds] = await Promise.all([
      Promise.all(newStatusRows.map((h) => pgId(prisma.user, h.by))),
      Promise.all(newBillingRows.map((h) => pgId(prisma.user, h.actor))),
    ]);

    const data = {
      deploymentName: wrapped.deploymentName,
      modelId: internal.modelIdPg,
      modelName: wrapped.model.name,
      modelSlug: wrapped.model.slug,
      modelFamily: wrapped.model.family,
      modelVersion: wrapped.model.version,
      modelParameterSize: wrapped.model.parameterSize,
      modelContextLength: wrapped.model.contextLength,
      tierId: internal.tierIdPg,
      tierName: wrapped.tier.name,
      tierCategoryName: wrapped.tier.categoryName,
      tierGpuModel: wrapped.tier.gpuModel,
      tierGpuCount: wrapped.tier.gpuCount,
      tierVramGb: wrapped.tier.vramGb,
      tierVcpu: wrapped.tier.vcpu,
      tierRamGb: wrapped.tier.ramGb,
      tierStorageGb: wrapped.tier.storageGb,
      tierStorageType: wrapped.tier.storageType,
      tierIsCustom: !!wrapped.tier.isCustom,
      tierCustomBuild: wrapped.tier.customBuild ?? null,
      region: wrapped.region,
      pricePerHour: wrapped.pricePerHour,
      stoppedPricePerHour: wrapped.stoppedPricePerHour,
      planDiscountPercent: wrapped.planDiscountPercent,
      currency: wrapped.currency,
      billingMethod: wrapped.billingMethod,
      sizingJourneyKey: wrapped.sizing.journeyKey,
      sizingRecommendedTierId: internal.sizingRecommendedTierIdPg,
      sizingRecommendedTierName: wrapped.sizing.recommendedTierName,
      sizingFollowedRecommendation: wrapped.sizing.followedRecommendation,
      sizingRequirementProfile: wrapped.sizing.requirementProfile,
      sizingReasons: wrapped.sizing.reasons,
      sizingSuitabilityVerdict: wrapped.sizing.suitabilityVerdict,
      sizingConfidence: wrapped.sizing.confidence,
      sizingComputedAt: wrapped.sizing.computedAt,
      status: wrapped.status,
      endpointUrl: wrapped.endpoint.url,
      endpointApiKeyEncrypted: wrapped.endpoint.apiKeyEncrypted,
      endpointApiKeyMasked: wrapped.endpoint.apiKeyMasked,
      endpointDocsUrl: wrapped.endpoint.docsUrl,
      endpointExtra: wrapped.endpoint.extra,
      endpointActive: wrapped.endpoint.active,
      endpointKeyVersion: wrapped.endpoint.keyVersion,
      endpointSuspendedAt: wrapped.endpoint.suspendedAt,
      endpointSuspendReason: wrapped.endpoint.suspendReason,
      endpointSuspendedForEnforcement: wrapped.endpoint.suspendedForEnforcement,
      endpointRevokedAt: wrapped.endpoint.revokedAt,
      endpointRevokeReason: wrapped.endpoint.revokeReason,
      endpointShutdownRequired: wrapped.endpoint.shutdownRequired,
      endpointShutdownRequestedAt: wrapped.endpoint.shutdownRequestedAt,
      endpointShutdownCompletedAt: wrapped.endpoint.shutdownCompletedAt,
      endpointShutdownCompletedById: shutdownCompletedByPg,
      adminNotes: wrapped.adminNotes,
      rejectionReason: wrapped.rejectionReason,
      assignedToId: assignedToPg,
      provisionedAt: wrapped.provisionedAt,
      startedAt: wrapped.startedAt,
      lastBilledAt: wrapped.lastBilledAt,
      stoppedAt: wrapped.stoppedAt,
      terminatedAt: wrapped.terminatedAt,
      totalRuntimeHours: wrapped.totalRuntimeHours,
      totalCost: wrapped.totalCost,
      autoSuspendedForCredit: wrapped.autoSuspendedForCredit,
      debtLimitSuspended: wrapped.debtLimitSuspended,
      hasUnpaidStorage: wrapped.hasUnpaidStorage,
      storageDebtNotifiedAt: wrapped.storageDebtNotifiedAt,
      paygOfferedAt: wrapped.paygOfferedAt,
      cardGateSuspended: wrapped.cardGateSuspended,
      storageGraceWarnedAt: wrapped.storageGraceWarnedAt,
      staleProvisioningNotifiedAt: wrapped.staleProvisioningNotifiedAt,
      idempotencyKey: wrapped.idempotencyKey || null,
    };

    await prisma.$transaction([
      prisma.deployment.update({ where: { id: internal.pgId }, data }),
      ...newStatusRows.map((h, i) => prisma.deploymentStatusHistory.create({
        data: {
          deploymentId: internal.pgId,
          order: internal.persistedStatusCount + i,
          status: h.status,
          at: h.at,
          byId: statusByPgIds[i],
          byName: h.byName,
          note: h.note,
        },
      })),
      ...newBillingRows.map((h, i) => prisma.deploymentBillingMethodHistory.create({
        data: {
          deploymentId: internal.pgId,
          order: internal.persistedBillingCount + i,
          method: h.method,
          at: h.at,
          actorId: billingActorPgIds[i],
          actorName: h.actorName,
          reason: h.reason,
        },
      })),
    ]);

    internal.persistedStatusCount = wrapped.statusHistory.length;
    internal.persistedBillingCount = wrapped.billingMethodHistory.length;


    return wrapped;
  };

  return wrapped;
};

/** The actor's id if they are a customer (spend limits), else null. */
const customerActorId = (actor) => (actor && actor.accountType === 'customer' ? actor.id : null);

// ── Queries ───────────────────────────────────────────────────────────────

const findById = async (id) => {
  if (!id) return null;
  const row = await prisma.deployment.findUnique({ where: byPublicId(id), include: DEPLOYMENT_INCLUDE });
  return row ? wrapDeployment(row) : null;
};

/**
 * A deployment that belongs to the requesting account. Anything else — another
 * team's, another customer's — is reported as not found, never as forbidden,
 * so an id cannot be used to learn that a deployment exists.
 */
const findOwned = async (id, teamId) => {
  const row = await prisma.deployment.findUnique({ where: byPublicId(id), include: DEPLOYMENT_INCLUDE });
  if (!row || String(row.teamId) !== String(teamId)) return null;
  return wrapDeployment(row);
};

/**
 * The deployment a retried order already created. Scoped to the account as
 * well as the member: the key is unique per member, but a member of two
 * teams must never be handed the other team's deployment back.
 */
const findByIdempotencyKey = async (userId, idempotencyKey, teamId) => {
  if (!idempotencyKey) return null;
  const userPg = await pgId(prisma.user, userId);
  if (!userPg) return null;
  const row = await prisma.deployment.findFirst({
    where: { userId: userPg, idempotencyKey, teamId: byPublicId(teamId).id },
    include: DEPLOYMENT_INCLUDE,
  });
  return row ? wrapDeployment(row) : null;
};

const listForTeam = async (teamId, { status, page = 1, limit = 20 } = {}) => {
  const where = { teamId: byPublicId(teamId).id, ...(status ? { status } : {}) };
  const { skip, take } = paginate({ page, limit });

  const [rows, total] = await Promise.all([
    prisma.deployment.findMany({
      where, include: DEPLOYMENT_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take,
    }),
    prisma.deployment.count({ where }),
  ]);

  return { deployments: rows.map(wrapDeployment), total };
};

/**
 * Total $/hr currently burning for a customer — powers the runway estimate.
 * Ported from the original implementation (see Deployment.js for the
 * reasoning): counts stopped deployments at their storage rate too.
 */
/**
 * Burn rate for many customers in one query.
 *
 * The background jobs used to call `getBurnRate` once per customer inside a
 * loop, which is a query per customer per run — invisible at five wallets,
 * tens of thousands of queries at scale.
 *
 * @param {string[]} teamIds
 * @returns {Promise<Map<string, number>>} team id -> $/hour
 */
const getBurnRatesFor = async (teamIds = []) => {
  const ids = [...new Set(teamIds.filter(Boolean).map(String))];
  const rates = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return rates;

  const rows = await prisma.deployment.findMany({
    where: {
      teamId: byPublicIds(ids).id,
      status: { in: [...BILLABLE_STATUSES, ...STORAGE_BILLABLE_STATUSES] },
    },
    select: {
      status: true,
      pricePerHour: true,
      stoppedPricePerHour: true,
      planDiscountPercent: true,
      teamId: true,
    },
  });

  for (const d of rows) {
    const key = d.teamId;
    if (!key) continue;
    const base = BILLABLE_STATUSES.includes(d.status) ? num(d.pricePerHour) : num(d.stoppedPricePerHour);
    rates.set(key, (rates.get(key) || 0) + applyDiscount(base, num(d.planDiscountPercent)));
  }

  for (const [k, v] of rates) rates.set(k, Math.round(v * 10000) / 10000);
  return rates;
};

/**
 * The burn rate split by how each deployment is paid for.
 *
 * The two halves behave completely differently when the money runs out, and
 * anything projecting a customer's spend forward has to know which is which: a
 * prepaid deployment is stopped the instant the wallet is exhausted, so its
 * contribution to a forecast is bounded by the balance, while a pay-as-you-go
 * one is never stopped for balance at all and keeps accruing as debt.
 *
 * Computed here rather than in the client so the "what does this cost per
 * hour" rule — full price while running, storage price while paused or
 * stopped, minus any plan discount — stays in one place.
 */
const getBurnRateBreakdown = async (teamId, excludeId = null) => {
  const excludePg = excludeId ? await pgId(prisma.deployment, excludeId) : null;

  const rows = await prisma.deployment.findMany({
    where: {
      teamId: byPublicId(teamId).id,
      status: { in: [...BILLABLE_STATUSES, ...STORAGE_BILLABLE_STATUSES] },
      ...(excludePg ? { id: { not: excludePg } } : {}),
    },
    select: {
      status: true, pricePerHour: true, stoppedPricePerHour: true,
      planDiscountPercent: true, billingMethod: true,
    },
  });

  const round4 = (n) => Math.round(n * 10000) / 10000;
  const split = rows.reduce((acc, d) => {
    const rate = currentRateFor(d);
    acc.total += rate;
    if (d.billingMethod === 'payg') acc.payg += rate;
    else acc.prepaid += rate;
    return acc;
  }, { total: 0, prepaid: 0, payg: 0 });

  return { total: round4(split.total), prepaid: round4(split.prepaid), payg: round4(split.payg) };
};

const getBurnRate = async (teamId, excludeId = null) =>
  (await getBurnRateBreakdown(teamId, excludeId)).total;

/**
 * Every deployment platform-wide currently in one of the given statuses — no
 * user filter. Used by fundingService.enforceCardGateNow, which pauses every
 * running deployment the instant an admin turns the card gate on, regardless
 * of whose it is.
 */
const listByStatuses = async (statuses) => {
  const rows = await prisma.deployment.findMany({ where: { status: { in: statuses } }, include: DEPLOYMENT_INCLUDE });
  return rows.map(wrapDeployment);
};

/** Every deployment currently costing someone something — compute or storage. */
const listBillable = async () => {
  const rows = await prisma.deployment.findMany({
    where: { status: { in: [...BILLABLE_STATUSES, ...STORAGE_BILLABLE_STATUSES] } },
    include: DEPLOYMENT_INCLUDE,
  });
  return rows.map(wrapDeployment);
};

const listPausedFlagged = async (teamId, flagColumn) => {
  const rows = await prisma.deployment.findMany({
    where: { teamId: byPublicId(teamId).id, status: 'paused', [flagColumn]: true },
    include: DEPLOYMENT_INCLUDE,
  });
  return rows.map(wrapDeployment);
};

const listPausedAutoSuspended = (teamId) => listPausedFlagged(teamId, 'autoSuspendedForCredit');
const listPausedCardGateSuspended = (teamId) => listPausedFlagged(teamId, 'cardGateSuspended');
const listPausedDebtLimitSuspended = (teamId) => listPausedFlagged(teamId, 'debtLimitSuspended');

/**
 * Everything of this customer's that is running right now, regardless of how it
 * is paid for.
 *
 * This used to be `listPaygRunning`, filtered to `billingMethod: 'payg'`, on
 * the reasoning that only pay-as-you-go could put an account into debt. That is
 * no longer true and arguably never was: a prepaid deployment bills the full
 * elapsed period too, and whatever the wallet cannot cover becomes debt exactly
 * the same way (see deploymentBilling.planCharge). So an account over the
 * platform's debt limit could have prepaid deployments quietly carrying on
 * while only its pay-as-you-go ones were stopped.
 */
const listRunningForTeam = async (teamId) => {
  const rows = await prisma.deployment.findMany({
    where: { teamId: byPublicId(teamId).id, status: { in: BILLABLE_STATUSES } },
    include: DEPLOYMENT_INCLUDE,
  });
  return rows.map(wrapDeployment);
};

/**
 * Every pay-as-you-go deployment that still exists — anything not terminated
 * or rejected, whatever its status, since a paused PAYG deployment is still
 * PAYG and can be resumed onto it. Optionally for one account. Used by
 * fundingService.enforcePaygAccessNow to find what to move off PAYG.
 */
const listPaygActive = async (teamId = null) => {
  const rows = await prisma.deployment.findMany({
    where: {
      billingMethod: 'payg',
      status: { notIn: ['terminated', 'rejected'] },
      ...(teamId ? { teamId: byPublicId(teamId).id } : {}),
    },
    include: DEPLOYMENT_INCLUDE,
  });
  return rows.map(wrapDeployment);
};

const listUnpaidStorage = async () => {
  const rows = await prisma.deployment.findMany({
    where: { hasUnpaidStorage: true, status: { in: STORAGE_BILLABLE_STATUSES } },
    include: DEPLOYMENT_INCLUDE,
  });
  return rows.map(wrapDeployment);
};

const listStaleProvisioning = async (cutoff) => {
  const rows = await prisma.deployment.findMany({
    where: {
      status: { in: ['pending_review', 'approved', 'provisioning'] },
      createdAt: { lt: cutoff },
      staleProvisioningNotifiedAt: null,
    },
    include: DEPLOYMENT_INCLUDE,
  });
  return rows.map(wrapDeployment);
};

/**
 * The fulfillment queue — filterable by status, model, account or customer.
 * `userId` matches every account the customer owns (their personal account
 * and any team they created), which is what "this customer's deployments"
 * means on the admin customer page.
 */
const listForAdmin = async ({
  status, modelId, userId, teamId, search, needsShutdown, page = 1, limit = 20,
} = {}) => {
  const where = {};
  if (status) where.status = { in: String(status).split(',') };
  if (modelId) {
    const modelPg = await pgId(prisma.aIModel, modelId);
    where.modelId = modelPg || '__none__';
  }
  if (teamId) where.teamId = byPublicId(teamId).id;
  if (userId) where.team = { createdById: byPublicId(userId).id };
  if (search) where.deploymentName = { contains: search, mode: 'insensitive' };
  if (needsShutdown === 'true') where.endpointShutdownRequired = true;

  const { skip, take } = paginate({ page, limit });

  const [rows, total, statusGroups, shutdownPending] = await Promise.all([
    prisma.deployment.findMany({
      where, include: DEPLOYMENT_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take,
    }),
    prisma.deployment.count({ where }),
    prisma.deployment.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.deployment.count({ where: { endpointShutdownRequired: true } }),
  ]);

  const statusCounts = {};
  statusGroups.forEach((g) => { statusCounts[g.status] = g._count._all; });

  return { deployments: rows.map(wrapDeployment), total, statusCounts, shutdownPending };
};

/** Active-deployment count per tier (by tier's legacy id) — admin tiers list's usage column. */
const countActiveByTier = async () => {
  const groups = await prisma.deployment.groupBy({
    by: ['tierId'],
    where: { status: { in: ACTIVE_STATUSES }, tierId: { not: null } },
    _count: { _all: true },
  });
  if (!groups.length) return {};
  const tiers = await prisma.tier.findMany({ where: { id: { in: groups.map((g) => g.tierId) } }, select: { id: true } });
  const byPgId = new Map(tiers.map((t) => [t.id, t.id]));
  const map = {};
  groups.forEach((g) => { const legacy = byPgId.get(g.tierId); if (legacy) map[legacy] = g._count._all; });
  return map;
};

/** All-time deployment count per model (by model's legacy id) — admin models list's usage column. */
const countByModelGrouped = async () => {
  const groups = await prisma.deployment.groupBy({
    by: ['modelId'],
    where: { modelId: { not: null } },
    _count: { _all: true },
  });
  if (!groups.length) return {};
  const models = await prisma.aIModel.findMany({ where: { id: { in: groups.map((g) => g.modelId) } }, select: { id: true } });
  const byPgId = new Map(models.map((m) => [m.id, m.id]));
  const map = {};
  groups.forEach((g) => { const legacy = byPgId.get(g.modelId); if (legacy) map[legacy] = g._count._all; });
  return map;
};

/** Active deployments currently sitting on one tier — the tier delete guard. */
const countActiveForTier = async (tierLegacyId) => {
  const tierPg = await pgId(prisma.tier, tierLegacyId);
  if (!tierPg) return 0;
  return prisma.deployment.count({ where: { tierId: tierPg, status: { in: ACTIVE_STATUSES } } });
};

/** Active deployments currently using one model — the model delete guard. */
const countActiveForModel = async (modelLegacyId) => {
  const modelPg = await pgId(prisma.aIModel, modelLegacyId);
  if (!modelPg) return 0;
  return prisma.deployment.count({ where: { modelId: modelPg, status: { in: ACTIVE_STATUSES } } });
};

/** How many of an account's deployments are currently active — admin wallet detail view. */
const countActiveForTeam = async (teamId) => prisma.deployment.count({
  where: { teamId: byPublicId(teamId).id, status: { in: ACTIVE_STATUSES } },
});

/** All deployments of a set of accounts — the "permanently delete customer" cascade. */
const deleteAllForTeams = async (teamIds, db = prisma) => {
  const ids = byPublicIds(teamIds).id.in;
  if (!ids.length) return;

  const deployments = await db.deployment.findMany({ where: { teamId: { in: ids } }, select: { id: true } });
  if (!deployments.length) return;

  const deploymentPgIds = deployments.map((d) => d.id);

  await db.deploymentUsage.deleteMany({ where: { deploymentId: { in: deploymentPgIds } } });
  // statusHistory/billingMethodHistory/requirements cascade automatically (onDelete: Cascade)
  await db.deployment.deleteMany({ where: { id: { in: deploymentPgIds } } });
};

/**
 * Create a new deployment. Takes exactly the shape the controller already
 * builds (see controllers/customer/deploymentController.js's createDeployment) —
 * this only resolves ids and persists it.
 */
const createDeployment = async (data) => {
  const [userPg, teamPg] = await Promise.all([
    pgId(prisma.user, data.userId),
    pgId(prisma.team, data.teamId),
  ]);
  if (!userPg) throw new Error(`No user found for id ${data.userId}`);
  if (!teamPg) throw new Error(`No account found for id ${data.teamId}`);

  const [modelPg, tierPg, sizingTierPg] = await Promise.all([
    pgId(prisma.aIModel, data.model?.modelId),
    pgId(prisma.tier, data.tier?.tierId),
    pgId(prisma.tier, data.sizing?.recommendedTierId),
  ]);

  const statusHistory = data.statusHistory || [];
  const billingMethodHistory = data.billingMethodHistory || [];
  const requirements = data.requirements || [];

  const [statusByPgIds, billingActorPgIds] = await Promise.all([
    Promise.all(statusHistory.map((h) => pgId(prisma.user, h.by))),
    Promise.all(billingMethodHistory.map((h) => pgId(prisma.user, h.actor))),
  ]);

  let row;
  try {
    row = await prisma.deployment.create({
      data: {
        teamId: teamPg,
        userId: userPg,
        deploymentName: data.deploymentName,
        modelId: modelPg,
        modelName: data.model?.name || '',
        modelSlug: data.model?.slug || '',
        modelFamily: data.model?.family || '',
        modelVersion: data.model?.version || '',
        modelParameterSize: data.model?.parameterSize || '',
        modelContextLength: data.model?.contextLength || 0,
        tierId: tierPg,
        tierName: data.tier?.name || '',
        tierCategoryName: data.tier?.categoryName || '',
        tierGpuModel: data.tier?.gpuModel || '',
        tierGpuCount: data.tier?.gpuCount || 0,
        tierVramGb: data.tier?.vramGb || 0,
        tierVcpu: data.tier?.vcpu || 0,
        tierRamGb: data.tier?.ramGb || 0,
        tierStorageGb: data.tier?.storageGb || 0,
        tierStorageType: data.tier?.storageType || '',
        tierIsCustom: !!data.tier?.isCustom,
        tierCustomBuild: data.tier?.customBuild ?? null,
        region: data.region || 'default',
        pricePerHour: data.pricePerHour,
        stoppedPricePerHour: data.stoppedPricePerHour || 0,
        planDiscountPercent: data.planDiscountPercent || 0,
        currency: data.currency || 'USD',
        billingMethod: data.billingMethod || 'prepaid',
        sizingJourneyKey: data.sizing?.journeyKey || '',
        sizingRecommendedTierId: sizingTierPg,
        sizingRecommendedTierName: data.sizing?.recommendedTierName || '',
        sizingFollowedRecommendation: data.sizing?.followedRecommendation ?? null,
        sizingRequirementProfile: data.sizing?.requirementProfile ?? null,
        sizingReasons: data.sizing?.reasons ?? null,
        sizingSuitabilityVerdict: data.sizing?.suitabilityVerdict || '',
        sizingConfidence: data.sizing?.confidence || '',
        sizingComputedAt: data.sizing?.computedAt || null,
        status: data.status || 'pending_review',
        idempotencyKey: data.idempotencyKey || null,
        requirements: {
          create: requirements.map((r, i) => ({
            questionKey: r.questionKey, question: r.question || '', type: r.type || 'text', answer: r.answer ?? null, order: i,
          })),
        },
        statusHistory: {
          create: statusHistory.map((h, i) => ({
            order: i, status: h.status, at: h.at || new Date(), byId: statusByPgIds[i], byName: h.byName || '', note: h.note || '',
          })),
        },
        billingMethodHistory: {
          create: billingMethodHistory.map((h, i) => ({
            order: i, method: h.method, at: h.at || new Date(),
            actorId: billingActorPgIds[i], actorName: h.actorName || '', reason: h.reason || '',
          })),
        },
      },
      include: DEPLOYMENT_INCLUDE,
    });
  } catch (err) {
    if (err.code === 'P2002' && data.idempotencyKey) {
      const existing = await findByIdempotencyKey(data.userId, data.idempotencyKey, data.teamId);
      if (existing) {
        const dup = new Error('DUPLICATE_IDEMPOTENCY_KEY');
        dup.existing = existing;
        throw dup;
      }
    }
    throw err;
  }

  const wrapped = wrapDeployment(row);
  return wrapped;
};

// ── Business logic (unchanged from the pre-Postgres version) ────────────

/**
 * In-app notification about a deployment, to everyone in its account who
 * should hear about it (teamService.deploymentRecipientIds: its creator plus
 * the Owner/Admins; with `money: true`, the account's money handlers). For a
 * personal account that is the one customer. Never throws.
 *
 * `contentKey` names the copy in `services/notification/notificationCopy.js`
 * so the bell can be re-rendered in the reader's language later; `title` and
 * `message` remain the English record of what was sent. `metadata` carries the
 * placeholders that copy needs — `deploymentName` and `modelName` were already
 * being stored here, which is most of why read-time rendering was cheap.
 */
const notifyCustomer = async (
  deployment,
  {
    type, contentKey = null, title, message, priority = 'medium', metadata = {}, money = false,
  },
) => {
  let recipients;
  try {
    recipients = await require('../team/teamService').deploymentRecipientIds(deployment, { money });
  } catch (err) {
    console.error('[Deployment] Could not resolve notification recipients:', err.message);
    recipients = [deployment.userId];
  }
  for (const recipientId of recipients) {
    await notifyOne(deployment, {
      recipientId, type, contentKey, title, message, priority, metadata,
    });
  }
};

const notifyOne = async (deployment, {
  recipientId, type, contentKey, title, message, priority, metadata,
}) => {
  try {
    await notificationService.createNotification({
      recipientId,
      recipientType: 'customer',
      type,
      contentKey,
      title,
      message,
      priority,
      action: {
        label: 'View Deployment',
        url: `${CUSTOMER_URL()}/deployments/${deployment.id}`,
      },
      metadata: {
        deploymentId: deployment.id,
        deploymentName: deployment.deploymentName,
        modelName: deployment.model?.name,
        status: deployment.status,
        ...metadata,
      },
    });
  } catch (err) {
    console.error('[Deployment] Failed to create customer notification:', err.message);
  }
};

/**
 * Keep Tier.capacity.allocated in step as deployments come and go, so the
 * admin's stock numbers stay meaningful. Tier lives in Postgres — this
 * delegates to catalogService, which writes there first and mirrors the
 * tier's allocated-capacity count in step with its deployments.
 */
const adjustTierAllocation = (tierId, delta) => catalogService.adjustTierAllocation(tierId, delta);

/**
 * The one function that changes a deployment's billing method.
 *
 * Prepaid and pay-as-you-go are not two labels on the same charge — they are
 * two different answers to "what happens when the wallet cannot cover this
 * hour". Prepaid stops the deployment and bills nothing beyond the balance;
 * pay-as-you-go takes what the wallet has and books the rest as debt. So the
 * method in force at the moment an hour was consumed is the one that hour has
 * to be settled under, exactly as `transition()` settles at the old *rate*
 * before a status change moves it.
 *
 * Skipping that settlement was a standing way to get compute for nothing. A
 * deployment run for fifty minutes on pay-as-you-go with an empty wallet, then
 * switched to prepaid before the hourly job came round, was billed under
 * prepaid rules on its next tick: nothing affordable, so nothing charged, and
 * the fifty minutes were written off. Verified against the real services —
 * USD 1.22 of delivered compute captured when left alone, USD 0.00 captured
 * after the switch. Repeatable every hour, on any number of deployments.
 *
 * The funding gate is the second half. `fundingService` decides who may run a
 * tab at all — the card requirement, the minimum lifetime spend and account
 * age, an outstanding balance past its limit, a dispute hold — and it was only
 * ever consulted on the paths that take a deployment from not-running to
 * running. A deployment that was ALREADY running never passes through those,
 * so switching it to pay-as-you-go walked straight past every one of those
 * checks. Also verified: fundingService refused with PAYG_NOT_ELIGIBLE while
 * the switch succeeded anyway.
 *
 * @param {object} deployment  a wrapped deployment — saved by this function
 * @param {'prepaid'|'payg'} method
 * @param {object} [options]
 * @param {object} [options.actor]
 * @param {string} [options.reason]
 * @param {Date}   [options.now]
 * @param {boolean} [options.force]  admin override of the funding gate only —
 *   never of the settlement, which is owed money rather than a policy choice
 */
const changeBillingMethod = async (deployment, method, options = {}) => {
  if (!['prepaid', 'payg'].includes(method)) {
    const err = new Error('Billing method must be "prepaid" or "payg"');
    err.status = 400;
    throw err;
  }

  if (deployment.billingMethod === method) return deployment;

  // A deployment that can never run again has no future hours to pay for, and
  // its past ones are already settled by the transition that closed it.
  if (['terminated', 'rejected'].includes(deployment.status)) {
    const err = new Error(`A ${deployment.status} deployment's billing method cannot be changed`);
    err.status = 400;
    throw err;
  }

  const now = options.now || new Date();

  /**
   * Gate first, so a refusal leaves nothing half-done. Only ever applied on
   * the way INTO pay-as-you-go: moving to prepaid is a customer choosing to
   * pay up front, which needs no permission — if their balance then cannot
   * cover the machine, the hourly job pauses it and offers them the way back,
   * which is the intended behaviour rather than something to pre-empt here.
   */
  if (method === 'payg' && !options.force) {
    await fundingService.assertFunded(deployment.teamId, {
      // The member making the switch — their spend limit applies.
      actorUserId: customerActorId(options.actor),
      rate: deployment.currentRate(),
      excludeDeploymentId: deployment.id,
      billingMethod: 'payg',
      // Moving onto a tab is exactly when the card has to be real.
      liveCardCheck: true,
    });
  }

  /**
   * Settle everything owed under the OLD method before the new one takes over.
   * Never allowed to block the switch — same reasoning as `transition()`: the
   * watermark only advances over what was actually paid, so anything that
   * fails here is still owed and bills on the next pass.
   */
  try {
    await deploymentBilling.billOutstanding(deployment, { now });
  } catch (err) {
    console.error(
      `[Deployment] Could not settle billing before ${deployment.billingMethod} → ${method} `
      + `for ${deployment.id}: ${err.message}`
    );
  }

  deployment.setBillingMethod(method, {
    actor: options.actor,
    reason: options.reason || `Switched to ${method}`,
    at: now,
  });
  await deployment.save();

  return deployment;
};

/**
 * The one function that changes a deployment's status.
 *
 * @param {object} deployment  a wrapped deployment (see wrapDeployment)
 * @param {string} newStatus
 * @param {object} options
 * @param {object} [options.actor]  admin user performing the change (null = system)
 * @param {string} [options.note]
 * @param {boolean} [options.autoSuspendedForCredit]
 * @param {boolean} [options.cardGateSuspended] paused because the card gate
 *   was turned on and the owner had no verified card at that moment
 * @param {boolean} [options.silent] skip customer email/notification
 * @param {Date}   [options.at]     when this actually happened, if not now.
 *   Used when the billing job stops a machine as of the instant the customer's
 *   credit ran out, which is usually earlier than the moment the job noticed.
 *   Billing up to that instant and dating the pause from it are two halves of
 *   the same claim, so they must use the same timestamp.
 */
const transition = async (deployment, newStatus, options = {}) => {
  const { actor = null, note = '', silent = false } = options;
  const from = deployment.status;

  if (from === newStatus) return deployment;

  if (!canTransition(from, newStatus)) {
    const err = new Error(`Cannot change a deployment from "${from}" to "${newStatus}"`);
    err.status = 400;
    throw err;
  }

  /**
   * ── Can this deployment actually afford to run? ──
   *
   * Every path that turns a deployment on funnels through this one line — an
   * admin approving it for the first time, a customer's own resume button,
   * and the job that bulk-resumes everything after a top-up.
   *
   * `forceUnfunded` is the one sanctioned bypass — an admin's deliberate call
   * that a deployment should go live anyway — and it is always logged, never
   * silent.
   */
  if (newStatus === 'running') {
    if (options.forceUnfunded) {
      await activityLogService.logActivity({
        userId: options.actor?.id || deployment.userId,
        userName: options.actor?.name || 'System',
        userEmail: options.actor?.email || 'system@platform.local',
        userRole: options.actor?.role || 'system',
        action: 'deployment_status_changed',
        actionType: 'update',
        targetModel: 'Deployment',
        targetId: deployment.id,
        targetName: deployment.deploymentName,
        description:
          `Funding check overridden for "${deployment.deploymentName}" — forced to running `
          + 'despite insufficient funding',
        metadata: { from, to: newStatus, forceUnfunded: true },
        status: 'success',
      }).catch(() => {});
    } else {
      await fundingService.assertFunded(deployment.teamId, {
        // A customer resuming it — their spend limit applies. An admin or the
        // platform itself (auto-resume after payment) is not a member
        // spending the team's money.
        actorUserId: customerActorId(actor),
        rate: deployment.effectiveRate(),
        excludeDeploymentId: deployment.id,
        billingMethod: deployment.billingMethod || 'prepaid',
        // Taking a machine live commits the platform to collecting for the
        // hours it is about to run, so the card is proven now rather than
        // trusted from whenever it was first typed in.
        liveCardCheck: true,
      });
    }
  }

  // Never let a back-dated instant run past the present or behind the last
  // billed point — either would make the ledger disagree with itself.
  const wallClock = new Date();
  const requested = options.at ? new Date(options.at) : wallClock;
  const floor = deployment.lastBilledAt ? new Date(deployment.lastBilledAt) : null;
  const now = new Date(Math.min(
    wallClock.getTime(),
    Math.max(requested.getTime(), floor ? floor.getTime() : requested.getTime())
  ));

  /**
   * Settle what is owed at the OLD rate before the status changes it. Never
   * allowed to block the transition — the watermark is only advanced for the
   * portion that was actually paid, so a failure here bills those hours on the
   * next pass instead of dropping them.
   */
  let settlement = null;
  try {
    settlement = await deploymentBilling.billOutstanding(deployment, { now });
  } catch (err) {
    console.error(
      `[Deployment] Could not settle billing before ${from} → ${newStatus} `
      + `for ${deployment.id}: ${err.message}`
    );
  }

  /**
   * ── After this there is no next pass ──
   *
   * "It bills on the next pass" is what makes the failure above survivable,
   * and it is only true while something still bills this deployment.
   * `listBillable` returns running, paused and stopped deployments — so the
   * moment one becomes terminated, rejected or failed, any hours still sitting
   * behind its watermark stop being billable by anything, ever, and are simply
   * given away. A transient wallet or database error at the instant a customer
   * clicks Terminate was therefore a silent write-off of delivered compute.
   *
   * So when the destination is terminal and the settlement did not fully
   * clear, the remainder is put on the customer's outstanding balance instead
   * — see settleTerminal for why debt rather than refusing the transition.
   * `settlement === null` means billOutstanding threw outright and nothing was
   * settled at all.
   */
  if (TERMINAL_STATUSES.includes(newStatus) && (settlement === null || settlement.unsettled > 0)) {
    const rescue = await deploymentBilling
      .settleTerminal(deployment, { now })
      .catch((err) => ({ settled: false, amount: null, error: err }));

    if (rescue.settled && rescue.amount > 0) {
      console.log(
        `[Deployment] Final settlement on ${from} → ${newStatus} for ${deployment.id}: `
        + `${deployment.currency || 'USD'} ${rescue.amount} added to the outstanding balance`
      );
    }
  }

  deployment.status = newStatus;
  deployment.pushStatus(newStatus, actor, note, now);

  // ── Billing watermarks ──
  if (newStatus === 'running') {
    if (!deployment.startedAt) deployment.startedAt = now;
    deployment.lastBilledAt = now;
    deployment.autoSuspendedForCredit = false;
    deployment.debtLimitSuspended = false;
    deployment.cardGateSuspended = false;
    deployment.hasUnpaidStorage = false;
    deployment.storageDebtNotifiedAt = null;
    deployment.paygOfferedAt = null;
    if (!deployment.provisionedAt) deployment.provisionedAt = now;
  }

  if (STORAGE_BILLABLE_STATUSES.includes(newStatus)) {
    deployment.lastBilledAt = now;
  }

  if (newStatus === 'provisioning' && !deployment.provisionedAt) {
    deployment.provisionedAt = now;
  }

  if (['paused', 'stopped', 'failed'].includes(newStatus)) {
    deployment.stoppedAt = now;
    deployment.autoSuspendedForCredit = !!options.autoSuspendedForCredit;
    deployment.debtLimitSuspended = !!options.debtLimitSuspended;
    deployment.cardGateSuspended = !!options.cardGateSuspended;
  }

  if (newStatus === 'terminated') {
    deployment.terminatedAt = now;
    deployment.stoppedAt = deployment.stoppedAt || now;
  }

  if (newStatus === 'rejected' && note) {
    deployment.rejectionReason = note;
  }

  /**
   * ── Credentials follow the status ──
   * Never allowed to block the transition — a throw here is logged and the
   * status still moves.
   */
  let endpointResult = { changed: false };
  try {
    endpointResult = await endpointService.applyStatus(deployment, newStatus, {
      actor,
      note,
      enforcement: !!options.autoSuspendedForCredit || !!options.debtLimitSuspended
        || !!options.cardGateSuspended || !!options.enforcement,
    });
  } catch (err) {
    console.error(
      `[Deployment] Credential update failed for ${deployment.id} on ${from} → ${newStatus}: `
      + err.message
    );
  }

  await deployment.save();

  // The owner is needed for the audit trail's actor fallback and for the
  // customer-facing side effects below, so resolve it once.
  const owner = await userService.findById(deployment.userId);

  // ── Capacity accounting ──
  if (['running', 'provisioning'].includes(newStatus) && !['running', 'provisioning'].includes(from)) {
    await adjustTierAllocation(deployment.tier?.tierId, 1);
  }
  if (['terminated', 'rejected', 'failed', 'stopped'].includes(newStatus) &&
      ['running', 'provisioning'].includes(from)) {
    await adjustTierAllocation(deployment.tier?.tierId, -1);
  }

  // ── Audit trail ──
  try {
    await activityLogService.logActivity({
      userId: actor?.id || deployment.userId,
      userName: actor?.name || owner?.name || 'System',
      userEmail: actor?.email || owner?.email || 'system@platform.local',
      userRole: actor?.role || 'system',
      action: 'deployment_status_changed',
      actionType: 'update',
      targetModel: 'Deployment',
      targetId: deployment.id,
      targetName: deployment.deploymentName,
      description: `Deployment "${deployment.deploymentName}" moved from ${from} to ${newStatus}${note ? ` — ${note}` : ''}`,
      metadata: { from, to: newStatus, note },
      status: 'success',
    });
  } catch (err) {
    console.error('[Deployment] Failed to write activity log:', err.message);
  }

  if (silent || !owner) return deployment;

  // ── Customer-facing side effects ──

  if (newStatus === 'approved') {
    await notifyCustomer(deployment, {
      type: 'deployment_approved',
      contentKey: 'deployment.approved',
      title: 'Deployment approved',
      message: `Your ${deployment.model?.name} deployment "${deployment.deploymentName}" was approved and is being set up.`,
    });
    emailService.sendDeploymentApprovedEmail(owner, deployment).catch(() => {});
  }

  if (newStatus === 'running' && from !== 'paused') {
    await notifyCustomer(deployment, {
      type: 'deployment_ready',
      contentKey: 'deployment.ready',
      title: 'Your model is live',
      message: `"${deployment.deploymentName}" is running and ready to accept requests.`,
      priority: 'high',
    });
    emailService.sendDeploymentReadyEmail(owner, deployment).catch(() => {});
  }

  if (newStatus === 'running' && endpointResult.rotated) {
    await notifyCustomer(deployment, {
      type: 'deployment_ready',
      contentKey: 'deployment.keyRotated',
      title: 'New API key issued',
      message:
        `"${deployment.deploymentName}" is running again. Because it was suspended, a new API `
        + 'key was issued and the previous one no longer works — copy the new key from the '
        + 'deployment page before your next request.',
      priority: 'high',
    });
  }

  if (newStatus === 'rejected') {
    // Two keys rather than one: with a reason the message IS the admin's own
    // words and cannot be translated, without one it is our sentence and can.
    await notifyCustomer(deployment, {
      type: 'deployment_rejected',
      contentKey: deployment.rejectionReason ? 'deployment.rejected' : 'deployment.rejectedNoReason',
      title: 'Deployment request declined',
      message: deployment.rejectionReason || 'Your deployment request could not be fulfilled.',
      metadata: { reason: deployment.rejectionReason || null },
      priority: 'high',
    });
    emailService.sendDeploymentRejectedEmail(owner, deployment).catch(() => {});
  }

  if (newStatus === 'paused' && options.autoSuspendedForCredit) {
    const billingModeService = require('../billing/billingModeService');
    const { billingCopy } = require('../billing/copyTemplates');
    const settings = await billingModeService.getBillingSettings();

    // Only the heading is keyed. The body is the operator's own sentence from
    // the Admin Center, which has no language dimension to follow — see the
    // header of services/notification/notificationCopy.js.
    await notifyCustomer(deployment, {
      type: 'deployment_suspended',
      contentKey: 'deployment.pausedNoCredit',
      title: 'Deployment paused — out of credit',
      message: billingCopy(settings, 'autoSuspendedMessage', { deploymentName: deployment.deploymentName }),
      priority: 'urgent',
    });
    // The email states the account's balance, so it goes only to the members
    // who handle the account's money — never to a Developer who created it.
    const moneyIds = await require('../team/teamService').billingRecipientIds(deployment.teamId).catch(() => []);
    for (const recipient of await userService.findManyByIds(moneyIds)) {
      emailService
        .sendDeploymentSuspendedEmail(recipient, deployment, options.balance ?? 0)
        .catch(() => {});
    }
  }

  if (newStatus === 'paused' && options.cardGateSuspended) {
    const billingModeService = require('../billing/billingModeService');
    const { billingCopy } = require('../billing/copyTemplates');
    const settings = await billingModeService.getBillingSettings();

    await notifyCustomer(deployment, {
      type: 'deployment_suspended',
      contentKey: 'deployment.pausedCardRequired',
      title: 'Deployment paused — verified card required',
      message: billingCopy(
        settings, 'checkoutCardRequiredMessage', {},
        'A verified card is required before this deployment can run. Add one to resume it.'
      ),
      priority: 'urgent',
    });
  }

  return deployment;
};

/**
 * Resume every deployment that was auto-paused for lack of credit.
 * Called after a successful top-up. Customer-paused deployments stay paused.
 */
const resumeCreditSuspended = async (teamId) => {
  const suspended = await listPausedAutoSuspended(teamId);

  const resumed = [];
  for (const deployment of suspended) {
    try {
      await transition(deployment, 'running', {
        note: 'Automatically resumed after credit top-up',
        silent: true,
      });
      resumed.push(deployment);
    } catch (err) {
      console.error(`[Deployment] Failed to resume ${deployment.id}:`, err.message);
    }
  }

  if (resumed.length) {
    console.log(`[Deployment] Resumed ${resumed.length} credit-suspended deployment(s) for account ${teamId}`);
  }
  return resumed;
};

/**
 * Resume every deployment that was paused for crossing the platform's debt
 * limit — but only once the account is genuinely back under it.
 *
 * This is deliberately NOT the same as resumeCreditSuspended. That function
 * fires on any top-up because "ran out of prepaid balance" is fixed by any
 * top-up. Being over a debt limit is not: a $1 payment against a $2,766 debt
 * against a $1,000 limit leaves the account exactly as blocked as before, so
 * this re-checks debtService.status() rather than trusting that a payment
 * happened at all. Called from the same payment-webhook and admin-credit
 * call sites as resumeCreditSuspended (so paying down debt resumes within
 * the request, not the next billing tick), and from debtEnforcement's own
 * cadence (so it self-heals even with no webhook involved).
 */
const resumeDebtLimitSuspended = async (teamId, { settings, now = new Date() } = {}) => {
  const effectiveSettings = settings || await require('../billing/billingModeService').getBillingSettings();
  const status = await debtService.status(teamId, { settings: effectiveSettings, now });
  if (status.blocked) return [];

  const suspended = await listPausedDebtLimitSuspended(teamId);
  const resumed = [];
  for (const deployment of suspended) {
    try {
      await transition(deployment, 'running', {
        note: "Automatically resumed — outstanding balance is back within the platform's limit",
        silent: true,
      });
      resumed.push(deployment);
    } catch (err) {
      console.error(`[Deployment] Failed to resume ${deployment.id}:`, err.message);
    }
  }

  if (resumed.length) {
    console.log(`[Deployment] Resumed ${resumed.length} debt-limit-suspended deployment(s) for account ${teamId}`);
  }
  return resumed;
};

/**
 * Resume every deployment that was paused for the card gate. Called after a
 * customer successfully adds a verified card.
 */
const resumeCardGateSuspended = async (teamId) => {
  const suspended = await listPausedCardGateSuspended(teamId);

  const resumed = [];
  for (const deployment of suspended) {
    try {
      await transition(deployment, 'running', {
        note: 'Automatically resumed after a verified card was added',
        silent: true,
      });
      resumed.push(deployment);
    } catch (err) {
      console.error(`[Deployment] Failed to resume ${deployment.id}:`, err.message);
    }
  }

  if (resumed.length) {
    console.log(`[Deployment] Resumed ${resumed.length} card-gate-suspended deployment(s) for account ${teamId}`);
  }
  return resumed;
};

/**
 * Set (or replace) the endpoint credentials an admin provisioned by hand.
 */
const setEndpoint = async (deployment, { url, apiKey, docsUrl, extra }, actor = null) => {
  const { cryptoHelper } = require('../../utils/helpers');

  if (url !== undefined) deployment.endpoint.url = url;
  if (docsUrl !== undefined) deployment.endpoint.docsUrl = docsUrl;
  if (extra !== undefined) deployment.endpoint.extra = extra;

  if (apiKey) {
    deployment.endpoint.apiKeyEncrypted = cryptoHelper.encrypt(apiKey);
    deployment.endpoint.apiKeyMasked = cryptoHelper.mask(apiKey);
    deployment.endpoint.keyVersion = (deployment.endpoint.keyVersion || 1) + 1;

    deployment.endpoint.active = true;
    deployment.endpoint.suspendedAt = null;
    deployment.endpoint.suspendReason = '';
    deployment.endpoint.suspendedForEnforcement = false;
    deployment.endpoint.revokedAt = null;
    deployment.endpoint.revokeReason = '';
  }

  await deployment.save();

  try {
    await activityLogService.logActivity({
      userId: actor?.id || deployment.userId,
      userName: actor?.name || 'system',
      userEmail: actor?.email || 'system@platform.local',
      userRole: actor?.role || 'system',
      action: 'deployment_endpoint_set',
      actionType: 'update',
      targetModel: 'Deployment',
      targetId: deployment.id,
      targetName: deployment.deploymentName,
      description: `Endpoint credentials set for "${deployment.deploymentName}"`,
      metadata: { url: deployment.endpoint.url },
      status: 'success',
    });
  } catch (err) {
    console.error('[Deployment] Failed to log endpoint update:', err.message);
  }

  return deployment;
};

module.exports = {
  ALLOWED_TRANSITIONS,
  canTransition,
  transition,
  changeBillingMethod,
  resumeCreditSuspended,
  resumeDebtLimitSuspended,
  resumeCardGateSuspended,
  setEndpoint,
  notifyCustomer,
  adjustTierAllocation,
  wrapDeployment,
  findById,
  findOwned,
  findByIdempotencyKey,
  listForTeam,
  getBurnRate,
  getBurnRateBreakdown,
  getBurnRatesFor,
  listByStatuses,
  listBillable,
  listPausedAutoSuspended,
  listPausedCardGateSuspended,
  listPausedDebtLimitSuspended,
  listPaygActive,
  listRunningForTeam,
  listUnpaidStorage,
  listStaleProvisioning,
  listForAdmin,
  countActiveForTeam,
  countActiveByTier,
  countByModelGrouped,
  countActiveForTier,
  countActiveForModel,
  deleteAllForTeams,
  createDeployment,
};
