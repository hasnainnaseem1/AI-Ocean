/**
 * Admin Dashboard — the composition surface.
 *
 * Mounted separately from `/analytics` on purpose: this is not an analytics
 * domain, it is the page that assembles several of them into one answer to
 * "does anything need me today". It must stay reachable with plain
 * `analytics.view`, while the money inside it is gated per-figure rather than
 * per-route — an operator without `analytics.revenue` still needs to know a
 * tier is out of stock.
 *
 * Every read here goes through the shared TTL cache keyed on the resolved
 * window (see analyticsCache.js), so eight admins with the page open do not
 * re-scan the usage table eight times a minute. The cache key never contains
 * anything about *who* is asking — the one thing that varies per caller, the
 * revenue permission, is part of the key as a plain boolean so a
 * revenue-blind admin can never be served a cached payload containing money.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const { paginate } = require('../../../utils/helpers/pagination');
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission } = require('../../../middleware/security');
const { resolveWindow, describe } = require('../../../services/analytics/timeWindow');
const { resolvePolicy, ttlForWindow } = require('../../../services/analytics/analyticsPolicyResolver');
const analyticsCache = require('../../../services/analytics/analyticsCache');
const dashboardService = require('../../../services/analytics/dashboardService');
const attentionChecks = require('../../../services/analytics/attentionChecks');

const router = express.Router();

/** Does this caller get to see money? */
const canSeeRevenue = (req) => !!req.user?.hasPermission?.('analytics.revenue');

/**
 * Resolve the window, then read through the cache.
 *
 * `fresh=1` skips the cache — what the Refresh button sends, because a number
 * that does not move when somebody deliberately asks for it to be refreshed
 * reads as broken no matter how correct it is.
 */
const cachedRead = async (req, domain, loader, extraKeyParts = {}) => {
  const policy = await resolvePolicy();
  const window = resolveWindow(req.query, policy);
  const key = analyticsCache.cacheKey(domain, {
    w: window.cacheKey,
    revenue: canSeeRevenue(req) ? 1 : 0,
    ...extraKeyParts,
  });
  const ttlMs = req.query.fresh === '1' ? 0 : ttlForWindow(policy, window);
  const data = await analyticsCache.cached(key, () => loader(window, policy), { ttlMs });
  return { data, window, policy };
};

// @route   GET /api/v1/admin/dashboard/summary
// @desc    Headline numbers, each with its change against the previous period
// @access  analytics.view  (money figures additionally need analytics.revenue)
router.get('/summary', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { data } = await cachedRead(req, 'dashboard:summary', (window) => (
      dashboardService.getSummary(window, { canSeeRevenue: canSeeRevenue(req) })
    ));
    res.json({ success: true, ...data, generatedAt: new Date().toISOString() });
  } catch (error) {
    failure(res, error, 'Error building the dashboard summary', { log: 'Dashboard summary' });
  }
});

// @route   GET /api/v1/admin/dashboard/attention
// @desc    What needs a human right now, worst first
// @access  analytics.view
router.get('/attention', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const policy = await resolvePolicy();
    const settings = await require('../../../services/admin/adminSettingsService').getSettings();

    /*
     * Not cached on the window — these are point-in-time conditions, not a
     * reporting period, and this is the one list where a minute of staleness
     * is the difference between acting and not. Cached briefly and on nothing
     * caller-specific.
     */
    const items = await analyticsCache.cached(
      'dashboard:attention',
      () => attentionChecks.runAll(policy, { billingSettings: settings.billingSettings }),
      { ttlMs: req.query.fresh === '1' ? 0 : 30 * 1000 },
    );

    res.json({ success: true, items, checkedAt: new Date().toISOString() });
  } catch (error) {
    failure(res, error, 'Error checking what needs attention', { log: 'Dashboard attention' });
  }
});

// @route   GET /api/v1/admin/dashboard/trends
// @desc    The series behind the headline numbers
// @access  analytics.view  (the money series needs analytics.revenue)
router.get('/trends', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { data } = await cachedRead(req, 'dashboard:trends', (window) => (
      dashboardService.getTrends(window, { canSeeRevenue: canSeeRevenue(req) })
    ));
    res.json({ success: true, ...data });
  } catch (error) {
    failure(res, error, 'Error fetching dashboard trends', { log: 'Dashboard trends' });
  }
});

// @route   GET /api/v1/admin/dashboard/top-accounts
// @desc    The biggest accounts by spend — BY ACCOUNT, not by person
// @access  analytics.view
router.get('/top-accounts', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const { limit } = paginate(req.query, { defaultLimit: 8, maxLimit: 50 });
    const { data } = await cachedRead(
      req,
      'dashboard:top-accounts',
      (window) => dashboardService.getTopAccounts(window, limit, { canSeeRevenue: canSeeRevenue(req) }),
      { limit },
    );
    res.json({ success: true, ...data });
  } catch (error) {
    failure(res, error, 'Error fetching top accounts', { log: 'Dashboard top accounts' });
  }
});

// @route   GET /api/v1/admin/dashboard/activity
// @desc    Recent staff activity — delegates to the activity log service
// @access  logs.view (this is the audit trail, not an analytics aggregate)
router.get('/activity', adminAuth, checkPermission('logs.view'), async (req, res) => {
  try {
    const { limit } = paginate(req.query, { defaultLimit: 10, maxLimit: 50 });
    const activityLogService = require('../../../services/admin/activityLogService');
    const { logs } = await activityLogService.list({}, { page: 1, limit });
    res.json({
      success: true,
      activities: (logs || []).map((row) => ({
        id: row.id,
        userName: row.userName,
        userRole: row.userRole,
        action: row.action,
        description: row.description,
        status: row.status,
        createdAt: row.createdAt,
      })),
    });
  } catch (error) {
    failure(res, error, 'Error fetching recent activity', { log: 'Dashboard activity' });
  }
});

// @route   GET /api/v1/admin/dashboard/health
// @desc    Whether the numbers on this page can be trusted right now
// @access  analytics.view
router.get('/health', adminAuth, checkPermission('analytics.view'), async (req, res) => {
  try {
    const health = await dashboardService.getHealth();
    res.json({ success: true, ...health, window: describe(resolveWindow({}, await resolvePolicy())) });
  } catch (error) {
    failure(res, error, 'Error checking dashboard health', { log: 'Dashboard health' });
  }
});

module.exports = router;
