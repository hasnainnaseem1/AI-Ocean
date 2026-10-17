/**
 * The Dashboard's payload: a handful of headline numbers, the series behind
 * them, and who the biggest accounts are.
 *
 * ── Two corrections to how the old Dashboard counted ──
 *
 * 1. **Money is grouped by account, not by person.** Since the Teams work,
 *    every wallet, payment, deployment and usage row belongs to a `Team` —
 *    a customer's personal account is one, an organization is another. The old
 *    "top customers" grouped `deployment_usages` by `user_id`, so an
 *    organization's spend was split across whichever of its developers
 *    happened to click deploy, and no row ever showed what the organization
 *    was actually worth. Everything here groups by `teamId`.
 *
 * 2. **Every headline carries its own comparison.** A number with no previous
 *    period is a number nobody can act on: 412 GPU hours is good news or bad
 *    news depending entirely on last week. Each KPI computes the same figure
 *    over the window immediately before and reports the change — or `null`
 *    when the previous period was zero, because "up from nothing" is not a
 *    percentage and pretending otherwise invents a trend.
 *
 * Series are produced once and shared: the sparkline on a KPI card and the
 * line on the chart below it are the same array, so they can never disagree.
 */
const prisma = require('../../lib/prismaClient');
const { bucketExpr, fillSeries, describe } = require('./timeWindow');
const { num, round2, round4, deltaPct } = require('./numeric');

/* ── Series ────────────────────────────────────────────────────────────── */

/**
 * The four daily series the whole Dashboard is built from.
 *
 * Each is a single grouped scan over one table, bucketed by Postgres in the
 * window's timezone (see timeWindow.js) and gap-filled here so a quiet day is
 * an explicit zero rather than a hole a line chart draws straight through.
 */
const getSeries = async (window) => {
  const { from, to, granularity, timezone } = window;

  const signupsSql = `
    SELECT ${bucketExpr(granularity, '"created_at"', timezone)} AS bucket,
           COUNT(*)::int AS signups
    FROM "users"
    WHERE "account_type" = 'customer' AND "created_at" >= $1 AND "created_at" <= $2
    GROUP BY 1`;

  const deploymentsSql = `
    SELECT ${bucketExpr(granularity, '"created_at"', timezone)} AS bucket,
           COUNT(*)::int AS deployments
    FROM "deployments"
    WHERE "created_at" >= $1 AND "created_at" <= $2
    GROUP BY 1`;

  // Usage is the platform's actual earned revenue, and its hours are what the
  // hardware did. `kind` separates machine time from the storage a paused
  // deployment still holds — both are billed, only the first is "GPU hours".
  const usageSql = `
    SELECT ${bucketExpr(granularity, '"period_start"', timezone)} AS bucket,
           COALESCE(SUM(CASE WHEN "kind" = 'compute' THEN "hours" ELSE 0 END), 0)::float AS gpu_hours,
           COALESCE(SUM("amount"), 0)::float AS revenue
    FROM "deployment_usages"
    WHERE "period_start" >= $1 AND "period_start" <= $2
    GROUP BY 1`;

  const topUpsSql = `
    SELECT ${bucketExpr(granularity, '"created_at"', timezone)} AS bucket,
           COALESCE(SUM("amount"), 0)::float AS top_ups
    FROM "credit_transactions"
    WHERE "type" = 'topup' AND "created_at" >= $1 AND "created_at" <= $2
    GROUP BY 1`;

  const [signupRows, deploymentRows, usageRows, topUpRows] = await Promise.all([
    prisma.$queryRawUnsafe(signupsSql, from, to),
    prisma.$queryRawUnsafe(deploymentsSql, from, to),
    prisma.$queryRawUnsafe(usageSql, from, to),
    prisma.$queryRawUnsafe(topUpsSql, from, to),
  ]);

  return {
    signups: fillSeries(signupRows, window, { fields: { signups: 0 } }),
    deployments: fillSeries(deploymentRows, window, { fields: { deployments: 0 } }),
    usage: fillSeries(usageRows, window, { fields: { gpu_hours: 0, revenue: 0 } })
      .map((r) => ({ bucket: r.bucket, gpuHours: round4(r.gpu_hours), revenue: round2(r.revenue) })),
    topUps: fillSeries(topUpRows, window, { fields: { top_ups: 0 } })
      .map((r) => ({ bucket: r.bucket, topUps: round2(r.top_ups) })),
  };
};

/* ── Totals, this window and the one before ───────────────────────────── */

const windowTotals = async (from, to) => {
  const [signups, deploymentsCreated, usageAgg, topUpAgg] = await Promise.all([
    prisma.user.count({ where: { accountType: 'customer', createdAt: { gte: from, lte: to } } }),
    prisma.deployment.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.deploymentUsage.aggregate({
      where: { periodStart: { gte: from, lte: to } },
      _sum: { hours: true, amount: true },
    }),
    prisma.creditTransaction.aggregate({
      where: { type: 'topup', createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
  ]);

  // Compute-only hours, so storage time on a paused machine is not reported
  // as GPU hours it never ran.
  const computeAgg = await prisma.deploymentUsage.aggregate({
    where: { periodStart: { gte: from, lte: to }, kind: 'compute' },
    _sum: { hours: true },
  });

  return {
    signups,
    deploymentsCreated,
    gpuHours: round4(num(computeAgg._sum.hours)),
    usageRevenue: round2(num(usageAgg._sum.amount)),
    topUps: round2(num(topUpAgg._sum.amount)),
  };
};

/* ── Headline numbers ─────────────────────────────────────────────────── */

/**
 * @param {Object}  window         from resolveWindow
 * @param {Object}  opts
 * @param {boolean} opts.canSeeRevenue  caller holds `analytics.revenue`
 *
 * Revenue KPIs are omitted entirely rather than zeroed — a card reading
 * "USD 0.00" to someone without the permission is a worse answer than no card,
 * because it is indistinguishable from a platform that earned nothing.
 */
const getSummary = async (window, { canSeeRevenue = false } = {}) => {
  const [series, current, previous, live] = await Promise.all([
    getSeries(window),
    windowTotals(window.from, window.to),
    windowTotals(window.prevFrom, window.prevTo),
    (async () => {
      const [runningDeployments, totalDeployments, activeCustomers, openTickets, unansweredTickets] = await Promise.all([
        prisma.deployment.count({ where: { status: 'running' } }),
        prisma.deployment.count({ where: { status: { notIn: ['terminated', 'rejected'] } } }),
        prisma.user.count({ where: { accountType: 'customer', status: 'active' } }),
        prisma.supportTicket.count({ where: { status: { not: 'solved' } } }),
        prisma.supportTicket.count({
          where: { status: { not: 'solved' }, messages: { none: { authorType: 'admin' } } },
        }),
      ]);
      return { runningDeployments, totalDeployments, activeCustomers, openTickets, unansweredTickets };
    })(),
  ]);

  const spark = (rows, field) => rows.map((r) => ({ x: r.bucket, value: r[field] }));

  const kpis = [
    {
      key: 'newCustomers',
      label: 'New customers',
      value: current.signups,
      unit: 'count',
      delta: deltaPct(current.signups, previous.signups),
      deltaLabel: 'vs previous period',
      caption: `${live.activeCustomers} active in total`,
      sparkline: spark(series.signups, 'signups'),
    },
    {
      key: 'runningDeployments',
      label: 'Running now',
      value: live.runningDeployments,
      unit: 'count',
      delta: deltaPct(current.deploymentsCreated, previous.deploymentsCreated),
      deltaLabel: 'new this period vs last',
      caption: `${current.deploymentsCreated} created this period, ${live.totalDeployments} alive in total`,
      sparkline: spark(series.deployments, 'deployments'),
    },
    {
      key: 'gpuHours',
      label: 'Machine hours',
      value: current.gpuHours,
      unit: 'hours',
      delta: deltaPct(current.gpuHours, previous.gpuHours),
      deltaLabel: 'vs previous period',
      caption: 'Billed compute time — storage on paused machines is excluded',
      sparkline: spark(series.usage, 'gpuHours'),
    },
    {
      key: 'openTickets',
      label: 'Open tickets',
      value: live.openTickets,
      unit: 'count',
      delta: null,
      deltaLabel: '',
      caption: live.unansweredTickets
        ? `${live.unansweredTickets} with no reply yet`
        : 'Every open ticket has had a reply',
      sparkline: [],
    },
  ];

  if (canSeeRevenue) {
    kpis.splice(3, 0, {
      key: 'usageRevenue',
      label: 'Billed usage',
      value: current.usageRevenue,
      unit: 'currency',
      delta: deltaPct(current.usageRevenue, previous.usageRevenue),
      deltaLabel: 'vs previous period',
      caption: 'What the platform actually earned from running machines',
      sparkline: spark(series.usage, 'revenue'),
      permission: 'analytics.revenue',
    }, {
      key: 'topUps',
      label: 'Top-ups taken',
      value: current.topUps,
      unit: 'currency',
      delta: deltaPct(current.topUps, previous.topUps),
      deltaLabel: 'vs previous period',
      caption: 'Money added to wallets — not the same as revenue earned',
      sparkline: spark(series.topUps, 'topUps'),
      permission: 'analytics.revenue',
    });
  }

  return { kpis, window: describe(window) };
};

/* ── Trends ───────────────────────────────────────────────────────────── */

const getTrends = async (window, { canSeeRevenue = false } = {}) => {
  const series = await getSeries(window);

  const activity = series.signups.map((row, i) => ({
    bucket: row.bucket,
    signups: row.signups,
    deployments: series.deployments[i]?.deployments ?? 0,
    gpuHours: series.usage[i]?.gpuHours ?? 0,
  }));

  const out = { activity, window: describe(window) };

  if (canSeeRevenue) {
    out.money = series.usage.map((row, i) => ({
      bucket: row.bucket,
      usageRevenue: row.revenue,
      topUps: series.topUps[i]?.topUps ?? 0,
      // Net is what changed hands in the platform's favour this bucket: money
      // in, minus what was consumed. Shown so an operator can see a period
      // where the wallets are draining faster than they are being filled.
      net: round2(row.revenue - (series.topUps[i]?.topUps ?? 0)),
    }));
  }

  return out;
};

/* ── Biggest accounts ─────────────────────────────────────────────────── */

/**
 * Grouped by account (`team_id`), with the organization's own name — the old
 * version grouped by user and so could not see an organization at all.
 */
const getTopAccounts = async (window, limit = 8, { canSeeRevenue = false } = {}) => {
  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT du."team_id"                                  AS team_id,
           COALESCE(SUM(du."amount"), 0)::float          AS spend,
           COALESCE(SUM(CASE WHEN du."kind" = 'compute' THEN du."hours" ELSE 0 END), 0)::float AS gpu_hours,
           COUNT(DISTINCT du."deployment_id")::int       AS deployments
    FROM "deployment_usages" du
    WHERE du."period_start" >= $1 AND du."period_start" <= $2
    GROUP BY du."team_id"
    ORDER BY spend DESC
    LIMIT $3
    `,
    window.from, window.to, Number(limit) || 8,
  );

  if (!rows.length) return { accounts: [], window: describe(window) };

  // Hydrate names and balances in one round trip each — the standard
  // group-then-join shape used across this codebase, never an N+1.
  const teamIds = rows.map((r) => r.team_id);
  const [teams, wallets] = await Promise.all([
    prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: {
        id: true, name: true, kind: true, disputeHold: true,
        createdBy: { select: { name: true, email: true } },
        _count: { select: { members: true } },
      },
    }),
    canSeeRevenue
      ? prisma.creditWallet.findMany({
        where: { teamId: { in: teamIds } },
        select: { teamId: true, balance: true, outstandingBalance: true },
      })
      : Promise.resolve([]),
  ]);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const walletByTeam = new Map(wallets.map((w) => [w.teamId, w]));

  return {
    accounts: rows.map((r) => {
      const team = teamById.get(r.team_id);
      const wallet = walletByTeam.get(r.team_id);
      return {
        teamId: r.team_id,
        name: team?.name || 'Unknown account',
        kind: team?.kind || 'personal',
        members: team?._count?.members ?? 0,
        ownerName: team?.createdBy?.name || '',
        ownerEmail: team?.createdBy?.email || '',
        disputeHold: !!team?.disputeHold,
        gpuHours: round4(r.gpu_hours),
        deployments: r.deployments,
        ...(canSeeRevenue ? {
          spend: round2(r.spend),
          balance: round2(num(wallet?.balance)),
          outstanding: round2(num(wallet?.outstandingBalance)),
        } : {}),
      };
    }),
    window: describe(window),
  };
};

/* ── Is the data itself trustworthy right now? ────────────────────────── */

/**
 * Every figure on this page is only as fresh as the job that produced it.
 * Billing writes usage; if that job has been failing since Tuesday the revenue
 * line is not low, it is *missing*, and an operator who cannot tell those
 * apart will make the wrong decision. So the Dashboard says so out loud.
 */
const getHealth = async () => {
  const analyticsCache = require('./analyticsCache');
  let jobs = [];
  try {
    jobs = require('../../jobs').getJobStatuses()
      .filter((j) => j.system)
      .map((j) => ({
        key: j.key, name: j.name, enabled: j.enabled,
        lastRun: j.lastRun, lastStatus: j.lastStatus, lastError: j.lastError,
      }));
  } catch (err) {
    console.error('[Analytics] Job statuses unavailable:', err.message);
  }

  const [lastUsage, settings] = await Promise.all([
    prisma.deploymentUsage.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    require('../admin/adminSettingsService').getSettings().catch(() => null),
  ]);

  const billedAt = lastUsage?.createdAt || null;
  return {
    jobs,
    cache: analyticsCache.stats(),
    trackingEnabled: !!settings?.analyticsSettings?.enableTracking,
    dataFreshness: {
      lastBilledAt: billedAt,
      minutesSinceLastBilling: billedAt
        ? Math.floor((Date.now() - billedAt.getTime()) / 60000)
        : null,
    },
  };
};

module.exports = {
  getSeries, getSummary, getTrends, getTopAccounts, getHealth,
};
