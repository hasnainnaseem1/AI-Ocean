/**
 * Retention: do accounts stay, and does the money stay with them.
 *
 * The split in here is the whole point. Cohorts and lifecycle count ACCOUNTS
 * and are `analytics.view`. Gross and net revenue retention count MONEY and
 * are `analytics.revenue` — they are among the most sensitive figures a
 * platform has, and a support lead reading the retention page has no business
 * seeing them.
 */
const express = require('express');
const { failure } = require('../../../../utils/helpers/apiError');
const { checkPermission } = require('../../../../middleware/security');
const { resolveWindow } = require('../../../../services/analytics/timeWindow');
const { resolvePolicy, ttlForWindow } = require('../../../../services/analytics/analyticsPolicyResolver');
const analyticsCache = require('../../../../services/analytics/analyticsCache');
const retention = require('../../../../services/analytics/retentionAnalytics');

const router = express.Router();

const read = (domain, loader) => async (req, res) => {
  try {
    const policy = await resolvePolicy();
    const window = resolveWindow(req.query, policy);
    const key = analyticsCache.cacheKey(`retention:${domain}`, { w: window.cacheKey });
    const ttlMs = req.query.fresh === '1' ? 0 : ttlForWindow(policy, window);
    const data = await analyticsCache.cached(key, () => loader(window, policy, req), { ttlMs });
    res.json({ success: true, ...data });
  } catch (error) {
    failure(res, error, `Error fetching ${domain}`, { log: `Analytics retention ${domain}` });
  }
};

// @route   GET /api/v1/admin/analytics/retention/cohorts
// @desc    Signup month × months since, as a retention grid
router.get('/cohorts', checkPermission('analytics.view'),
  read('cohorts', (window, policy) => retention.getCohorts(window, policy)));

// @route   GET /api/v1/admin/analytics/retention/lifecycle
// @desc    New, continuing, came back, gone quiet
router.get('/lifecycle', checkPermission('analytics.view'),
  read('lifecycle', (window, policy) => retention.getLifecycle(window, policy)));

// @route   GET /api/v1/admin/analytics/retention/risk-trend
// @desc    How the risk bands have moved, from the nightly snapshots
router.get('/risk-trend', checkPermission('analytics.view'),
  read('risk-trend', (window, policy) => retention.getRiskTrend(window, policy)));

// @route   GET /api/v1/admin/analytics/retention/revenue
// @desc    GRR and NRR against the previous window — money, so revenue-gated
router.get('/revenue', checkPermission('analytics.revenue'),
  read('revenue', (window) => retention.getRevenueRetention(window)));

module.exports = router;
