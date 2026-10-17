/**
 * Support queue analytics.
 *
 * Mounted under the existing `/analytics` router, so `adminAuth` has already
 * run. Everything here is `analytics.view` — none of it is money, and none of
 * it is a ticket's contents either: the backlog and reopen lists carry a
 * subject line and a number so an operator can go and look, never a message
 * body. Reading what a customer wrote needs `support.view`, on the support
 * routes, which is where it stays.
 */
const express = require('express');
const { failure } = require('../../../../utils/helpers/apiError');
const { checkPermission } = require('../../../../middleware/security');
const { resolveWindow } = require('../../../../services/analytics/timeWindow');
const { resolvePolicy, ttlForWindow } = require('../../../../services/analytics/analyticsPolicyResolver');
const analyticsCache = require('../../../../services/analytics/analyticsCache');
const support = require('../../../../services/analytics/supportAnalytics');

const router = express.Router();

const read = (domain, loader) => async (req, res) => {
  try {
    const policy = await resolvePolicy();
    const window = resolveWindow(req.query, policy);
    const key = analyticsCache.cacheKey(`support:${domain}`, { w: window.cacheKey });
    const ttlMs = req.query.fresh === '1' ? 0 : ttlForWindow(policy, window);
    const data = await analyticsCache.cached(key, () => loader(window, policy, req), { ttlMs });
    res.json({ success: true, ...data });
  } catch (error) {
    failure(res, error, `Error fetching ${domain}`, { log: `Analytics support ${domain}` });
  }
};

// @route   GET /api/v1/admin/analytics/support/summary
// @desc    Volume, timing, backlog, SLA and reopens in one payload
router.get('/summary', checkPermission('analytics.view'),
  read('summary', (window, policy) => support.getSummary(window, policy)));

// @route   GET /api/v1/admin/analytics/support/volume
// @desc    Opened vs resolved over time, and the split by category and priority
router.get('/volume', checkPermission('analytics.view'),
  read('volume', (window) => support.getVolume(window)));

// @route   GET /api/v1/admin/analytics/support/timing
// @desc    First-response and resolution medians over time, with the estimate count
router.get('/timing', checkPermission('analytics.view'),
  read('timing', (window) => support.getTiming(window)));

// @route   GET /api/v1/admin/analytics/support/backlog
// @desc    What is still open, by age, plus the ten that have waited longest
router.get('/backlog', checkPermission('analytics.view'),
  read('backlog', (window, policy) => support.getBacklog(window, policy)));

// @route   GET /api/v1/admin/analytics/support/sla
// @desc    Met and missed against the target each ticket was actually given
router.get('/sla', checkPermission('analytics.view'),
  read('sla', (window) => support.getSla(window)));

// @route   GET /api/v1/admin/analytics/support/agents
// @desc    Who replied, who answered first, who closed, who is holding open work
router.get('/agents', checkPermission('analytics.view'),
  read('agents', (window) => support.getAgents(window)));

// @route   GET /api/v1/admin/analytics/support/reopens
// @desc    Work that came back, by who brought it back, since tracking began
router.get('/reopens', checkPermission('analytics.view'),
  read('reopens', (window) => support.getReopens(window)));

module.exports = router;
