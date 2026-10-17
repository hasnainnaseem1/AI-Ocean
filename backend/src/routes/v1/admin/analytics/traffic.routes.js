/**
 * Reading the traffic the platform collects itself.
 *
 * All `analytics.view` — a page view carries no money and no customer
 * identity. The one thing that could have been sensitive, the full URL, is
 * stripped of its query tokens at write time rather than at read time, so
 * there is nothing here to gate.
 *
 * Every handler passes the admin settings down, because which source can
 * answer a window depends on the operator's own retention setting, and the
 * answer says which source it used.
 */
const express = require('express');
const { failure } = require('../../../../utils/helpers/apiError');
const { checkPermission } = require('../../../../middleware/security');
const { resolveWindow } = require('../../../../services/analytics/timeWindow');
const { resolvePolicy, ttlForWindow } = require('../../../../services/analytics/analyticsPolicyResolver');
const { getSettings } = require('../../../../services/admin/adminSettingsService');
const analyticsCache = require('../../../../services/analytics/analyticsCache');
const traffic = require('../../../../services/analytics/trafficAnalytics');

const router = express.Router();

const SITES = ['marketing', 'customer', 'admin'];

const read = (domain, loader) => async (req, res) => {
  try {
    const [policy, settings] = await Promise.all([resolvePolicy(), getSettings()]);
    const window = resolveWindow(req.query, policy);
    const site = SITES.includes(req.query.site) ? req.query.site : null;
    const opts = {
      site,
      settings: settings?.analyticsSettings || {},
      limit: req.query.limit,
      by: req.query.by,
    };
    const key = analyticsCache.cacheKey(`traffic:${domain}`, {
      w: window.cacheKey, site: site || '', by: req.query.by || '', limit: req.query.limit || '',
    });
    const ttlMs = req.query.fresh === '1' ? 0 : ttlForWindow(policy, window);
    const data = await analyticsCache.cached(key, () => loader(window, policy, opts), { ttlMs });
    res.json({ success: true, ...data });
  } catch (error) {
    failure(res, error, `Error fetching ${domain}`, { log: `Analytics traffic ${domain}` });
  }
};

// @route   GET /api/v1/admin/analytics/traffic/summary
// @desc    Views, sessions, visitors, bounce rate, and who is on the site now
router.get('/summary', checkPermission('analytics.view'),
  read('summary', (w, p, o) => traffic.getSummary(w, p, o)));

// @route   GET /api/v1/admin/analytics/traffic/trend
// @desc    The same figures over time
router.get('/trend', checkPermission('analytics.view'),
  read('trend', (w, p, o) => traffic.getTrend(w, p, o)));

// @route   GET /api/v1/admin/analytics/traffic/pages
// @desc    Most-visited pages, by the pattern they collapse to
router.get('/pages', checkPermission('analytics.view'),
  read('pages', (w, p, o) => traffic.getPages(w, p, o)));

// @route   GET /api/v1/admin/analytics/traffic/breakdown?by=source|medium|referrer|device|browser|os|campaign
// @desc    Sessions grouped by one dimension — a visit, not a page view
router.get('/breakdown', checkPermission('analytics.view'),
  read('breakdown', (w, p, o) => traffic.getBreakdown(w, p, o)));

// @route   GET /api/v1/admin/analytics/traffic/audience
// @desc    Device, browser and OS — and why there is no country
router.get('/audience', checkPermission('analytics.view'),
  read('audience', (w, p, o) => traffic.getAudience(w, p, o)));

// @route   GET /api/v1/admin/analytics/traffic/conversions
// @desc    Visits and signups on one axis, with the attribution caveat attached
router.get('/conversions', checkPermission('analytics.view'),
  read('conversions', (w, p, o) => traffic.getConversions(w, p, o)));

module.exports = router;
