const express = require('express');
const { paginate } = require('../../../utils/helpers/pagination');
const router = express.Router();
const analyticsService = require('../../../services/admin/analyticsService');
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission } = require('../../../middleware/security');

// ─── Helper: parse timeframe to start date ───
function getStartDate(timeframe) {
  const now = new Date();
  const ms = {
    '7d': 7 * 86400000,
    '30d': 30 * 86400000,
    '90d': 90 * 86400000,
    '1y': 365 * 86400000,
  };
  return new Date(now.getTime() - (ms[timeframe] || ms['30d']));
}

function getDays(period) {
  return { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
}

// @route   GET /api/admin/analytics/overview
// @desc    Get overview dashboard statistics
// @access  Private (Admin with analytics.view permission)
router.get('/overview', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    const startDate = getStartDate(timeframe);

    const {
      totalUsers, totalCustomers, totalAdmins, activeUsers, newUsersInPeriod,
      activeCustomers, pendingVerification, suspendedCustomers,
      totalDeployments, deploymentsInPeriod, runningDeployments, pendingDeployments,
      gpuHours, usageRevenue, totalLogins, failedLogins, monthlyRevenue, creditTotals, previousPeriodUsers,
    } = await analyticsService.getOverviewCounts(startDate, new Date());

    const userGrowth = previousPeriodUsers > 0
      ? ((newUsersInPeriod - previousPeriodUsers) / previousPeriodUsers * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      timeframe,
      overview: {
        users: {
          total: totalUsers,
          customers: totalCustomers,
          admins: totalAdmins,
          active: activeUsers,
          newInPeriod: newUsersInPeriod,
          growth: `${userGrowth}%`,
        },
        customers: {
          active: activeCustomers,
          pendingVerification,
          suspended: suspendedCustomers,
        },
        deployments: {
          total: totalDeployments,
          inPeriod: deploymentsInPeriod,
          running: runningDeployments,
          pendingReview: pendingDeployments,
          gpuHours: Math.round(gpuHours * 100) / 100,
        },
        activity: {
          totalLogins,
          failedLogins,
          failureRate: totalLogins > 0
            ? ((failedLogins / totalLogins) * 100).toFixed(2) + '%'
            : '0%',
        },
        // The overview carries revenue inline rather than on its own route, so
        // the same analytics.revenue permission decides whether it's included.
        ...(req.user?.hasPermission?.('analytics.revenue') ? {
          revenue: {
            monthly: monthlyRevenue,
            topUpsInPeriod: creditTotals.topUps,
            usageChargesInPeriod: creditTotals.charges,
            gpuRevenueInPeriod: Math.round(usageRevenue * 100) / 100,
          },
        } : {}),
      },
    });
  } catch (error) {
    console.error('Get analytics overview error:', error);
    res.status(500).json({ success: false, message: 'Error fetching analytics' });
  }
});

// @route   GET /api/admin/analytics/users-growth
// @desc    Get user growth chart data (aggregation-based, no N+1)
// @access  Private (Admin with analytics.view permission)
router.get('/users-growth', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const days = getDays(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { usersMap, customersMap } = await analyticsService.getUsersGrowthDaily(startDate);

    // Build full date range
    const growthData = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      growthData.push({
        date: key,
        newUsers: usersMap[key] || 0,
        newCustomers: customersMap[key] || 0,
      });
    }

    res.json({ success: true, period, data: growthData });
  } catch (error) {
    console.error('Get user growth error:', error);
    res.status(500).json({ success: false, message: 'Error fetching user growth data' });
  }
});

// @route   GET /api/admin/analytics/deployments-trend
// @desc    Daily deployment requests vs. deployments that went live
// @access  Private (Admin with analytics.view permission)
router.get('/deployments-trend', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const days = getDays(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { requestedMap, liveMap, revenueMap } = await analyticsService.getDeploymentsTrendDaily(startDate);

    const trendData = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      trendData.push({
        date: key,
        requested: requestedMap[key] || 0,
        wentLive: liveMap[key] || 0,
        gpuHours: Math.round((revenueMap[key]?.hours || 0) * 100) / 100,
        revenue: Math.round((revenueMap[key]?.amount || 0) * 100) / 100,
      });
    }

    res.json({ success: true, period, data: trendData });
  } catch (error) {
    console.error('Get deployments trend error:', error);
    res.status(500).json({ success: false, message: 'Error fetching deployments trend data' });
  }
});


// @route   GET /api/admin/analytics/top-customers
// @desc    Highest-spending customers by machine usage
// @access  Private (Admin with analytics.view permission)
router.get('/top-customers', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const { limit: safeLimit } = paginate({ limit }, { defaultLimit: 10, maxLimit: 100 });
    const topCustomers = await analyticsService.getTopCustomers(safeLimit);
    res.json({ success: true, topCustomers });
  } catch (error) {
    console.error('Get top customers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching top customers' });
  }
});

// @route   GET /api/admin/analytics/recent-activities
// @desc    Get recent admin activities
// @access  Private (Admin with analytics.view permission)
router.get('/recent-activities', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const { limit: safeLimit } = paginate({ limit }, { defaultLimit: 20, maxLimit: 100 });
    const activities = await analyticsService.getRecentActivities(safeLimit);

    res.json({
      success: true,
      activities
    });

  } catch (error) {
    console.error('Get recent activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching recent activities'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// NEW ENDPOINTS FOR DASHBOARD & ANALYTICS OVERHAUL
// ═══════════════════════════════════════════════════════════════════

// @route   GET /api/admin/analytics/revenue-stats
// @desc    Get revenue statistics from Payment model
// @access  Private (Admin with the analytics.revenue permission)
router.get('/revenue-stats', adminAuth, checkPermission('analytics.revenue'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const days = getDays(period);
    const now = new Date();
    const startDate = getStartDate(period);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const {
      mrr, prevMrr, totalAllTime, totalPayments, payingCustomers, trendMap, paymentStatus, recentPayments,
    } = await analyticsService.getRevenueStats({ startDate, monthStart, prevMonthStart });

    const mrrGrowth = prevMrr > 0 ? (((mrr - prevMrr) / prevMrr) * 100).toFixed(1) : 0;
    const arpu = payingCustomers > 0 ? parseFloat((mrr / payingCustomers).toFixed(2)) : 0;

    // Fill revenue trend gaps
    const trendData = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      trendData.push({
        date: key,
        revenue: trendMap[key]?.revenue || 0,
        transactions: trendMap[key]?.count || 0,
      });
    }

    res.json({
      success: true,
      period,
      revenue: {
        mrr,
        arr: mrr * 12,
        arpu,
        mrrGrowth: `${mrrGrowth}%`,
        totalAllTime,
        totalPayments,
        trend: trendData,
        paymentStatus,
        recentPayments,
      },
    });
  } catch (error) {
    console.error('Get revenue stats error:', error);
    res.status(500).json({ success: false, message: 'Error fetching revenue stats' });
  }
});

// @route   GET /api/admin/analytics/login-analytics
// @desc    Get login analytics — most active users, login trend
// @access  Private (Admin with analytics.view permission)
router.get('/login-analytics', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const days = getDays(period);
    const startDate = getStartDate(period);

    const { trendMap, topUsers, stats } = await analyticsService.getLoginAnalytics(startDate);

    // Fill login trend gaps
    const trend = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      trend.push({ date: key, logins: trendMap[key] || 0 });
    }

    res.json({
      success: true,
      period,
      loginAnalytics: {
        trend,
        topUsers,
        stats,
      },
    });
  } catch (error) {
    console.error('Get login analytics error:', error);
    res.status(500).json({ success: false, message: 'Error fetching login analytics' });
  }
});

// @route   GET /api/admin/analytics/revenue-advanced
// @desc    Advanced revenue metrics — refunds, top payers, monthly trend
// @access  Private (Admin with the analytics.revenue permission)
router.get('/revenue-advanced', adminAuth, checkPermission('analytics.revenue'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const startDate = getStartDate(period);

    const {
      refundTotal, refundCount, grossRevenue, netRevenue, failedPayments, succeededPayments,
      averageTransaction, topPayers, monthlyRevenueTrend,
    } = await analyticsService.getRevenueAdvanced(startDate);

    // Payment success rate
    const totalAttempts = succeededPayments + failedPayments;
    const paymentSuccessRate = totalAttempts > 0
      ? parseFloat(((succeededPayments / totalAttempts) * 100).toFixed(1))
      : 100;

    res.json({
      success: true,
      period,
      advanced: {
        netRevenue,
        grossRevenue,
        refunds: { total: refundTotal, count: refundCount },
        paymentSuccessRate,
        failedPayments,
        succeededPayments,
        averageTransaction,
        topPayers,
        monthlyRevenueTrend,
      },
    });
  } catch (error) {
    console.error('Get advanced revenue stats error:', error);
    res.status(500).json({ success: false, message: 'Error fetching advanced revenue stats' });
  }
});

module.exports = router;
