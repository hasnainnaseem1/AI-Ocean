/**
 * Which accounts look like they are on the way out, and why.
 *
 * ── Shape: gather, score, explain — three separable steps ──
 *
 * `gatherSignals` does all the database work, once, for every account at a
 * time. `scoreTeam` is **pure**: signals and a policy in, score and reasons
 * out, no I/O. `render` turns the reasons into the operator's own sentences.
 *
 * The purity of the middle step is the point. Scoring is the part with the
 * judgement in it, and it is the part somebody will want to re-run against a
 * different weighting, test without a database, or replay over a stored
 * snapshot. A scorer that queries as it goes can do none of those.
 *
 * ── Nothing here decides anything ──
 *
 * This produces a list and the reasons behind it. It does not email anybody,
 * suspend anything or open a ticket — that was an explicit decision when the
 * phase was planned. A score is a prompt for a human to look, and an automatic
 * action taken on a heuristic is how a paying customer gets chased for being
 * quiet during their holiday.
 *
 * ── Weights are relative, not percentages ──
 *
 * Each signal's weight is divided by the sum of the weights that COULD have
 * fired, so adding a tenth signal later does not silently deflate the other
 * nine. A signal set to 0 is switched off without being removed, which keeps
 * old snapshots readable.
 */
const prisma = require('../../lib/prismaClient');
const { num, round2, pct } = require('./numeric');
const { bandForScore, render } = require('./analyticsPolicyDefaults');

const DAY_MS = 86400000;

const daysSince = (date, now) => (date
  ? Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / DAY_MS))
  : null);

/* ── 1. Gather ────────────────────────────────────────────────────────── */

/**
 * Every signal for every live account, in one pass.
 *
 * Deliberately one query rather than a fan-out per team: the per-team version
 * is the shape that works beautifully on the twelve accounts a dev database
 * has and takes four minutes on a real one, by which point the nightly job is
 * the reason the database is slow.
 */
const gatherSignals = async ({ teamId = null } = {}) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       t.id, t."name", t."kind"::text AS kind, t."created_at", t."dispute_hold",
       w."balance"::float               AS balance,
       w."outstanding_balance"::float   AS outstanding,
       w."debt_since",
       w."auto_top_up_enabled",
       w."auto_charge_failures",
       w."last_auto_charge_error",
       w."suspended_at",
       act.last_login,
       usage.last_usage,
       money.last_topup,
       dep.total_deployments,
       dep.running_deployments,
       dep.terminated_deployments,
       card.cards,
       card.soonest_expiry_year,
       card.soonest_expiry_month,
       card.brand,
       card.last4,
       tick.open_tickets,
       tick.oldest_ticket_at
     FROM "teams" t
     LEFT JOIN "credit_wallets" w ON w."team_id" = t.id
     LEFT JOIN LATERAL (
       SELECT MAX(u."last_login") AS last_login
       FROM "team_members" tm JOIN "users" u ON u.id = tm."user_id"
       WHERE tm."team_id" = t.id
     ) act ON TRUE
     LEFT JOIN LATERAL (
       SELECT MAX(du."period_start") AS last_usage
       FROM "deployment_usages" du WHERE du."team_id" = t.id
     ) usage ON TRUE
     LEFT JOIN LATERAL (
       SELECT MAX(ct."created_at") AS last_topup
       FROM "credit_transactions" ct
       WHERE ct."team_id" = t.id AND ct."type" IN ('topup','bonus','signup_credit')
     ) money ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS total_deployments,
              COUNT(*) FILTER (WHERE d."status" IN ('running','provisioning'))::int AS running_deployments,
              COUNT(*) FILTER (WHERE d."status" = 'terminated')::int AS terminated_deployments
       FROM "deployments" d WHERE d."team_id" = t.id
     ) dep ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS cards,
              MIN(p."exp_year" * 100 + p."exp_month") / 100          AS soonest_expiry_year,
              MIN(p."exp_year" * 100 + p."exp_month") % 100          AS soonest_expiry_month,
              MAX(p."brand") AS brand, MAX(p."last4") AS last4
       FROM "payment_methods" p
       WHERE p."team_id" = t.id AND p."removed_at" IS NULL
     ) card ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS open_tickets, MIN(s."created_at") AS oldest_ticket_at
       FROM "support_tickets" s
       JOIN "team_members" tm ON tm."user_id" = s."user_id" AND tm."team_id" = t.id
       WHERE s."status" <> 'solved'
     ) tick ON TRUE
     WHERE t."deleted_at" IS NULL ${teamId ? 'AND t.id = $1' : ''}`,
    ...(teamId ? [teamId] : []),
  );

  const now = new Date();
  return rows.map((r) => {
    const expiryYear = r.soonest_expiry_year === null ? null : Number(r.soonest_expiry_year);
    const expiryMonth = r.soonest_expiry_month === null ? null : Number(r.soonest_expiry_month);
    // Last moment of the expiry month — a card is good until the month ends.
    const cardExpiresAt = expiryYear && expiryMonth
      ? new Date(Date.UTC(expiryYear, expiryMonth, 1) - 1)
      : null;

    return {
      teamId: r.id,
      teamName: r.name,
      teamKind: r.kind,
      createdAt: r.created_at,
      accountAgeDays: daysSince(r.created_at, now),

      daysSinceLogin: daysSince(r.last_login, now),
      daysSinceUsage: daysSince(r.last_usage, now),
      daysSinceTopUp: daysSince(r.last_topup, now),

      balance: round2(r.balance),
      outstanding: round2(r.outstanding),
      debtDays: daysSince(r.debt_since, now),
      autoTopUpEnabled: !!r.auto_top_up_enabled,
      autoChargeFailures: num(r.auto_charge_failures),
      lastAutoChargeError: r.last_auto_charge_error || '',
      suspendedAt: r.suspended_at || null,
      disputeHold: !!r.dispute_hold,

      deployments: num(r.total_deployments),
      running: num(r.running_deployments),
      terminated: num(r.terminated_deployments),

      cards: num(r.cards),
      cardBrand: r.brand || '',
      cardLast4: r.last4 || '',
      cardExpiresAt,
      // Negative once the card is past its expiry month, which is what lets
      // one signal cover both "expiring soon" and "already dead".
      cardDaysUntilExpiry: cardExpiresAt
        ? Math.floor((cardExpiresAt.getTime() - now.getTime()) / DAY_MS) : null,

      openTickets: num(r.open_tickets),
      oldestTicketDays: daysSince(r.oldest_ticket_at, now),
    };
  });
};

/* ── 2. Score (pure) ──────────────────────────────────────────────────── */

/**
 * Each signal: does it apply to this account at all, did it fire, and with
 * what figures.
 *
 * `applies` is separate from `fired` on purpose. An account with no card can
 * never trip "card expiring", so that signal must not sit in the denominator
 * dragging everyone's score down — the normaliser only counts the signals that
 * had a chance to fire.
 */
const SIGNALS = {
  dormancy: (s, th) => ({
    applies: s.daysSinceLogin !== null,
    fired: s.daysSinceLogin !== null && s.daysSinceLogin >= th.dormantDays,
    values: { days: s.daysSinceLogin, threshold: th.dormantDays },
  }),
  noUsage: (s, th) => ({
    // Only for accounts that ever used anything — "never deployed" is its own
    // signal below, and counting both would charge a new account twice.
    applies: s.deployments > 0,
    fired: s.deployments > 0 && (s.daysSinceUsage === null || s.daysSinceUsage >= th.noUsageDays),
    values: { days: s.daysSinceUsage ?? s.accountAgeDays, threshold: th.noUsageDays },
  }),
  debt: (s) => ({
    applies: true,
    fired: s.outstanding > 0,
    values: { amount: s.outstanding.toFixed(2), days: s.debtDays ?? 0, currency: '$' },
  }),
  walletEmpty: (s, th) => ({
    applies: true,
    fired: s.balance < Number(th.walletBelow) && !s.autoTopUpEnabled,
    values: { balance: s.balance.toFixed(2), currency: '$' },
  }),
  paymentFailing: (s, th) => ({
    applies: s.cards > 0,
    fired: s.autoChargeFailures >= Number(th.autoChargeFailures),
    values: { failures: s.autoChargeFailures, error: s.lastAutoChargeError || 'no reason given' },
  }),
  deploymentsWoundDown: (s) => ({
    applies: s.deployments > 0,
    fired: s.deployments > 0 && s.running === 0 && s.terminated > 0,
    values: { count: s.terminated },
  }),
  suspended: (s) => ({
    applies: true,
    fired: !!s.suspendedAt || s.disputeHold,
    values: { reason: s.disputeHold ? 'a payment dispute' : 'unpaid balance' },
  }),
  cardExpired: (s, th) => ({
    applies: s.cards > 0 && s.cardDaysUntilExpiry !== null,
    fired: s.cards > 0 && s.cardDaysUntilExpiry !== null
      && s.cardDaysUntilExpiry <= Number(th.cardExpiringWithinDays),
    values: {
      brand: s.cardBrand || 'card',
      last4: s.cardLast4 || '••••',
      state: s.cardDaysUntilExpiry < 0 ? 'has expired' : `expires in ${s.cardDaysUntilExpiry} days`,
    },
  }),
  openTickets: (s, th) => ({
    applies: true,
    fired: s.openTickets > 0 && (s.oldestTicketDays ?? 0) >= Number(th.minOpenTicketAgeDays),
    values: { count: s.openTickets, days: s.oldestTicketDays ?? 0 },
  }),
  neverActivated: (s, th) => ({
    applies: s.deployments === 0,
    fired: s.deployments === 0 && (s.accountAgeDays ?? 0) >= Number(th.noUsageDays),
    values: { days: s.accountAgeDays ?? 0 },
  }),
};

/**
 * Signals → a score out of 100, a band, and the reasons that got it there.
 *
 * Pure. No database, no clock, no policy lookup — everything comes from the
 * two arguments, so this can be unit-tested, re-run over a stored snapshot
 * with a different policy, or called in a loop without a connection.
 */
const scoreTeam = (signals, policy, { canSeeMoney = true } = {}) => {
  const churn = policy?.churn || {};
  const weights = churn.weights || {};
  const thresholds = churn.thresholds || {};
  const templates = churn.reasonTemplates || {};
  const moneyFree = churn.reasonTemplatesNoMoney || {};

  let possible = 0;
  let earned = 0;
  const reasons = [];

  for (const [key, evaluate] of Object.entries(SIGNALS)) {
    const weight = Number(weights[key]) || 0;
    if (!weight) continue;                      // switched off, not removed

    const result = evaluate(signals, thresholds);
    if (!result.applies) continue;              // could never fire; not a denominator
    possible += weight;
    if (!result.fired) continue;

    earned += weight;
    const template = (!canSeeMoney && moneyFree[key]) || templates[key] || key;
    reasons.push({
      key,
      weight,
      sentence: render(template, result.values),
      values: result.values,
    });
  }

  // Heaviest reason first: the list is read top-down and the top should be the
  // thing most responsible for the score.
  reasons.sort((a, b) => b.weight - a.weight);

  const score = possible ? Math.round((earned / possible) * 100) : 0;
  const band = bandForScore(score, policy);

  return {
    score,
    band: band?.key || 'healthy',
    bandLabel: band?.label || 'Healthy',
    reasons,
    // What the score was divided by, so an operator can see that a 60 over two
    // applicable signals is a different claim from a 60 over ten.
    signalsConsidered: Object.keys(SIGNALS).filter((k) => Number(weights[k]) > 0).length,
    weightApplicable: possible,
    weightFired: earned,
  };
};

/* ── 3. Use ───────────────────────────────────────────────────────────── */

/** Score every live account, newest state, worst first. */
const scoreAll = async (policy, opts = {}) => {
  const all = await gatherSignals(opts);
  return all
    .map((signals) => ({ signals, ...scoreTeam(signals, policy, opts) }))
    .sort((a, b) => b.score - a.score);
};

/**
 * Write today's snapshot for everything at or above the policy's floor.
 *
 * Idempotent: one row per team per day, upserted, so a re-run corrects the day
 * rather than doubling it. Accounts that have dropped below the floor since
 * this morning have their row removed, so the day always reflects one
 * consistent evaluation rather than a union of several.
 */
const snapshot = async (policy, { now = new Date() } = {}) => {
  const minScore = Number(policy?.churn?.snapshotMinScore) || 25;
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Scored with money visible: the snapshot is the platform's own record, and
  // what a given reader may see is decided when it is read.
  const scored = await scoreAll(policy, { canSeeMoney: true });
  const atRisk = scored.filter((s) => s.score >= minScore);
  const keep = new Set(atRisk.map((s) => s.signals.teamId));

  for (const row of atRisk) {
    await prisma.churnRiskSnapshot.upsert({
      where: { teamId_day: { teamId: row.signals.teamId, day } },
      update: {
        score: row.score,
        band: row.band,
        teamName: row.signals.teamName,
        teamKind: row.signals.teamKind,
        reasons: row.reasons,
        signals: row.signals,
      },
      create: {
        teamId: row.signals.teamId,
        day,
        score: row.score,
        band: row.band,
        teamName: row.signals.teamName,
        teamKind: row.signals.teamKind,
        reasons: row.reasons,
        signals: row.signals,
      },
    });
  }

  const stale = await prisma.churnRiskSnapshot.findMany({
    where: { day }, select: { id: true, teamId: true },
  });
  const drop = stale.filter((r) => !keep.has(r.teamId)).map((r) => r.id);
  if (drop.length) {
    await prisma.churnRiskSnapshot.deleteMany({ where: { id: { in: drop } } });
  }

  return { scored: scored.length, written: atRisk.length, removed: drop.length, minScore };
};

/**
 * Drop snapshots past the policy's retention.
 *
 * A retention below one day is treated as unset and falls back to the default
 * rather than being honoured. It is the only reading that is not destructive:
 * zero would mean "delete the history every night", which empties the one
 * table on the platform whose entire purpose is to remember, and it is far
 * more likely to be a blank field than a decision.
 */
const prune = async (retentionDays) => {
  const requested = Number(retentionDays);
  const days = Number.isFinite(requested) && requested >= 1 ? requested : 400;
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const { count } = await prisma.churnRiskSnapshot.deleteMany({
    where: { day: { lt: cutoff } },
  });
  return count;
};

/**
 * The at-risk list as it is RIGHT NOW — scored live, not read from the
 * snapshot.
 *
 * The snapshot answers "how has this moved"; the list answers "who should I
 * call today", and an operator looking at that list after a morning of top-ups
 * should see this morning's truth rather than last night's job.
 */
const list = async (policy, {
  band = null, kind = null, search = '', minScore = null, limit = 50, canSeeMoney = true,
} = {}) => {
  const scored = await scoreAll(policy, { canSeeMoney });
  const floor = minScore === null ? 0 : Number(minScore);
  const needle = String(search || '').trim().toLowerCase();

  const filtered = scored.filter((r) => {
    if (r.score < floor) return false;
    if (band && r.band !== band) return false;
    if (kind && r.signals.teamKind !== kind) return false;
    if (needle && !String(r.signals.teamName || '').toLowerCase().includes(needle)) return false;
    return true;
  });

  const counts = {};
  for (const r of scored) counts[r.band] = (counts[r.band] || 0) + 1;

  return {
    accounts: filtered.slice(0, Math.min(500, Math.max(1, Number(limit) || 50))),
    total: filtered.length,
    scoredAccounts: scored.length,
    bandCounts: counts,
    bands: (policy?.churn?.bands || []).map((b) => ({
      key: b.key,
      label: b.label,
      count: counts[b.key] || 0,
      share: pct(counts[b.key] || 0, scored.length),
    })),
  };
};

module.exports = {
  gatherSignals, scoreTeam, scoreAll, snapshot, prune, list, SIGNALS,
};
