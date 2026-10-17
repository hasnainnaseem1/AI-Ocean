/**
 * What the hardware is doing: machine types, their stock, what ran on them,
 * what customers asked for that we do not stock, and whether our own sizing
 * advice is any good.
 *
 * ── Two joins worth knowing about ──
 *
 * `deployment_usages` is the fact table but carries no `tier_id` and no
 * `model_id`, so anything per-tier or per-model joins `deployments`. It DOES
 * carry `kind` (compute vs storage) and its own `status` snapshot taken at the
 * billing tick, so "machine hours" and "hours billed while paused" come
 * straight from the fact table without a join and without misattributing
 * history the way the deployment's *current* status would.
 *
 * Custom builds never create a `Tier` row — the parts list is JSON on the
 * deployment (`tier_custom_build`). So "which component do people keep asking
 * for" is a jsonb expansion, not a relational join, and it is the only
 * question here that cannot be answered any other way.
 */
const prisma = require('../../lib/prismaClient');
const { bucketExpr, fillSeries, describe } = require('./timeWindow');
const {
  num, round2, round4, pct, median, percentile, withShare,
} = require('./numeric');

/* ── Machine types, their stock and what ran on them ──────────────────── */

const getTiers = async (window, policy) => {
  const capacity = policy?.capacity || {};
  const lowPercent = Number(capacity.lowStockPercent) || 25;
  const criticalPercent = Number(capacity.criticalStockPercent) || 10;

  const [tiers, usageRows, activeRows, lastOutages] = await Promise.all([
    prisma.tier.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, status: true, capacityTotal: true, capacityAllocated: true,
        pricePerHour: true, gpuModel: true, gpuCount: true, vramGb: true,
        category: { select: { name: true } },
      },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.$queryRawUnsafe(
      `SELECT d."tier_id" AS tier_id,
              COALESCE(SUM(CASE WHEN du."kind" = 'compute' THEN du."hours" ELSE 0 END), 0)::float AS hours,
              COALESCE(SUM(du."amount"), 0)::float AS amount,
              COUNT(DISTINCT du."deployment_id")::int AS deployments
       FROM "deployment_usages" du
       JOIN "deployments" d ON d."id" = du."deployment_id"
       WHERE du."period_start" >= $1 AND du."period_start" <= $2 AND d."tier_id" IS NOT NULL
       GROUP BY d."tier_id"`,
      window.from, window.to,
    ),
    prisma.deployment.groupBy({
      by: ['tierId'],
      where: { status: { in: ['running', 'provisioning', 'paused'] }, tierId: { not: null } },
      _count: { _all: true },
    }),
    prisma.$queryRawUnsafe(
      `SELECT "tier_id", MAX("at") AS last_out
       FROM "tier_capacity_events"
       WHERE "status" = 'out_of_stock'
       GROUP BY "tier_id"`,
    ),
  ]);

  const usageByTier = new Map(usageRows.map((r) => [r.tier_id, r]));
  const activeByTier = new Map(activeRows.map((r) => [r.tierId, r._count._all]));
  const lastOutByTier = new Map(lastOutages.map((r) => [r.tier_id, r.last_out]));

  const rows = tiers.map((t) => {
    const total = t.capacityTotal || 0;
    const allocated = t.capacityAllocated || 0;
    const available = total > 0 ? Math.max(0, total - allocated) : null;
    const freePercent = total > 0 ? pct(available, total) : null;
    const usage = usageByTier.get(t.id);

    /*
     * `capacityTotal = 0` means no declared ceiling, not "none left". Calling
     * that 0% free would put an unlimited tier at the top of the low-stock
     * list every single day, and the operator would learn to ignore the list.
     */
    let stockLevel = 'unlimited';
    if (total > 0) {
      if (t.status === 'out_of_stock' || available === 0) stockLevel = 'out';
      else if (freePercent <= criticalPercent) stockLevel = 'critical';
      else if (freePercent <= lowPercent) stockLevel = 'low';
      else stockLevel = 'ok';
    }

    return {
      id: t.id,
      name: t.name,
      category: t.category?.name || '',
      gpu: t.gpuModel ? `${t.gpuCount || 1}× ${t.gpuModel}` : '',
      vramGb: t.vramGb,
      status: t.status,
      capacityTotal: total,
      capacityAllocated: allocated,
      available,
      freePercent,
      utilisationPercent: total > 0 ? pct(allocated, total) : null,
      stockLevel,
      activeDeployments: activeByTier.get(t.id) || 0,
      hoursInWindow: round4(usage?.hours),
      revenueInWindow: round2(usage?.amount),
      deploymentsInWindow: usage?.deployments || 0,
      pricePerHour: round4(num(t.pricePerHour)),
      lastStockOutAt: lastOutByTier.get(t.id) || null,
    };
  });

  return {
    tiers: rows,
    totals: {
      tiers: rows.length,
      out: rows.filter((r) => r.stockLevel === 'out').length,
      critical: rows.filter((r) => r.stockLevel === 'critical').length,
      low: rows.filter((r) => r.stockLevel === 'low').length,
      unlimited: rows.filter((r) => r.stockLevel === 'unlimited').length,
      capacityTotal: rows.reduce((s, r) => s + r.capacityTotal, 0),
      capacityAllocated: rows.reduce((s, r) => s + r.capacityAllocated, 0),
    },
    thresholds: { lowPercent, criticalPercent },
    window: describe(window),
  };
};

/* ── Stock over time ──────────────────────────────────────────────────── */

/**
 * The daily heartbeat rows, which is the only reason the capacity log keeps
 * them forever. Change rows are pruned; these are the history.
 */
const getCapacityTrend = async (window, { tierId = null } = {}) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${bucketExpr(window.granularity, 'e."at"', window.timezone)} AS bucket,
            e."tier_id" AS tier_id, t."name" AS tier_name,
            AVG(e."available")::float          AS available,
            AVG(e."capacity_allocated")::float AS allocated,
            MAX(e."capacity_total")::int       AS total
     FROM "tier_capacity_events" e
     JOIN "tiers" t ON t."id" = e."tier_id"
     WHERE e."is_heartbeat" = true AND e."at" >= $1 AND e."at" <= $2
       ${tierId ? 'AND e."tier_id" = $3::uuid' : ''}
     GROUP BY 1, 2, 3
     ORDER BY 1`,
    ...(tierId ? [window.from, window.to, tierId] : [window.from, window.to]),
  );

  return {
    series: rows.map((r) => ({
      bucket: r.bucket,
      tierId: r.tier_id,
      tierName: r.tier_name,
      available: round2(r.available),
      allocated: round2(r.allocated),
      total: r.total,
      utilisationPercent: r.total > 0 ? pct(r.allocated, r.total) : null,
    })),
    window: describe(window),
  };
};

/**
 * How long each machine type spent unavailable.
 *
 * `lead()` over the event log turns a list of state changes into durations —
 * each out-of-stock row lasts until the next event for that tier, or until the
 * end of the window if it is still out. This is the question the whole
 * capacity log was added to answer.
 */
const getStockOutages = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `WITH ordered AS (
       SELECT e."tier_id", e."at", e."status",
              lead(e."at") OVER (PARTITION BY e."tier_id" ORDER BY e."at") AS next_at
       FROM "tier_capacity_events" e
       WHERE e."at" >= $1 AND e."at" <= $2
     )
     SELECT o."tier_id" AS tier_id, t."name" AS tier_name,
            o."at" AS from_at,
            COALESCE(o."next_at", $2) AS to_at,
            (EXTRACT(EPOCH FROM (COALESCE(o."next_at", $2) - o."at")) / 3600)::float AS hours
     FROM ordered o
     JOIN "tiers" t ON t."id" = o."tier_id"
     WHERE o."status" = 'out_of_stock'
     ORDER BY o."at" DESC`,
    window.from, window.to,
  );

  const byTier = new Map();
  for (const r of rows) {
    const entry = byTier.get(r.tier_id) || { tierId: r.tier_id, tierName: r.tier_name, hoursOut: 0, occurrences: 0 };
    entry.hoursOut += num(r.hours);
    entry.occurrences += 1;
    byTier.set(r.tier_id, entry);
  }

  return {
    outages: rows.slice(0, 100).map((r) => ({
      tierId: r.tier_id,
      tierName: r.tier_name,
      from: r.from_at,
      to: r.to_at,
      hours: round2(r.hours),
    })),
    totals: [...byTier.values()]
      .map((e) => ({ ...e, hoursOut: round2(e.hoursOut) }))
      .sort((a, b) => b.hoursOut - a.hoursOut),
    window: describe(window),
  };
};

/* ── What was consumed ────────────────────────────────────────────────── */

const getConsumption = async (window) => {
  const [byTier, byModel, byKindStatus, seriesRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(d."tier_name", 'Unnamed') AS label,
              d."tier_id" AS tier_id,
              bool_or(d."tier_is_custom") AS any_custom,
              COALESCE(SUM(CASE WHEN du."kind" = 'compute' THEN du."hours" ELSE 0 END), 0)::float AS hours,
              COALESCE(SUM(du."amount"), 0)::float AS amount,
              COUNT(DISTINCT du."deployment_id")::int AS deployments
       FROM "deployment_usages" du
       JOIN "deployments" d ON d."id" = du."deployment_id"
       WHERE du."period_start" >= $1 AND du."period_start" <= $2
       GROUP BY 1, 2
       ORDER BY amount DESC`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(NULLIF(d."model_name", ''), 'Unknown model') AS label,
              COALESCE(SUM(CASE WHEN du."kind" = 'compute' THEN du."hours" ELSE 0 END), 0)::float AS hours,
              COALESCE(SUM(du."amount"), 0)::float AS amount,
              COUNT(DISTINCT du."deployment_id")::int AS deployments
       FROM "deployment_usages" du
       JOIN "deployments" d ON d."id" = du."deployment_id"
       WHERE du."period_start" >= $1 AND du."period_start" <= $2
       GROUP BY 1
       ORDER BY amount DESC
       LIMIT 20`,
      window.from, window.to,
    ),
    // `kind` and the per-tick `status` both live on the fact table, so this
    // needs no join at all — and reads the status as it was when billed.
    prisma.$queryRawUnsafe(
      `SELECT du."kind" AS kind,
              COALESCE(NULLIF(du."status", ''), 'unknown') AS status,
              COALESCE(SUM(du."hours"), 0)::float  AS hours,
              COALESCE(SUM(du."amount"), 0)::float AS amount
       FROM "deployment_usages" du
       WHERE du."period_start" >= $1 AND du."period_start" <= $2
       GROUP BY 1, 2`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, 'du."period_start"', window.timezone)} AS bucket,
              COALESCE(SUM(CASE WHEN du."kind" = 'compute' THEN du."hours" ELSE 0 END), 0)::float AS compute_hours,
              COALESCE(SUM(CASE WHEN du."kind" = 'storage' THEN du."hours" ELSE 0 END), 0)::float AS storage_hours,
              COALESCE(SUM(du."amount"), 0)::float AS amount
       FROM "deployment_usages" du
       WHERE du."period_start" >= $1 AND du."period_start" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
  ]);

  const kindTotals = { compute: { hours: 0, amount: 0 }, storage: { hours: 0, amount: 0 } };
  const statusTotals = new Map();
  for (const r of byKindStatus) {
    const k = kindTotals[r.kind] || (kindTotals[r.kind] = { hours: 0, amount: 0 });
    k.hours += num(r.hours);
    k.amount += num(r.amount);
    const s = statusTotals.get(r.status) || { status: r.status, hours: 0, amount: 0 };
    s.hours += num(r.hours);
    s.amount += num(r.amount);
    statusTotals.set(r.status, s);
  }

  return {
    byTier: withShare(byTier.map((r) => ({
      tierId: r.tier_id,
      label: r.any_custom && !r.tier_id ? 'Custom builds' : r.label,
      isCustom: !!r.any_custom && !r.tier_id,
      hours: round4(r.hours),
      amount: round2(r.amount),
      deployments: r.deployments,
    })), 'amount'),
    byModel: withShare(byModel.map((r) => ({
      label: r.label, hours: round4(r.hours), amount: round2(r.amount), deployments: r.deployments,
    })), 'amount'),
    byKind: {
      compute: { hours: round4(kindTotals.compute.hours), amount: round2(kindTotals.compute.amount) },
      storage: { hours: round4(kindTotals.storage.hours), amount: round2(kindTotals.storage.amount) },
    },
    byStatus: [...statusTotals.values()]
      .map((s) => ({ ...s, hours: round4(s.hours), amount: round2(s.amount) }))
      .sort((a, b) => b.amount - a.amount),
    series: fillSeries(seriesRows, window, {
      fields: { compute_hours: 0, storage_hours: 0, amount: 0 },
    }).map((r) => ({
      bucket: r.bucket,
      computeHours: round4(r.compute_hours),
      storageHours: round4(r.storage_hours),
      amount: round2(r.amount),
    })),
    window: describe(window),
  };
};

/* ── Components, and what customers wanted that we do not stock ───────── */

const getComponents = async (window) => {
  const [catalogue, tierUse, demandRows] = await Promise.all([
    prisma.resourceComponent.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, kind: true, unitLabel: true, pricePerUnitPerHour: true,
        availableForCustomBuilds: true,
      },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.tierComponent.groupBy({
      by: ['componentId'],
      _count: { _all: true },
      _sum: { quantity: true },
    }),
    /*
     * The parts list of a custom build is JSON on the deployment — there is no
     * relational row to join, because a custom build never creates a Tier. So
     * this expands the stored `lines` array and groups it, which is the only
     * way to see demand that the catalogue never served.
     */
    prisma.$queryRawUnsafe(
      `SELECT line->>'componentId'                    AS component_id,
              line->>'name'                           AS name,
              line->>'kind'                           AS kind,
              COUNT(*)::int                           AS requests,
              COALESCE(SUM((line->>'quantity')::numeric), 0)::float AS total_quantity
       FROM "deployments" d,
            LATERAL jsonb_array_elements(COALESCE(d."tier_custom_build"->'lines', '[]'::jsonb)) AS line
       WHERE d."tier_is_custom" = true
         AND d."created_at" >= $1 AND d."created_at" <= $2
       GROUP BY 1, 2, 3
       ORDER BY requests DESC
       LIMIT 50`,
      window.from, window.to,
    ),
  ]);

  const useByComponent = new Map(tierUse.map((r) => [r.componentId, r]));
  const catalogueIds = new Set(catalogue.map((c) => c.id));

  return {
    catalogue: catalogue.map((c) => ({
      componentId: c.id,
      name: c.name,
      kind: c.kind,
      unitLabel: c.unitLabel,
      pricePerUnitPerHour: round4(num(c.pricePerUnitPerHour)),
      availableForCustomBuilds: c.availableForCustomBuilds,
      usedInTiers: useByComponent.get(c.id)?._count?._all || 0,
      unitsAcrossTiers: round2(num(useByComponent.get(c.id)?._sum?.quantity)),
    })),
    customBuildDemand: demandRows.map((r) => ({
      componentId: r.component_id,
      name: r.name || 'Unknown component',
      kind: r.kind || '',
      requests: r.requests,
      totalQuantity: round2(r.total_quantity),
      // A component asked for in a custom build that is no longer in the
      // active catalogue is the interesting row: demand we are not serving.
      inCatalogue: catalogueIds.has(r.component_id),
    })),
    window: describe(window),
  };
};

/* ── Deployment lifecycle: where requests stall ───────────────────────── */

const getLifecycle = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT d."id", d."created_at", d."provisioned_at", d."started_at", d."status",
            MIN(CASE WHEN h."status" = 'approved' THEN h."at" END) AS approved_at,
            MIN(CASE WHEN h."status" = 'rejected' THEN h."at" END) AS rejected_at
     FROM "deployments" d
     LEFT JOIN "deployment_status_history" h ON h."deployment_id" = d."id"
     WHERE d."created_at" >= $1 AND d."created_at" <= $2
     GROUP BY d."id", d."created_at", d."provisioned_at", d."started_at", d."status"`,
    window.from, window.to,
  );

  const mins = (a, b) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 60000 : null);

  const created = rows.length;
  const approved = rows.filter((r) => r.approved_at).length;
  const provisioned = rows.filter((r) => r.provisioned_at).length;
  const running = rows.filter((r) => r.started_at).length;
  const rejected = rows.filter((r) => r.rejected_at).length;
  const failed = rows.filter((r) => r.status === 'failed').length;

  const approvalMins = rows.map((r) => mins(r.created_at, r.approved_at)).filter((v) => v !== null);
  const toLiveMins = rows.map((r) => mins(r.approved_at, r.started_at)).filter((v) => v !== null);

  const stage = (label, count, prev, latency) => ({
    stage: label,
    count,
    conversionFromPrev: prev === null ? null : pct(count, prev),
    medianMinutesFromPrev: latency === undefined ? null : (latency === null ? null : Math.round(latency)),
  });

  return {
    funnel: [
      stage('Requested', created, null),
      stage('Approved', approved, created, median(approvalMins)),
      stage('Provisioned', provisioned, approved, null),
      stage('Running', running, provisioned, median(toLiveMins)),
    ],
    approvalLatency: {
      medianMinutes: approvalMins.length ? Math.round(median(approvalMins)) : null,
      p90Minutes: approvalMins.length ? Math.round(percentile(approvalMins, 90)) : null,
      sampled: approvalMins.length,
    },
    timeToLive: {
      medianMinutes: toLiveMins.length ? Math.round(median(toLiveMins)) : null,
      p90Minutes: toLiveMins.length ? Math.round(percentile(toLiveMins, 90)) : null,
      sampled: toLiveMins.length,
    },
    rejected,
    rejectionRate: pct(rejected, created),
    failed,
    failureRate: pct(failed, created),
    window: describe(window),
  };
};

/* ── Is our own sizing advice any good? ───────────────────────────────── */

/**
 * The platform records, on every deployment, which tier the recommendation
 * engine suggested and whether the customer took it
 * (`sizing_followed_recommendation`) — and nothing has ever read it.
 *
 * This compares what happened next. If deployments that followed the advice
 * live longer and get terminated less, the engine is earning its place; if
 * they do not, the engine is confidently wrong and that is worth knowing
 * before tuning it further.
 */
const getSizingEffectiveness = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT d."sizing_followed_recommendation" AS followed,
            COALESCE(NULLIF(d."sizing_suitability_verdict", ''), 'unknown') AS verdict,
            COALESCE(NULLIF(d."sizing_confidence", ''), 'unknown')          AS confidence,
            COALESCE(NULLIF(d."sizing_recommended_tier_name", ''), '')      AS recommended_tier,
            COALESCE(NULLIF(d."tier_name", ''), '')                          AS chosen_tier,
            d."status", d."created_at", d."terminated_at",
            COALESCE(d."total_runtime_hours", 0)::float AS runtime_hours,
            COALESCE(d."total_cost", 0)::float          AS total_cost
     FROM "deployments" d
     WHERE d."created_at" >= $1 AND d."created_at" <= $2
       AND d."sizing_computed_at" IS NOT NULL`,
    window.from, window.to,
  );

  const WEEK_MS = 7 * 86400000;
  const outcome = (subset) => ({
    count: subset.length,
    medianRuntimeHours: subset.length ? round2(median(subset.map((r) => r.runtime_hours))) : null,
    medianSpend: subset.length ? round2(median(subset.map((r) => r.total_cost))) : null,
    terminatedWithin7dPercent: pct(
      subset.filter((r) => r.terminated_at
        && new Date(r.terminated_at).getTime() - new Date(r.created_at).getTime() < WEEK_MS).length,
      subset.length,
    ),
    stillRunningPercent: pct(subset.filter((r) => r.status === 'running').length, subset.length),
  });

  const followed = rows.filter((r) => r.followed === true);
  const notFollowed = rows.filter((r) => r.followed === false);

  const group = (field) => {
    const map = new Map();
    for (const r of rows) {
      const key = r[field];
      const e = map.get(key) || { key, count: 0, followed: 0 };
      e.count += 1;
      if (r.followed === true) e.followed += 1;
      map.set(key, e);
    }
    return [...map.values()]
      .map((e) => ({ key: e.key, count: e.count, followedPercent: pct(e.followed, e.count) }))
      .sort((a, b) => b.count - a.count);
  };

  // Where the engine said one thing and the customer did another — the most
  // direct signal about which recommendation is not believed.
  const overrides = new Map();
  for (const r of notFollowed) {
    if (!r.recommended_tier || !r.chosen_tier) continue;
    const key = `${r.recommended_tier} → ${r.chosen_tier}`;
    overrides.set(key, (overrides.get(key) || 0) + 1);
  }

  return {
    sampled: rows.length,
    followedPercent: pct(followed.length, followed.length + notFollowed.length),
    byVerdict: group('verdict'),
    byConfidence: group('confidence'),
    outcomes: { followed: outcome(followed), notFollowed: outcome(notFollowed) },
    topOverrides: [...overrides.entries()]
      .map(([key, count]) => ({ change: key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    window: describe(window),
  };
};

/* ── Custom builds ────────────────────────────────────────────────────── */

const getCustomBuilds = async (window) => {
  const [counts, builds] = await Promise.all([
    prisma.deployment.groupBy({
      by: ['tierIsCustom'],
      where: { createdAt: { gte: window.from, lte: window.to } },
      _count: { _all: true },
      _sum: { totalCost: true },
    }),
    prisma.deployment.findMany({
      where: { tierIsCustom: true, createdAt: { gte: window.from, lte: window.to } },
      select: { tierCustomBuild: true, totalCost: true, tierGpuModel: true, tierGpuCount: true },
      take: 500,
    }),
  ]);

  const custom = counts.find((c) => c.tierIsCustom === true);
  const catalogue = counts.find((c) => c.tierIsCustom === false);
  const total = (custom?._count?._all || 0) + (catalogue?._count?._all || 0);

  // Identical builds collapse to one signature, so "six people built the same
  // thing" reads as a tier we should probably be selling.
  const signatures = new Map();
  for (const b of builds) {
    const lines = Array.isArray(b.tierCustomBuild?.lines) ? b.tierCustomBuild.lines : [];
    if (!lines.length) continue;
    const parts = lines
      .map((l) => `${l.quantity}× ${l.name}`)
      .sort();
    const key = parts.join(' + ');
    const e = signatures.get(key) || { signature: key, parts, count: 0 };
    e.count += 1;
    signatures.set(key, e);
  }

  return {
    count: custom?._count?._all || 0,
    catalogueCount: catalogue?._count?._all || 0,
    sharePercent: pct(custom?._count?._all || 0, total),
    medianSpend: builds.length ? round2(median(builds.map((b) => num(b.totalCost)))) : null,
    topConfigurations: [...signatures.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    window: describe(window),
  };
};

module.exports = {
  getTiers,
  getCapacityTrend,
  getStockOutages,
  getConsumption,
  getComponents,
  getLifecycle,
  getSizingEffectiveness,
  getCustomBuilds,
};
