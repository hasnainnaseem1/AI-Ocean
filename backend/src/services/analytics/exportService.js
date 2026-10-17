/**
 * What may be exported, as a registry.
 *
 * ── Why a registry rather than an endpoint per dataset ──
 *
 * `analytics.export` is a permission the platform has carried since before any
 * export existed, and the first one — the churn list — enforced it in its own
 * handler. A second and third export written the same way means the gate is
 * repeated per handler, which is the shape where one eventually gets
 * forgotten; and on this router that one would be the customer list walking
 * out of the building.
 *
 * So there is one gated endpoint and a table of datasets. Adding an export is
 * an entry here: a name, the permission it additionally needs, the columns,
 * and a loader. Nothing new has to remember to check anything.
 *
 * ── Two rules every dataset here follows ──
 *
 *  • **Money is a separate right.** A dataset whose columns include amounts
 *    declares `moneyColumns`, and they are dropped for a caller without
 *    `analytics.revenue` rather than the whole export being refused — the
 *    non-money half is usually what they wanted.
 *  • **Every export is audited.** A file of customer data leaving is exactly
 *    the event somebody later needs to account for.
 *
 * ── `tab` ──
 *
 * Each dataset names the analytics tab it belongs to, so the Export button on
 * that tab can offer exactly what is on the screen in front of it. The mapping
 * lives here rather than in the frontend for the same reason the list does: a
 * dataset added below should appear on its tab without a release, and a
 * hardcoded copy in the UI is the thing that goes stale.
 */
const { toCsv } = require('../../utils/helpers/csv');
const { resolvePolicy } = require('./analyticsPolicyResolver');
const { resolveWindow } = require('./timeWindow');
const churnRiskService = require('./churnRiskService');
const customerAnalytics = require('./customerAnalytics');
const infrastructureAnalytics = require('./infrastructureAnalytics');
const retentionAnalytics = require('./retentionAnalytics');
const revenueAnalytics = require('./revenueAnalytics');
const supportAnalytics = require('./supportAnalytics');
const trafficAnalytics = require('./trafficAnalytics');
const { getSettings } = require('../admin/adminSettingsService');

/**
 * `columns` entries are `{ key, label, value? }`. `value(row)` lets a column be
 * derived without the loader flattening its data first.
 */
const DATASETS = {
  tiers: {
    tab: 'infrastructure',
    label: 'Machine types',
    description: 'Every tier with its stock, what is running on it, and what it earned in the window.',
    moneyColumns: ['pricePerHour', 'revenueInWindow'],
    columns: [
      { key: 'name', label: 'Tier' },
      { key: 'category', label: 'Category' },
      { key: 'gpu', label: 'GPU' },
      { key: 'vramGb', label: 'VRAM (GB)' },
      { key: 'status', label: 'Status' },
      { key: 'stockLevel', label: 'Stock level' },
      { key: 'capacityTotal', label: 'Capacity' },
      { key: 'capacityAllocated', label: 'In use' },
      { key: 'available', label: 'Available' },
      { key: 'utilisationPercent', label: 'Utilisation (%)' },
      { key: 'activeDeployments', label: 'Running now' },
      { key: 'deploymentsInWindow', label: 'Deployments in window' },
      { key: 'hoursInWindow', label: 'Machine hours in window' },
      { key: 'lastStockOutAt', label: 'Last out of stock' },
      { key: 'pricePerHour', label: 'Price per hour' },
      { key: 'revenueInWindow', label: 'Earned in window' },
    ],
    load: async ({ window, policy }) => (await infrastructureAnalytics.getTiers(window, policy)).tiers,
  },

  'revenue-accounts': {
    tab: 'revenue',
    label: 'Accounts by money',
    /* `earned` and `topUps` are two different things and the description says
       so, because a column called "revenue" would be read as either. */
    description: 'What each account was billed in the window, what it paid in, and where its wallet stands now.',
    moneyColumns: ['earned', 'topUps', 'balance', 'outstanding'],
    columns: [
      { key: 'name', label: 'Account' },
      { key: 'kind', label: 'Type' },
      { key: 'ownerEmail', label: 'Owner' },
      { key: 'movements', label: 'Ledger movements in window' },
      { key: 'disputeHold', label: 'On dispute hold' },
      { key: 'earned', label: 'Billed usage in window' },
      { key: 'topUps', label: 'Topped up in window' },
      { key: 'balance', label: 'Wallet balance now' },
      { key: 'outstanding', label: 'Outstanding now' },
    ],
    load: async ({ window }) => (await revenueAnalytics.getTopAccounts(window, 500)).accounts,
  },

  'support-agents': {
    tab: 'support',
    label: 'Agent load',
    description: 'What each admin replied to, answered first, and closed in the window.',
    moneyColumns: [],
    columns: [
      { key: 'name', label: 'Agent' },
      { key: 'messages', label: 'Replies sent' },
      { key: 'sharePercent', label: 'Share of replies (%)' },
      { key: 'ticketsTouched', label: 'Tickets touched' },
      { key: 'firstResponses', label: 'First responses' },
      { key: 'resolved', label: 'Resolved' },
      { key: 'openAssigned', label: 'Still assigned and open' },
    ],
    load: async ({ window }) => (await supportAnalytics.getAgents(window)).agents,
  },

  'retention-cohorts': {
    tab: 'retention',
    /*
     * Long, not wide. A cohort matrix as CSV would need a column per month,
     * which changes shape with the policy and cannot be appended to. One row
     * per cohort-month reads the same in every spreadsheet and survives the
     * policy being retuned.
     *
     * Months that have not happened yet are LEFT OUT rather than written as
     * blanks — the same decision the heatmap makes by drawing an empty cell.
     * A row saying 0 retained would be read as churn when it is simply not a
     * measurement.
     */
    label: 'Retention cohorts',
    description: 'One row per cohort and month. The date range does not apply — how far back cohorts go is set in the analytics policy, exactly as on screen. Months that have not happened yet are left out rather than written as zero.',
    moneyColumns: [],
    columns: [
      { key: 'cohort', label: 'Cohort month' },
      { key: 'size', label: 'Accounts in cohort' },
      { key: 'month', label: 'Month' },
      { key: 'monthIndex', label: 'Months since signup' },
      { key: 'accounts', label: 'Still active' },
      { key: 'percent', label: 'Retained (%)' },
    ],
    load: async ({ window, policy }) => {
      const { matrix } = await retentionAnalytics.getCohorts(window, policy);
      return matrix.flatMap((row) => row.cells
        .filter(Boolean)
        .map((cell) => ({ cohort: row.cohort, size: row.size, ...cell })));
    },
  },

  'traffic-sources': {
    tab: 'traffic',
    label: 'Traffic by source',
    description: 'Where visits came from in the window, on whichever dimension the page is showing.',
    moneyColumns: [],
    columns: [
      { key: 'value', label: 'Source' },
      { key: 'sessions', label: 'Visits' },
      { key: 'views', label: 'Views' },
      { key: 'sharePercent', label: 'Share of visits (%)' },
      { key: 'bounceRatePercent', label: 'Bounced (%)' },
      { key: 'averageSeconds', label: 'Average seconds per visit' },
    ],
    load: async ({ window, policy, query }) => {
      const settings = await getSettings();
      const result = await trafficAnalytics.getBreakdown(window, policy, {
        by: query.by || 'source',
        site: ['marketing', 'customer', 'admin'].includes(query.site) ? query.site : null,
        settings: settings?.analyticsSettings || {},
        limit: 50,
      });
      return result.items;
    },
  },

  'churn-risk': {
    tab: 'churn-risk',
    label: 'At-risk accounts',
    description: 'Every account scored right now, worst first, with the reasons behind each score.',
    moneyColumns: ['balance', 'outstanding'],
    columns: [
      { key: 'teamName', label: 'Account' },
      { key: 'teamKind', label: 'Type' },
      { key: 'score', label: 'Risk score' },
      { key: 'bandLabel', label: 'Band' },
      { key: 'reasons', label: 'Why', value: (r) => r.reasons.map((x) => x.sentence).join(' | ') },
      { key: 'daysSinceLogin', label: 'Days since sign-in', value: (r) => r.signals.daysSinceLogin },
      { key: 'daysSinceUsage', label: 'Days since usage', value: (r) => r.signals.daysSinceUsage },
      { key: 'deployments', label: 'Deployments', value: (r) => r.signals.deployments },
      { key: 'running', label: 'Running now', value: (r) => r.signals.running },
      { key: 'openTickets', label: 'Open tickets', value: (r) => r.signals.openTickets },
      { key: 'balance', label: 'Wallet balance', value: (r) => r.signals.balance },
      { key: 'outstanding', label: 'Outstanding', value: (r) => r.signals.outstanding },
      { key: 'createdAt', label: 'Account created', value: (r) => r.signals.createdAt },
    ],
    load: async ({ policy, query, canSeeMoney }) => {
      const result = await churnRiskService.list(policy, {
        band: query.band || null,
        kind: query.kind || null,
        search: query.search || '',
        minScore: query.minScore ?? null,
        limit: 500,
        canSeeMoney,
      });
      return result.accounts.map((r) => ({
        teamName: r.signals.teamName,
        teamKind: r.signals.teamKind,
        score: r.score,
        bandLabel: r.bandLabel,
        reasons: r.reasons,
        signals: r.signals,
      }));
    },
  },

  accounts: {
    tab: 'customers',
    label: 'Accounts',
    description: 'Every account with its headcount, deployments and when it was last seen.',
    moneyColumns: [],
    columns: [
      { key: 'name', label: 'Account' },
      { key: 'kind', label: 'Type' },
      { key: 'members', label: 'People' },
      { key: 'deployments', label: 'Deployments' },
      { key: 'running', label: 'Running now' },
      { key: 'hours', label: 'Machine hours in window' },
      { key: 'daysSinceSeen', label: 'Days since last seen' },
      { key: 'createdAt', label: 'Created' },
    ],
    load: async ({ window, query }) => {
      const result = await customerAnalytics.getAccounts(window, {
        limit: 500, kind: query.kind || null, sort: query.sort || 'members',
      });
      return result.accounts;
    },
  },

  'support-backlog': {
    tab: 'support',
    label: 'Support backlog',
    /*
     * Says "right now" because it means it. A backlog is a measurement of the
     * present and the window does not narrow it — and with an Export button
     * sitting beside a date picker, a description that stayed quiet about that
     * would have somebody believing they had exported last month's queue.
     */
    description: 'Every ticket open right now, oldest first, with what it was promised. The date range does not apply — a backlog is a measurement of the present.',
    moneyColumns: [],
    columns: [
      { key: 'number', label: 'Ticket', value: (r) => `TCK-${1000 + Number(r.number)}` },
      { key: 'subject', label: 'Subject' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'category', label: 'Category' },
      { key: 'ageHours', label: 'Hours open' },
      { key: 'quietHours', label: 'Hours since last message' },
      { key: 'answered', label: 'Has been replied to' },
      { key: 'assignedTo', label: 'Assigned to' },
      { key: 'responseBreached', label: 'Past first-reply target' },
      { key: 'resolutionBreached', label: 'Past resolution target' },
    ],
    /* The screen shows the ten oldest because that is a readable table. A file
       that silently stopped at ten would be read as the whole backlog. */
    load: async ({ window, policy }) => (await supportAnalytics.getBacklog(window, policy, { limit: 500 })).oldest,
  },

  'traffic-pages': {
    tab: 'traffic',
    label: 'Traffic by page',
    description: 'Most-visited pages in the window, grouped by path pattern.',
    moneyColumns: [],
    columns: [
      { key: 'path', label: 'Page' },
      { key: 'views', label: 'Views' },
      { key: 'sessions', label: 'Visits' },
      { key: 'entries', label: 'Landed here' },
      { key: 'averageSeconds', label: 'Average seconds on page' },
      { key: 'share', label: 'Share of views (%)' },
    ],
    load: async ({ window, policy, query }) => {
      const settings = await getSettings();
      const result = await trafficAnalytics.getPages(window, policy, {
        site: ['marketing', 'customer', 'admin'].includes(query.site) ? query.site : null,
        settings: settings?.analyticsSettings || {},
        limit: 500,
      });
      return result.pages;
    },
  },
};

/** What the UI lists, without exposing the loaders. */
const describeAll = () => Object.entries(DATASETS).map(([key, d]) => ({
  key,
  tab: d.tab,
  label: d.label,
  description: d.description,
  hasMoney: (d.moneyColumns || []).length > 0,
}));

/**
 * The file's name says which window it came from.
 *
 * Two exports of the same dataset taken over different windows are different
 * files, and a name built only from the dataset and today's date makes them
 * indistinguishable in a downloads folder — the second silently arriving as
 * "tiers-2026-10-05 (1).csv" beside a file it has nothing in common with.
 *
 * A preset is relative, so it carries the day it was taken ("30d" means
 * nothing without it). A date range already says exactly what it covers, so it
 * does not need one; `..` becomes `_to_` because it reads as a filename rather
 * than as a path.
 */
const fileNameFor = (name, window) => {
  const today = new Date().toISOString().slice(0, 10);
  const label = String(window.label || '');
  const span = label.includes('..')
    ? label.replace('..', '_to_')
    : `${label || 'window'}-${today}`;
  /*
   * The label is server-built today — a key from a fixed preset table, or two
   * formatted dates — so none of this can currently be reached. It is filtered
   * anyway because the value ends up in a `Content-Disposition` header, and a
   * later change that let a caller name their own window would turn a filename
   * into header injection with nothing in between to stop it.
   */
  return `${name}-${span}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120).concat('.csv');
};

/**
 * Build one dataset as CSV.
 *
 * Returns `{ filename, csv, rows, columns }`. Throws a 404-shaped error for an
 * unknown dataset rather than returning an empty file — an export that
 * silently produces a header row and nothing else is worse than an error,
 * because somebody will believe it.
 */
const build = async (name, { query = {}, canSeeMoney = true } = {}) => {
  const dataset = DATASETS[name];
  if (!dataset) {
    const err = new Error(`No exportable dataset called "${name}"`);
    err.status = 404;
    throw err;
  }

  const policy = await resolvePolicy();
  const window = resolveWindow(query, policy);
  const rows = await dataset.load({
    window, policy, query, canSeeMoney,
  });

  const money = new Set(canSeeMoney ? [] : (dataset.moneyColumns || []));
  const columns = dataset.columns.filter((c) => !money.has(c.key));

  return {
    filename: fileNameFor(name, window),
    csv: toCsv(rows, columns),
    rows: rows.length,
    columns: columns.length,
    droppedMoneyColumns: money.size,
    window: window.label,
  };
};

module.exports = { DATASETS, describeAll, build };
