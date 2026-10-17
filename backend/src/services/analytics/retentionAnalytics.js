/**
 * Whether customers stay, and whether the money stays with them.
 *
 * Two different questions that are constantly confused:
 *
 *   • **Logo retention** — of the accounts that joined in March, how many are
 *     still doing anything? That is the cohort matrix.
 *   • **Revenue retention** — of the money those accounts were spending, how
 *     much is still arriving? That is GRR and NRR, and it can be healthy while
 *     logo retention collapses (one large account growing covers for ten small
 *     ones leaving) or the reverse.
 *
 * Both are reported, never averaged together.
 *
 * ── What counts as "retained" ──
 *
 * Set by `retention.retainedBy` in the policy, because it is a judgement about
 * this business rather than a fact: a platform that bills hourly for running
 * machines should probably count usage, while one selling seats might count
 * sign-ins. The response always echoes which rule produced it, so a number
 * from one policy is never read as if it came from another.
 *
 * ── Why the cohort grid is built in SQL and filled in JavaScript ──
 *
 * Postgres produces (cohort month, active month, accounts); the dense grid is
 * assembled here. A pivot in SQL would have to know the column count in
 * advance, which is exactly the thing `retention.cohortPeriods` is allowed to
 * change.
 */
const prisma = require('../../lib/prismaClient');
const { describe } = require('./timeWindow');
const { num, round2, pct } = require('./numeric');

const DAY_MS = 86400000;

/**
 * The activity table and column each `retainedBy` rule reads.
 *
 * A closed map: the policy chooses a key, never supplies SQL. `any` is a union
 * of the other three.
 */
const ACTIVITY_SOURCES = {
  usage: 'SELECT du."team_id" AS team_id, du."period_start" AS at FROM "deployment_usages" du',
  payment: `SELECT ct."team_id", ct."created_at" FROM "credit_transactions" ct
            WHERE ct."type" IN ('topup','charge','bonus','signup_credit')`,
  login: `SELECT tm."team_id", al."created_at"
          FROM "activity_logs" al
          JOIN "team_members" tm ON tm."user_id" = al."user_id"
          WHERE al."user_role" = 'customer'`,
};

const activitySql = (rule) => {
  if (rule === 'any') return Object.values(ACTIVITY_SOURCES).join('\n UNION ALL \n');
  return ACTIVITY_SOURCES[rule] || ACTIVITY_SOURCES.usage;
};

/** Add `n` whole months to a 'YYYY-MM' key. */
const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const total = (y * 12) + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

/* ── Cohort matrix ────────────────────────────────────────────────────── */

const getCohorts = async (window, policy) => {
  const rule = policy?.retention?.retainedBy || 'usage';
  const periods = Math.min(24, Math.max(2, Number(policy?.retention?.cohortPeriods) || 12));
  const tz = window.timezone;

  /*
   * `periods` months back from the start of the current month. Not from the
   * selected window: a cohort chart is about the life of an account, which is
   * a different axis from the toolbar's date range, and slicing it by the
   * window would show a three-month-old cohort as having no fourth month.
   */
  const rows = await prisma.$queryRawUnsafe(
    `WITH cohorts AS (
       SELECT t.id AS team_id,
              to_char(date_trunc('month', (t."created_at" AT TIME ZONE 'UTC' AT TIME ZONE $1)), 'YYYY-MM') AS cohort
       FROM "teams" t
       WHERE t."deleted_at" IS NULL
         AND t."created_at" >= date_trunc('month', NOW()) - ($2 || ' months')::interval
     ),
     acts AS (
       SELECT a.team_id,
              to_char(date_trunc('month', (a.at AT TIME ZONE 'UTC' AT TIME ZONE $1)), 'YYYY-MM') AS month
       FROM ( ${activitySql(rule)} ) a
       WHERE a.at >= date_trunc('month', NOW()) - ($2 || ' months')::interval
     )
     SELECT c.cohort,
            a.month,
            COUNT(DISTINCT c.team_id)::int AS accounts
     FROM cohorts c
     JOIN acts a ON a.team_id = c.team_id
     WHERE a.month >= c.cohort
     GROUP BY 1, 2`,
    tz, String(periods),
  );

  const sizes = await prisma.$queryRawUnsafe(
    `SELECT to_char(date_trunc('month', (t."created_at" AT TIME ZONE 'UTC' AT TIME ZONE $1)), 'YYYY-MM') AS cohort,
            COUNT(*)::int AS accounts
     FROM "teams" t
     WHERE t."deleted_at" IS NULL
       AND t."created_at" >= date_trunc('month', NOW()) - ($2 || ' months')::interval
     GROUP BY 1 ORDER BY 1`,
    tz, String(periods),
  );

  const active = new Map();
  for (const r of rows) active.set(`${r.cohort}|${r.month}`, num(r.accounts));

  const nowKey = new Date().toISOString().slice(0, 7);
  const matrix = sizes.map((c) => {
    const size = num(c.accounts);
    const cells = [];
    for (let i = 0; i < periods; i += 1) {
      const month = addMonths(c.cohort, i);
      // A month that has not happened yet is not 0% retention — it is not a
      // measurement. `null` renders as an empty cell, never as a dark one.
      if (month > nowKey) { cells.push(null); continue; }
      const count = active.get(`${c.cohort}|${month}`) || 0;
      cells.push({ month, monthIndex: i, accounts: count, percent: pct(count, size) });
    }
    return { cohort: c.cohort, size, cells };
  });

  return {
    matrix,
    periods,
    retainedBy: rule,
    definition: `An account counts as retained in a month if it had ${rule === 'any' ? 'any activity' : rule} that month.`,
    /*
     * Month 0 is the month the account signed up, so it is not 100% by
     * construction: an account created on the 30th that never did anything is
     * genuinely 0% in its own first month. That is a real signal, not a bug,
     * and saying so stops somebody "fixing" it.
     */
    caveat: 'Month 0 is the signup month and is not 100% by definition — an account that never got started counts as not retained even in its first month.',
    window: describe(window),
  };
};

/* ── Revenue retention ────────────────────────────────────────────────── */

/**
 * GRR and NRR between the previous window and this one.
 *
 * Measured per account on its billed usage plus seat fees:
 *
 *   starting     what the accounts active LAST period were billed then
 *   churned      all of it, for accounts that billed nothing this period
 *   contraction  the drop, for accounts that billed less but not nothing
 *   expansion    the rise, for accounts that billed more
 *
 *   GRR = (starting − churned − contraction) / starting      — never over 100%
 *   NRR = (starting − churned − contraction + expansion) / starting
 *
 * GRR is the leakier of the two and the one that cannot be papered over: it
 * ignores expansion entirely, so one account tripling its spend cannot hide
 * nine quietly leaving.
 */
const getRevenueRetention = async (window) => {
  const spendSql = `
    SELECT team_id, COALESCE(SUM(amount), 0)::float AS amount FROM (
      SELECT du."team_id" AS team_id, du."amount" AS amount
      FROM "deployment_usages" du
      WHERE du."period_start" >= $1 AND du."period_start" <= $2
      UNION ALL
      SELECT sc."team_id", sc."amount"
      FROM "team_seat_charges" sc
      WHERE sc."day" >= $1 AND sc."day" <= $2
    ) s GROUP BY team_id`;

  const [currentRows, previousRows] = await Promise.all([
    prisma.$queryRawUnsafe(spendSql, window.from, window.to),
    prisma.$queryRawUnsafe(spendSql, window.prevFrom, window.prevTo),
  ]);

  const current = new Map(currentRows.map((r) => [r.team_id, num(r.amount)]));
  const previous = new Map(previousRows.map((r) => [r.team_id, num(r.amount)]));

  let starting = 0;
  let churned = 0;
  let contraction = 0;
  let expansion = 0;
  let churnedAccounts = 0;
  let contractedAccounts = 0;
  let expandedAccounts = 0;
  let retainedAccounts = 0;

  for (const [teamId, before] of previous) {
    if (before <= 0) continue;
    starting += before;
    const after = current.get(teamId) || 0;
    if (after <= 0) { churned += before; churnedAccounts += 1; continue; }
    retainedAccounts += 1;
    if (after < before) { contraction += before - after; contractedAccounts += 1; } else if (after > before) { expansion += after - before; expandedAccounts += 1; }
  }

  // Accounts that billed this period but not last — new, not expansion. Kept
  // out of NRR on purpose: NRR measures the existing base, and folding new
  // customers in turns it into a growth metric wearing a retention label.
  let newRevenue = 0;
  let newAccounts = 0;
  for (const [teamId, after] of current) {
    if (!previous.get(teamId)) { newRevenue += after; newAccounts += 1; }
  }

  const grr = starting ? pct(starting - churned - contraction, starting) : null;
  const nrr = starting ? pct(starting - churned - contraction + expansion, starting) : null;

  return {
    starting: round2(starting),
    churned: round2(churned),
    contraction: round2(contraction),
    expansion: round2(expansion),
    newRevenue: round2(newRevenue),
    grossRetentionPercent: grr,
    netRetentionPercent: nrr,
    accounts: {
      startingBase: churnedAccounts + retainedAccounts,
      retained: retainedAccounts,
      churned: churnedAccounts,
      contracted: contractedAccounts,
      expanded: expandedAccounts,
      new: newAccounts,
      logoRetentionPercent: (churnedAccounts + retainedAccounts)
        ? pct(retainedAccounts, churnedAccounts + retainedAccounts) : null,
    },
    definition: 'Measured on billed usage plus seat fees, comparing this window against the one immediately before it. New accounts are excluded from both figures.',
    /*
     * The honest limitation. Two 30-day windows is a fine comparison; two
     * 7-day windows is mostly noise, because a single account that happened
     * not to run anything last week reads as a churn.
     */
    caveat: (window.to - window.from) / DAY_MS < 28
      ? 'This window is shorter than a month — a single quiet week reads as churn, so treat these as indicative only.'
      : null,
    window: describe(window),
  };
};

/* ── Dormancy and coming back ─────────────────────────────────────────── */

const getLifecycle = async (window, policy) => {
  const rule = policy?.retention?.retainedBy || 'usage';
  const reactivationDays = Number(policy?.retention?.reactivationAfterDays) || 60;

  /*
   * Four states, counted over the accounts that were active in this window:
   *
   *   new          first ever activity falls inside the window
   *   returning    active now, and their previous activity was long enough
   *                ago to count as having come back rather than continued
   *   continuing   active now and active recently
   *   lapsed       active before the window, silent through all of it
   */
  const rows = await prisma.$queryRawUnsafe(
    `WITH acts AS ( ${activitySql(rule)} ),
     per_team AS (
       SELECT team_id,
              MIN(at) AS first_at,
              MAX(at) FILTER (WHERE at >= $1 AND at <= $2) AS last_in_window,
              MAX(at) FILTER (WHERE at < $1)               AS last_before
       FROM acts GROUP BY team_id
     )
     SELECT
       COUNT(*) FILTER (WHERE last_in_window IS NOT NULL AND first_at >= $1)::int AS new_accounts,
       COUNT(*) FILTER (
         WHERE last_in_window IS NOT NULL AND first_at < $1 AND last_before IS NOT NULL
           AND EXTRACT(EPOCH FROM ($1::timestamp - last_before)) / 86400 >= $3
       )::int AS returning_accounts,
       COUNT(*) FILTER (
         WHERE last_in_window IS NOT NULL AND first_at < $1
           AND (last_before IS NULL
                OR EXTRACT(EPOCH FROM ($1::timestamp - last_before)) / 86400 < $3)
       )::int AS continuing_accounts,
       COUNT(*) FILTER (WHERE last_in_window IS NULL AND last_before IS NOT NULL)::int AS lapsed_accounts
     FROM per_team`,
    window.from, window.to, reactivationDays,
  );

  const r = rows[0] || {};
  const active = num(r.new_accounts) + num(r.returning_accounts) + num(r.continuing_accounts);

  return {
    states: [
      { key: 'new', label: 'First time here', accounts: num(r.new_accounts) },
      { key: 'continuing', label: 'Still with us', accounts: num(r.continuing_accounts) },
      { key: 'returning', label: 'Came back', accounts: num(r.returning_accounts) },
      { key: 'lapsed', label: 'Gone quiet', accounts: num(r.lapsed_accounts) },
    ],
    activeAccounts: active,
    reactivationDays,
    retainedBy: rule,
    definition: `Activity means ${rule === 'any' ? 'anything' : rule}. "Came back" means the account had been silent for at least ${reactivationDays} days before this window.`,
    window: describe(window),
  };
};

/* ── Risk over time, from the snapshots ───────────────────────────────── */

const getRiskTrend = async (window, policy) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_char("day", 'YYYY-MM-DD') AS bucket, "band", COUNT(*)::int AS accounts
     FROM "churn_risk_snapshots"
     WHERE "day" >= $1 AND "day" <= $2
     GROUP BY 1, 2 ORDER BY 1`,
    window.from, window.to,
  );

  const bands = (policy?.churn?.bands || []).map((b) => b.key);
  const byDay = new Map();
  for (const r of rows) {
    const entry = byDay.get(r.bucket) || { bucket: r.bucket };
    entry[r.band] = num(r.accounts);
    byDay.set(r.bucket, entry);
  }
  const series = [...byDay.values()].map((row) => {
    const out = { bucket: row.bucket };
    for (const b of bands) out[b] = row[b] || 0;
    return out;
  });

  const first = await prisma.churnRiskSnapshot.aggregate({ _min: { day: true } });

  return {
    series,
    bands: (policy?.churn?.bands || []).map((b) => ({ key: b.key, label: b.label })),
    /*
     * Not gap-filled. A day the nightly job did not run has no row, and
     * drawing a zero there would say every at-risk account recovered
     * overnight — the single most misleading thing this chart could do.
     */
    trackedFrom: first._min.day || null,
    caveat: first._min.day
      ? `Risk history starts ${new Date(first._min.day).toISOString().slice(0, 10)}, when snapshots began. Days with no point are days the nightly job did not run.`
      : 'No snapshots have been taken yet — the nightly job writes the first one tonight.',
    window: describe(window),
  };
};

module.exports = {
  getCohorts, getRevenueRetention, getLifecycle, getRiskTrend,
};
