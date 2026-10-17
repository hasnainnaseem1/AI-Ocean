/**
 * Customer and organization analytics.
 *
 * Mounted under the existing `/analytics` router, so `adminAuth` has already
 * run. Everything here is `analytics.view`: headcount, activation, invitations
 * and engagement are not money.
 *
 * Three views do touch money — the personal-vs-organization mix compares what
 * each kind of account is worth, the seat series carries what seats were
 * charged, and the PAYG view shows how usage was funded. Those FIELDS are
 * removed for a caller without `analytics.revenue` rather than sent and hidden
 * in the browser, and the permission is part of the cache key so a cached
 * payload with money in it can never be handed to a revenue-blind admin.
 */
const express = require('express');
const { failure } = require('../../../../utils/helpers/apiError');
const { paginate } = require('../../../../utils/helpers/pagination');
const { checkPermission } = require('../../../../middleware/security');
const { resolveWindow } = require('../../../../services/analytics/timeWindow');
const { resolvePolicy, ttlForWindow } = require('../../../../services/analytics/analyticsPolicyResolver');
const analyticsCache = require('../../../../services/analytics/analyticsCache');
const customers = require('../../../../services/analytics/customerAnalytics');

const router = express.Router();

const canSeeRevenue = (req) => !!req.user?.hasPermission?.('analytics.revenue');

/**
 * Money fields, by name.
 *
 * Named explicitly rather than matched on a pattern, and `share` is
 * deliberately NOT in the list: in this domain the same `withShare` helper
 * produces a share of headcount in one view and a share of revenue in another.
 * The revenue one is renamed `revenueSharePercent` at the service boundary so
 * this filter can tell them apart.
 */
const MONEY_KEYS = new Set([
  'amount', 'walletBalance', 'outstanding', 'revenuePerAccount',
  'revenueSharePercent', 'toWallet', 'toDebt', 'debtSharePercent', 'funding',
]);

const stripMoney = (payload, allowed) => {
  if (allowed) return payload;
  const scrub = (value) => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (MONEY_KEYS.has(k)) continue;
        out[k] = scrub(v);
      }
      return out;
    }
    return value;
  };
  return scrub(payload);
};

const read = (domain, loader) => async (req, res) => {
  try {
    const policy = await resolvePolicy();
    const window = resolveWindow(req.query, policy);
    const allowed = canSeeRevenue(req);
    const key = analyticsCache.cacheKey(`customers:${domain}`, {
      w: window.cacheKey,
      revenue: allowed ? 1 : 0,
      kind: req.query.kind || '',
      sort: req.query.sort || '',
      limit: req.query.limit || '',
    });
    const ttlMs = req.query.fresh === '1' ? 0 : ttlForWindow(policy, window);
    const data = await analyticsCache.cached(key, () => loader(window, policy, req), { ttlMs });
    res.json({ success: true, ...stripMoney(data, allowed) });
  } catch (error) {
    failure(res, error, `Error fetching ${domain}`, { log: `Analytics customers ${domain}` });
  }
};

// @route   GET /api/v1/admin/analytics/customers/summary
// @desc    Signups, account mix, headcount and PAYG access in one payload
router.get('/summary', checkPermission('analytics.view'),
  read('summary', (window, policy) => customers.getSummary(window, policy)));

// @route   GET /api/v1/admin/analytics/customers/signups
// @desc    Signups over time, by verification state and sign-up method
router.get('/signups', checkPermission('analytics.view'),
  read('signups', (window) => customers.getSignupTrend(window)));

// @route   GET /api/v1/admin/analytics/customers/activation
// @desc    Signed up → verified → asked → running → billed, with the censoring said out loud
router.get('/activation', checkPermission('analytics.view'),
  read('activation', (window, policy) => customers.getActivation(window, policy)));

// @route   GET /api/v1/admin/analytics/customers/mix
// @desc    What a personal account is worth against an organization
router.get('/mix', checkPermission('analytics.view'),
  read('mix', (window) => customers.getAccountMix(window)));

// @route   GET /api/v1/admin/analytics/customers/organizations
// @desc    Sizes, role mix, seat trend, domain features, the largest accounts
router.get('/organizations', checkPermission('analytics.view'),
  read('organizations', (window, policy) => customers.getOrganizations(window, policy)));

// @route   GET /api/v1/admin/analytics/customers/invitations
// @desc    Invitation outcomes and the other two doors into an organization
router.get('/invitations', checkPermission('analytics.view'),
  read('invitations', (window, policy) => customers.getInvitations(window, policy)));

// @route   GET /api/v1/admin/analytics/customers/member-flow
// @desc    People arriving and leaving organizations, by channel
router.get('/member-flow', checkPermission('analytics.view'),
  read('member-flow', (window, policy) => customers.getMemberFlow(window, policy)));

// @route   GET /api/v1/admin/analytics/customers/engagement
// @desc    Active accounts, DAU/WAU/MAU, stickiness and the dormancy ladder
router.get('/engagement', checkPermission('analytics.view'),
  read('engagement', (window, policy) => customers.getEngagement(window, policy)));

// @route   GET /api/v1/admin/analytics/customers/payg
// @desc    Who may run a tab, who does, and how that usage was funded
router.get('/payg', checkPermission('analytics.view'),
  read('payg', (window) => customers.getPaygAdoption(window)));

// @route   GET /api/v1/admin/analytics/customers/accounts
// @desc    The account list ranked by people and activity, not by money
router.get('/accounts', checkPermission('analytics.view'),
  read('accounts', (window, policy, req) => {
    const { limit } = paginate(req.query, { defaultLimit: 20, maxLimit: 100 });
    return customers.getAccounts(window, {
      limit,
      kind: req.query.kind || null,
      sort: req.query.sort || 'members',
    });
  }));

module.exports = router;
