/**
 * Analytics — the mount point, and nothing else.
 *
 * ── What used to be here ──
 *
 * Eight hand-written handlers (`/overview`, `/users-growth`,
 * `/deployments-trend`, `/top-customers`, `/recent-activities`,
 * `/revenue-stats`, `/login-analytics`, `/revenue-advanced`) and the 393-line
 * `services/admin/analyticsService.js` behind them. They are gone, along with
 * the problems they carried:
 *
 *   • revenue figures that ignored the period they claimed to cover
 *   • money grouped by `user_id`, so an organization's spend was split across
 *     its developers and the platform's biggest customers never appeared
 *   • three different calendars inside one response
 *   • gap-filling copy-pasted four times, with the bug in all four
 *
 * Every question they answered is answered by a domain router below, by a
 * figure that says what window it covers and which calendar it is on. The
 * replacements are not a port: `/users-growth` became an activation funnel
 * that admits how much of its own cohort is too young to judge, and
 * `/top-customers` became a list of ACCOUNTS rather than of people.
 *
 * ── Why one mount with sub-routers ──
 *
 * The permission story and the frontend's API clients stay simple — one base
 * path — while each domain lives in its own file. The combined domains are
 * several thousand lines; one router file holding them would be the same
 * mistake this phase just finished undoing.
 */
const express = require('express');

const router = express.Router();

/*
 * `adminAuth` is applied where this router is mounted (admin/index.js), not
 * here — repeating it would verify the token and load the user twice on every
 * analytics request. Each sub-router then names its own permission:
 * `analytics.view` for most, `analytics.revenue` for the money,
 * `analytics.export` for anything that leaves as a file.
 */
router.use('/infrastructure', require('./analytics/infrastructure.routes'));
router.use('/revenue', require('./analytics/revenue.routes'));
router.use('/customers', require('./analytics/customers.routes'));
router.use('/support', require('./analytics/support.routes'));
router.use('/retention', require('./analytics/retention.routes'));
router.use('/churn-risk', require('./analytics/churnRisk.routes'));
router.use('/traffic', require('./analytics/traffic.routes'));
router.use('/export', require('./analytics/export.routes'));

module.exports = router;
