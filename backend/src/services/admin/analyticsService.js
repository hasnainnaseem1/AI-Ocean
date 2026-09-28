/**
 * Admin Analytics — every aggregate `routes/v1/admin/analytics.routes.js`
 * needs, ported to Prisma as the last piece of Phase 6's final cutover.
 *
 * This file spans every domain (User, Deployment, DeploymentUsage,
 * ActivityLog, Payment, CreditTransaction), which is exactly why the plan
 * always deferred converting it until every domain it reads from had already
 * moved — there was no way to do this one incrementally.
 *
 * Prisma's `groupBy` cannot truncate a timestamp to a day/month, so every
 * "daily trend" / "monthly trend" query here uses `$queryRaw` with Postgres's
 * own `date_trunc`, parameterized (never string-concatenated) exactly like
 * `paymentService.getMonthlyTrend`.
 */
const prisma = require('../../lib/prismaClient');

const num = (d) => (d === null || d === undefined ? 0 : Number(d));
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── /overview ────────────────────────────────────────────────────────────

const getOverviewCounts = async (startDate, now) => {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousPeriodStart = new Date(startDate.getTime() - (now.getTime() - startDate.getTime()));

  const [
    totalUsers, totalCustomers, totalAdmins, activeUsers, newUsersInPeriod,
    activeCustomers, pendingVerification, suspendedCustomers,
    totalDeployments, deploymentsInPeriod, runningDeployments, pendingDeployments,
    usageAgg, totalLogins, failedLogins, revenueAgg, creditTotals, previousPeriodUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { accountType: 'customer' } }),
    prisma.user.count({ where: { accountType: 'admin' } }),
    prisma.user.count({ where: { status: 'active' } }),
    prisma.user.count({ where: { createdAt: { gte: startDate } } }),
    prisma.user.count({ where: { accountType: 'customer', status: 'active' } }),
    prisma.user.count({ where: { accountType: 'customer', status: 'pending_verification' } }),
    prisma.user.count({ where: { accountType: 'customer', status: 'suspended' } }),
    prisma.deployment.count(),
    prisma.deployment.count({ where: { createdAt: { gte: startDate } } }),
    prisma.deployment.count({ where: { status: 'running' } }),
    prisma.deployment.count({ where: { status: 'pending_review' } }),
    prisma.deploymentUsage.aggregate({ where: { createdAt: { gte: startDate } }, _sum: { hours: true, amount: true } }),
    prisma.activityLog.count({ where: { action: 'login', createdAt: { gte: startDate } } }),
    prisma.activityLog.count({ where: { action: 'login', status: 'failed', createdAt: { gte: startDate } } }),
    prisma.payment.aggregate({ where: { status: 'succeeded', paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    require('../billing/creditService').getTotals(startDate, now),
    prisma.user.count({ where: { createdAt: { gte: previousPeriodStart, lt: startDate } } }),
  ]);

  return {
    totalUsers, totalCustomers, totalAdmins, activeUsers, newUsersInPeriod,
    activeCustomers, pendingVerification, suspendedCustomers,
    totalDeployments, deploymentsInPeriod, runningDeployments, pendingDeployments,
    gpuHours: num(usageAgg._sum.hours),
    usageRevenue: num(usageAgg._sum.amount),
    totalLogins, failedLogins,
    monthlyRevenue: round2(num(revenueAgg._sum.amount)),
    creditTotals,
    previousPeriodUsers,
  };
};

// ── /users-growth ───────────────────────────────────────────────────────

/** Daily new-user counts since `startDate`, split into all-users and customers-only maps. */
const getUsersGrowthDaily = async (startDate) => {
  const [allRows, customerRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', "created_at"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "users" WHERE "created_at" >= ${startDate}
      GROUP BY 1
    `,
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', "created_at"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "users" WHERE "account_type" = 'customer' AND "created_at" >= ${startDate}
      GROUP BY 1
    `,
  ]);

  const usersMap = {};
  allRows.forEach((r) => { usersMap[r.day] = r.count; });
  const customersMap = {};
  customerRows.forEach((r) => { customersMap[r.day] = r.count; });

  return { usersMap, customersMap };
};

// ── /deployments-trend ──────────────────────────────────────────────────

const getDeploymentsTrendDaily = async (startDate) => {
  const [requestedRows, liveRows, revenueRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', "created_at"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "deployments" WHERE "created_at" >= ${startDate}
      GROUP BY 1
    `,
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', "started_at"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "deployments" WHERE "started_at" >= ${startDate}
      GROUP BY 1
    `,
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', "period_start"), 'YYYY-MM-DD') AS day,
             SUM("hours")::float AS hours, SUM("amount")::float AS amount
      FROM "deployment_usages" WHERE "created_at" >= ${startDate}
      GROUP BY 1
    `,
  ]);

  const requestedMap = {};
  requestedRows.forEach((r) => { requestedMap[r.day] = r.count; });
  const liveMap = {};
  liveRows.forEach((r) => { liveMap[r.day] = r.count; });
  const revenueMap = {};
  revenueRows.forEach((r) => { revenueMap[r.day] = { hours: r.hours || 0, amount: r.amount || 0 }; });

  return { requestedMap, liveMap, revenueMap };
};

// ── /top-customers ──────────────────────────────────────────────────────

const getTopCustomers = async (limit = 10) => {
  const rows = await prisma.$queryRaw`
    SELECT du."user_id" AS user_id,
           SUM(du."amount")::float AS total_spend,
           SUM(du."hours")::float AS total_hours,
           COUNT(DISTINCT du."deployment_id")::int AS deployment_count
    FROM "deployment_usages" du
    GROUP BY du."user_id"
    ORDER BY total_spend DESC
    LIMIT ${limit}
  `;

  if (rows.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.user_id) } },
      select: {
        id: true, name: true, email: true,
      },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return rows
      .filter((r) => userMap.has(r.user_id))
      .map((r) => {
        const u = userMap.get(r.user_id);
        return {
          customer: { id: u.id, name: u.name, email: u.email },
          totalSpend: round2(r.total_spend),
          totalHours: round2(r.total_hours),
          deploymentCount: r.deployment_count,
        };
      });
  }

  // No usage recorded yet — fall back to the newest active customers.
  const customers = await prisma.user.findMany({
    where: { accountType: 'customer', status: 'active' },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    select: {
      id: true, name: true, email: true, createdAt: true,
    },
  });

  return customers.map((u) => ({
    customer: {
      id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
    },
    totalSpend: 0,
    totalHours: 0,
    deploymentCount: 0,
  }));
};

// ── /recent-activities ──────────────────────────────────────────────────

const getRecentActivities = async (limit = 20) => {
  const rows = await prisma.activityLog.findMany({
    where: { userRole: { not: 'customer' } },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
    select: {
      id: true, userName: true, action: true, description: true, createdAt: true, status: true,
    },
  });
  return rows.map((row) => row);
};

// ── /revenue-stats ───────────────────────────────────────────────────────

const getRevenueStats = async ({ startDate, monthStart, prevMonthStart }) => {
  const [
    mrrAgg, prevMrrAgg, revenueTrendRows, paymentStatusRows, recentPaymentsRaw,
    totalRevenueAll, payingCustomerIds,
  ] = await Promise.all([
    prisma.payment.aggregate({ where: { status: 'succeeded', paidAt: { gte: monthStart } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.aggregate({ where: { status: 'succeeded', paidAt: { gte: prevMonthStart, lt: monthStart } }, _sum: { amount: true } }),
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', "paid_at"), 'YYYY-MM-DD') AS day,
             SUM("amount")::float AS revenue, COUNT(*)::int AS count
      FROM "payments" WHERE "status" = 'succeeded' AND "paid_at" >= ${startDate}
      GROUP BY 1
    `,
    prisma.payment.groupBy({ by: ['status'], where: { createdAt: { gte: startDate } }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.payment.findMany({
      where: { status: 'succeeded' },
      orderBy: { paidAt: 'desc' },
      take: 10,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.payment.aggregate({ where: { status: 'succeeded' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.findMany({
      where: { status: 'succeeded', paidAt: { gte: monthStart } },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);

  const trendMap = {};
  revenueTrendRows.forEach((r) => { trendMap[r.day] = { revenue: round2(r.revenue), count: r.count }; });

  return {
    mrr: round2(num(mrrAgg._sum.amount)),
    prevMrr: round2(num(prevMrrAgg._sum.amount)),
    totalAllTime: round2(num(totalRevenueAll._sum.amount)),
    totalPayments: totalRevenueAll._count._all,
    payingCustomers: payingCustomerIds.length,
    trendMap,
    paymentStatus: paymentStatusRows.map((s) => ({
      status: s.status, count: s._count._all, total: round2(num(s._sum.amount)),
    })),
    recentPayments: recentPaymentsRaw.map((p) => ({
      id: p.id,
      user: p.user ? { name: p.user.name, email: p.user.email } : null,
      amount: round2(num(p.amount)),
      paidAt: p.paidAt,
    })),
  };
};

// ── /login-analytics ─────────────────────────────────────────────────────

const getLoginAnalytics = async (startDate) => {
  const [trendRows, topUserRows, statusRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', "created_at"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "activity_logs" WHERE "action" = 'login' AND "status" = 'success' AND "created_at" >= ${startDate}
      GROUP BY 1
    `,
    prisma.$queryRaw`
      SELECT al."user_id" AS user_id,
             (array_agg(al."user_name" ORDER BY al."created_at" ASC))[1] AS user_name,
             COUNT(*)::int AS login_count, MAX(al."created_at") AS last_login
      FROM "activity_logs" al
      JOIN "users" u ON u."id" = al."user_id"
      WHERE al."action" = 'login' AND al."status" = 'success' AND al."created_at" >= ${startDate}
      GROUP BY al."user_id"
      ORDER BY login_count DESC
      LIMIT 10
    `,
    prisma.activityLog.groupBy({
      by: ['status'], where: { action: 'login', createdAt: { gte: startDate } }, _count: { _all: true },
    }),
  ]);

  const trendMap = {};
  trendRows.forEach((r) => { trendMap[r.day] = r.count; });

  const topUsers = topUserRows.map((r) => ({
    id: r.user_id, userName: r.user_name, loginCount: r.login_count, lastLogin: r.last_login,
  }));

  const stats = {};
  statusRows.forEach((s) => { stats[s.status || 'unknown'] = s._count._all; });

  return { trendMap, topUsers, stats };
};

// ── /revenue-advanced ────────────────────────────────────────────────────

const getRevenueAdvanced = async (startDate) => {
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);

  const [
    refundAgg, topPayerRows, monthlyTrendRows, failedPayments, succeededPayments, avgAgg, allTimeAgg,
  ] = await Promise.all([
    prisma.payment.aggregate({ where: { status: 'refunded' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT p."user_id" AS user_id, u."name" AS name, u."email" AS email,
             SUM(p."amount")::float AS total_spent, COUNT(*)::int AS payments, MAX(p."paid_at") AS last_payment
      FROM "payments" p
      LEFT JOIN "users" u ON u."id" = p."user_id"
      WHERE p."status" = 'succeeded'
      GROUP BY p."user_id", u."name", u."email"
      ORDER BY total_spent DESC
      LIMIT 10
    `,
    prisma.$queryRaw`
      SELECT to_char(date_trunc('month', "paid_at"), 'YYYY-MM') AS month,
             SUM("amount")::float AS revenue, COUNT(*)::int AS count
      FROM "payments" WHERE "status" = 'succeeded' AND "paid_at" >= ${twelveMonthsAgo}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.payment.count({ where: { status: 'failed', createdAt: { gte: startDate } } }),
    prisma.payment.count({ where: { status: 'succeeded', paidAt: { gte: startDate } } }),
    prisma.payment.aggregate({ where: { status: 'succeeded' }, _avg: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'succeeded' }, _sum: { amount: true } }),
  ]);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyRevenueTrend = monthlyTrendRows.map((r) => {
    const [year, month] = r.month.split('-');
    return {
      month: `${monthNames[Number(month) - 1]} ${year}`,
      revenue: round2(r.revenue),
      transactions: r.count,
    };
  });

  const refundTotal = round2(num(refundAgg._sum.amount));
  const grossRevenue = round2(num(allTimeAgg._sum.amount));

  return {
    refundTotal,
    refundCount: refundAgg._count._all,
    grossRevenue,
    netRevenue: round2(grossRevenue - refundTotal),
    failedPayments,
    succeededPayments,
    averageTransaction: round2(num(avgAgg._avg.amount)),
    topPayers: topPayerRows.map((r) => ({
      userId: r.user_id, id: r.user_id,
      name: r.name || 'Unknown',
      email: r.email || 'unknown',
      totalSpent: round2(r.total_spent),
      payments: r.payments,
      lastPayment: r.last_payment,
    })),
    monthlyRevenueTrend,
  };
};

module.exports = {
  getOverviewCounts,
  getUsersGrowthDaily,
  getDeploymentsTrendDaily,
  getTopCustomers,
  getRecentActivities,
  getRevenueStats,
  getLoginAnalytics,
  getRevenueAdvanced,
};
