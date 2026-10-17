/**
 * Recording what a machine type's stock was, at the moment it changed.
 *
 * ── Why this is one function and not a call at each site ──
 *
 * The log is only trustworthy if it is written in the SAME transaction as the
 * capacity change. A row written just after the update drifts the moment two
 * deployments start at once, and every outage duration computed from it
 * afterwards is quietly wrong — quietly, because a stock history has no
 * obvious "this is broken" symptom; it just reports a number nobody can check.
 *
 * So `record` takes a transaction client, and the services that change
 * capacity call it inside their own `$transaction`. There is deliberately no
 * variant that takes the plain client: a call site that could forget the
 * transaction is a call site that eventually will.
 */
const prisma = require('../../lib/prismaClient');

/**
 * @param {Object} tx     a Prisma transaction client — NOT the plain client
 * @param {Object} tier    the tier row AFTER the change (needs capacityTotal,
 *                         capacityAllocated, status, pricePerHour, id)
 * @param {Object} opts    { reason, isHeartbeat, activeDeployments }
 */
const record = async (tx, tier, opts = {}) => {
  if (!tier?.id) return null;

  const total = Number(tier.capacityTotal) || 0;
  const allocated = Number(tier.capacityAllocated) || 0;

  return tx.tierCapacityEvent.create({
    data: {
      tierId: tier.id,
      capacityTotal: total,
      capacityAllocated: allocated,
      // Stored rather than derived so a reader never has to know that a
      // `capacityTotal` of 0 means "no declared ceiling" rather than "none
      // left" — the difference between an outage and an unlimited tier.
      available: total > 0 ? Math.max(0, total - allocated) : 0,
      status: tier.status,
      pricePerHour: tier.pricePerHour ?? 0,
      activeDeployments: Number(opts.activeDeployments) || 0,
      reason: opts.reason || '',
      isHeartbeat: !!opts.isHeartbeat,
    },
  });
};

/**
 * One heartbeat row per active tier, for the daily series.
 *
 * Idempotent per tier per day: a second run on the same day updates the
 * existing heartbeat instead of adding another, so re-running the rollup job
 * — after a restart, or because an admin triggered it by hand — cannot
 * double-count a day. Same posture `teamSeatFee` takes with its (team, day)
 * unique index; here the day is derived because a tier may legitimately have
 * many non-heartbeat rows on the same day.
 */
const writeHeartbeats = async (now = new Date()) => {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const tiers = await prisma.tier.findMany({
    where: { isActive: true },
    select: {
      id: true, capacityTotal: true, capacityAllocated: true, status: true, pricePerHour: true,
    },
  });
  if (!tiers.length) return { written: 0, updated: 0 };

  const active = await prisma.deployment.groupBy({
    by: ['tierId'],
    where: { tierId: { in: tiers.map((t) => t.id) }, status: { in: ['running', 'provisioning', 'paused'] } },
    _count: { _all: true },
  });
  const activeByTier = new Map(active.map((a) => [a.tierId, a._count._all]));

  let written = 0;
  let updated = 0;

  for (const tier of tiers) {
    const existing = await prisma.tierCapacityEvent.findFirst({
      where: { tierId: tier.id, isHeartbeat: true, at: { gte: dayStart } },
      select: { id: true },
    });

    const total = Number(tier.capacityTotal) || 0;
    const allocated = Number(tier.capacityAllocated) || 0;
    const data = {
      capacityTotal: total,
      capacityAllocated: allocated,
      available: total > 0 ? Math.max(0, total - allocated) : 0,
      status: tier.status,
      pricePerHour: tier.pricePerHour ?? 0,
      activeDeployments: activeByTier.get(tier.id) || 0,
      at: now,
    };

    if (existing) {
      await prisma.tierCapacityEvent.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.tierCapacityEvent.create({
        data: { ...data, tierId: tier.id, reason: 'heartbeat', isHeartbeat: true },
      });
      written += 1;
    }
  }

  return { written, updated };
};

/**
 * Drop change rows older than the retention window. Heartbeats are kept
 * indefinitely — one row per tier per day is nothing, and they ARE the
 * long-term stock history, so pruning them would throw away the only reason
 * this table exists.
 */
const prune = async (retentionDays = 180) => {
  const cutoff = new Date(Date.now() - Number(retentionDays) * 86400000);
  const { count } = await prisma.tierCapacityEvent.deleteMany({
    where: { isHeartbeat: false, at: { lt: cutoff } },
  });
  return count;
};

module.exports = { record, writeHeartbeats, prune };
