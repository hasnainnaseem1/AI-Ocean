/**
 * Revenue, wallets, receivables and dunning.
 *
 * The whole router carries `checkPermission('analytics.revenue')` at the mount
 * rather than per handler. Every figure in here is money, and a gate repeated
 * nine times is a gate that will eventually be forgotten once — which, on this
 * router, is the one that leaks the platform's books to a support agent.
 */
const express = require('express');
const { failure } = require('../../../../utils/helpers/apiError');
const { paginate } = require('../../../../utils/helpers/pagination');
const { checkPermission } = require('../../../../middleware/security');
const { resolveWindow } = require('../../../../services/analytics/timeWindow');
const { resolvePolicy, ttlForWindow } = require('../../../../services/analytics/analyticsPolicyResolver');
const analyticsCache = require('../../../../services/analytics/analyticsCache');
const revenue = require('../../../../services/analytics/revenueAnalytics');

const router = express.Router();

// One gate, applied once, for everything below.
router.use(checkPermission('analytics.revenue'));

const read = (domain, loader) => async (req, res) => {
  try {
    const policy = await resolvePolicy();
    const window = resolveWindow(req.query, policy);
    const key = analyticsCache.cacheKey(`revenue:${domain}`, {
      w: window.cacheKey,
      by: req.query.by || '',
      limit: req.query.limit || '',
    });
    const ttlMs = req.query.fresh === '1' ? 0 : ttlForWindow(policy, window);
    const data = await analyticsCache.cached(key, () => loader(window, policy, req), { ttlMs });
    res.json({ success: true, ...data });
  } catch (error) {
    failure(res, error, `Error fetching ${domain}`, { log: `Analytics revenue ${domain}` });
  }
};

// @desc  Earned vs collected, refunds, write-offs, ARPA — all period-scoped
router.get('/summary', read('summary', (w) => revenue.getSummary(w)));

// @desc  Money movement over time, by ledger type
router.get('/trend', read('trend', (w) => revenue.getTrend(w)));

// @desc  Usage-based MRR/ARR, with its definition attached
router.get('/recurring', read('recurring', (w) => revenue.getRecurring(w)));

// @desc  Breakdown by gateway | kind | funding | tier | model
router.get('/by-dimension', read('by-dimension', (w, p, req) => revenue.getByDimension(w, req.query.by)));

// @desc  Wallet totals and balance history rebuilt from the ledger
router.get('/wallets', read('wallets', (w) => revenue.getWallets(w)));

// @desc  What is owed, how old it is, and whether it is concentrated
router.get('/receivables', read('receivables', (w, p) => revenue.getReceivables(w, p)));

// @desc  Gateway attempts and success rate
router.get('/payments', read('payments', (w) => revenue.getPayments(w)));

// @desc  Expiring cards, failing auto-charges, accounts with no card at all
router.get('/dunning', read('dunning', (w, p) => revenue.getDunning(w, p)));

// @desc  Biggest accounts by what they were charged — by ACCOUNT, not by person
router.get('/top-accounts', read('top-accounts', (w, p, req) => {
  const { limit } = paginate(req.query, { defaultLimit: 10, maxLimit: 50 });
  return revenue.getTopAccounts(w, limit);
}));

module.exports = router;
