/**
 * Infrastructure analytics — machine types, stock, consumption, components,
 * the deployment funnel, and whether our own sizing advice is any good.
 *
 * Mounted under the existing `/analytics` router, so `adminAuth` is already
 * applied; each handler still names its own permission. Everything here is
 * `analytics.view` — none of it is money. Revenue per tier IS money, so the
 * amount columns are omitted for a caller without `analytics.revenue` rather
 * than being sent and hidden in the browser.
 */
const express = require('express');
const { failure } = require('../../../../utils/helpers/apiError');
const { checkPermission } = require('../../../../middleware/security');
const { resolveWindow } = require('../../../../services/analytics/timeWindow');
const { resolvePolicy, ttlForWindow } = require('../../../../services/analytics/analyticsPolicyResolver');
const analyticsCache = require('../../../../services/analytics/analyticsCache');
const infra = require('../../../../services/analytics/infrastructureAnalytics');

const router = express.Router();

const canSeeRevenue = (req) => !!req.user?.hasPermission?.('analytics.revenue');

/** Strip money from any payload when the caller may not see it. */
const stripMoney = (payload, allowed) => {
  if (allowed) return payload;
  const scrub = (value) => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (['amount', 'revenueInWindow', 'medianSpend', 'totalCost', 'pricePerHour',
          'pricePerUnitPerHour', 'share'].includes(k)) continue;
        out[k] = scrub(v);
      }
      return out;
    }
    return value;
  };
  return scrub(payload);
};

/**
 * One wrapper for every read here: resolve the window from the policy, read
 * through the shared cache keyed on that window, and strip money if the
 * caller is revenue-blind. The permission is part of the cache key, so a
 * revenue-blind admin can never be handed a cached payload with money in it.
 */
const read = (domain, loader) => async (req, res) => {
  try {
    const policy = await resolvePolicy();
    const window = resolveWindow(req.query, policy);
    const allowed = canSeeRevenue(req);
    const key = analyticsCache.cacheKey(`infra:${domain}`, {
      w: window.cacheKey,
      revenue: allowed ? 1 : 0,
      tier: req.query.tierId || '',
    });
    const ttlMs = req.query.fresh === '1' ? 0 : ttlForWindow(policy, window);
    const data = await analyticsCache.cached(key, () => loader(window, policy, req), { ttlMs });
    res.json({ success: true, ...stripMoney(data, allowed) });
  } catch (error) {
    failure(res, error, `Error fetching ${domain}`, { log: `Analytics infrastructure ${domain}` });
  }
};

// @route   GET /api/v1/admin/analytics/infrastructure/tiers
// @desc    Every machine type: stock level, utilisation, what ran on it
router.get('/tiers', checkPermission('analytics.view'),
  read('tiers', (window, policy) => infra.getTiers(window, policy)));

// @route   GET /api/v1/admin/analytics/infrastructure/capacity-trend
// @desc    Stock over time, from the daily capacity heartbeats
router.get('/capacity-trend', checkPermission('analytics.view'),
  read('capacity-trend', (window, policy, req) => infra.getCapacityTrend(window, { tierId: req.query.tierId || null })));

// @route   GET /api/v1/admin/analytics/infrastructure/stock-outages
// @desc    How long each machine type spent unavailable, and how often
router.get('/stock-outages', checkPermission('analytics.view'),
  read('stock-outages', (window) => infra.getStockOutages(window)));

// @route   GET /api/v1/admin/analytics/infrastructure/consumption
// @desc    What was consumed, by tier / model / kind / billed status
router.get('/consumption', checkPermission('analytics.view'),
  read('consumption', (window) => infra.getConsumption(window)));

// @route   GET /api/v1/admin/analytics/infrastructure/components
// @desc    The component catalogue, and what custom builds asked for
router.get('/components', checkPermission('analytics.view'),
  read('components', (window) => infra.getComponents(window)));

// @route   GET /api/v1/admin/analytics/infrastructure/lifecycle
// @desc    Request → approved → provisioned → running, with the latencies
router.get('/lifecycle', checkPermission('analytics.view'),
  read('lifecycle', (window) => infra.getLifecycle(window)));

// @route   GET /api/v1/admin/analytics/infrastructure/sizing-effectiveness
// @desc    Whether customers take our sizing advice, and what happens when they do
router.get('/sizing-effectiveness', checkPermission('analytics.view'),
  read('sizing-effectiveness', (window) => infra.getSizingEffectiveness(window)));

// @route   GET /api/v1/admin/analytics/infrastructure/custom-builds
// @desc    How many build their own machine, and which configurations repeat
router.get('/custom-builds', checkPermission('analytics.view'),
  read('custom-builds', (window) => infra.getCustomBuilds(window)));

module.exports = router;
