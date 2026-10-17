/**
 * The at-risk list: who to look at, and why.
 *
 * ── What this deliberately does NOT do ──
 *
 * There is no "notify", no "suspend", no "open a ticket". A churn score is a
 * heuristic built from quiet weeks and empty wallets, and wiring an automatic
 * action to it is how a paying customer gets chased for taking a holiday. The
 * endpoints produce a list, the reasons behind each row, and a file an
 * operator can take away. A human decides what happens next.
 *
 * ── Money and the reason sentences ──
 *
 * The list is `analytics.view`, but one of its reasons quotes an unpaid
 * balance. Rather than blank the figure — which leaves "Owes , unpaid for 40
 * days" — or drop the reason, which hides why the account scored what it did,
 * the scorer is told whether the caller may see money and renders the
 * operator's money-free wording for that signal instead. The numeric balance
 * fields are stripped either way.
 *
 * Export is separately gated on `analytics.export`: being allowed to look at a
 * screen and being allowed to walk out with the customer list are different
 * permissions, and this is the first place the platform enforces that.
 */
const express = require('express');
const { failure } = require('../../../../utils/helpers/apiError');
const { checkPermission } = require('../../../../middleware/security');
const { resolvePolicy } = require('../../../../services/analytics/analyticsPolicyResolver');
const churnRisk = require('../../../../services/analytics/churnRiskService');

const router = express.Router();

const canSeeRevenue = (req) => !!req.user?.hasPermission?.('analytics.revenue');

/** Money fields on the signals block, by name. The sentences are handled by
 *  the scorer's money-free templates, not here. */
const MONEY_SIGNALS = ['balance', 'outstanding'];

const shape = (row, allowMoney) => {
  const s = row.signals || {};
  const signals = {
    accountAgeDays: s.accountAgeDays,
    daysSinceLogin: s.daysSinceLogin,
    daysSinceUsage: s.daysSinceUsage,
    daysSinceTopUp: s.daysSinceTopUp,
    deployments: s.deployments,
    running: s.running,
    cards: s.cards,
    openTickets: s.openTickets,
    autoChargeFailures: s.autoChargeFailures,
  };
  if (allowMoney) for (const k of MONEY_SIGNALS) signals[k] = s[k];

  return {
    teamId: s.teamId,
    teamName: s.teamName,
    teamKind: s.teamKind,
    createdAt: s.createdAt,
    score: row.score,
    band: row.band,
    bandLabel: row.bandLabel,
    reasons: row.reasons,
    signalsConsidered: row.signalsConsidered,
    signals,
  };
};

// @route   GET /api/v1/admin/analytics/churn-risk
// @desc    Accounts scored right now, worst first, with filters
router.get('/', checkPermission('analytics.view'), async (req, res) => {
  try {
    const policy = await resolvePolicy();
    const allowMoney = canSeeRevenue(req);
    /*
     * Deliberately not cached. This list is scored from live state and is the
     * one screen an operator refreshes after acting on it — serving two
     * minutes of staleness here means an account they just topped up is still
     * sitting in the at-risk list, and the list stops being believed.
     */
    const result = await churnRisk.list(policy, {
      band: req.query.band || null,
      kind: req.query.kind || null,
      search: req.query.search || '',
      minScore: req.query.minScore ?? null,
      limit: req.query.limit,
      canSeeMoney: allowMoney,
    });

    res.json({
      success: true,
      accounts: result.accounts.map((r) => shape(r, allowMoney)),
      total: result.total,
      scoredAccounts: result.scoredAccounts,
      bands: result.bands,
      thresholds: policy?.churn?.thresholds || {},
      definition: 'Scored from current state. Each signal counts for its weight out of the weights that could have applied to that account.',
      caveat: 'This is a prompt to look, not a verdict. Nothing here notifies or restricts anybody.',
    });
  } catch (error) {
    failure(res, error, 'Error building the churn risk list', { log: 'Analytics churn risk list' });
  }
});

/*
 * ── Where the export went ──
 *
 * This router used to carry its own `/export` handler: its own
 * `analytics.export` check, its own column list, its own audit write. It was
 * the platform's first export and the only place that permission was enforced.
 *
 * Adding a second and a third the same way would have meant the gate, the
 * money-stripping and the audit line repeated per handler — the shape where
 * one of them eventually gets forgotten, and on this router that one is the
 * customer list leaving the building. So all of it moved to the registry in
 * `services/analytics/exportService.js`, behind the single gated mount at
 * `/analytics/export`, and the churn list is now one entry in that table.
 *
 * The URL changed from `/churn-risk/export` to `/export/churn-risk`.
 */

module.exports = router;
