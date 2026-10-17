/**
 * The money, read from the ledger.
 *
 * ── Why `credit_transactions` and not `payments` ──
 *
 * `Payment` looks like the obvious source and is the wrong one. It has no
 * `gateway` column, so revenue cannot be attributed to Stripe vs Polar vs
 * LemonSqueezy from it at all. It has no `refunded_at`, so a payment taken in
 * March and refunded today cannot be attributed to today — which is exactly
 * what made the old "net revenue, last 7 days" an all-time figure wearing a
 * period's label.
 *
 * `CreditTransaction` has all of it: a `type` that separates a top-up from a
 * usage charge from a write-off, a `source` that names the gateway, its own
 * `created_at` for every movement, and — the part that matters most — a
 * `balance_after` and `outstanding_after` stamped on every row. Those two turn
 * an append-only ledger into a full history of what every wallet held and owed
 * on any day, without a single snapshot table.
 *
 * ── Three distinctions this module refuses to blur ──
 *
 *  • **Cash in is not revenue.** A top-up is money received; a usage charge is
 *    money earned. A platform can take USD 10,000 in top-ups in a month where
 *    it earned USD 300, and reporting one number would hide that completely.
 *  • **Owed is not earned.** Usage billed to debt (`to_debt`) was earned and
 *    not collected. It belongs in revenue AND in receivables, and nowhere is
 *    it netted away.
 *  • **Accounts, not people.** Every figure groups by `team_id`. An
 *    organization is one customer, not one customer per developer who happened
 *    to click deploy.
 */
const prisma = require('../../lib/prismaClient');
const { bucketExpr, fillSeries, describe } = require('./timeWindow');
const {
  num, round2, pct, deltaPct, withShare,
} = require('./numeric');
const { bucketFor } = require('./analyticsPolicyDefaults');

/** Ledger rows are signed from the wallet's point of view. An operator reads
 *  "refunds: 40", not "refunds: −40", so outbound types are reported positive. */
const abs2 = (v) => round2(Math.abs(num(v)));

/* ── Headline ─────────────────────────────────────────────────────────── */

const ledgerTotals = async (from, to) => {
  const rows = await prisma.creditTransaction.groupBy({
    by: ['type'],
    where: { createdAt: { gte: from, lte: to } },
    _sum: { amount: true, debtDelta: true },
    _count: { _all: true },
  });
  const byType = {};
  for (const r of rows) {
    byType[r.type] = {
      amount: num(r._sum.amount),
      debtDelta: num(r._sum.debtDelta),
      count: r._count._all,
    };
  }
  return byType;
};

const getSummary = async (window) => {
  const [current, previous, seatNow, seatPrev, payingRows, usageSplit] = await Promise.all([
    ledgerTotals(window.from, window.to),
    ledgerTotals(window.prevFrom, window.prevTo),
    prisma.teamSeatCharge.aggregate({
      where: { day: { gte: window.from, lte: window.to } }, _sum: { amount: true },
    }),
    prisma.teamSeatCharge.aggregate({
      where: { day: { gte: window.prevFrom, lte: window.prevTo } }, _sum: { amount: true },
    }),
    // One row per paying account, counted in the database rather than pulled
    // into JS — the old code materialised every succeeded payment of the month
    // just to count distinct customers.
    prisma.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT "team_id")::int AS accounts
       FROM "credit_transactions"
       WHERE "type" = 'charge' AND "created_at" >= $1 AND "created_at" <= $2`,
      window.from, window.to,
    ),
    prisma.deploymentUsage.aggregate({
      where: { periodStart: { gte: window.from, lte: window.to } },
      _sum: { toWallet: true, toDebt: true, amount: true },
    }),
  ]);

  const earned = (t) => abs2(t.charge?.amount);
  const grossEarned = earned(current) + round2(num(seatNow._sum.amount));
  const prevEarned = earned(previous) + round2(num(seatPrev._sum.amount));
  const refunds = abs2(current.refund?.amount);
  const payingAccounts = payingRows[0]?.accounts || 0;

  return {
    // What the platform earned by running machines and charging seats.
    grossRevenue: round2(grossEarned),
    refunds,
    refundCount: current.refund?.count || 0,
    netRevenue: round2(grossEarned - refunds),

    // Cash that came in. Deliberately a separate line from revenue.
    topUps: round2(num(current.topup?.amount)),
    topUpCount: current.topup?.count || 0,

    usageCharges: earned(current),
    seatFees: round2(num(seatNow._sum.amount)),
    bonuses: round2(num(current.bonus?.amount) + num(current.signup_credit?.amount)),
    adjustments: round2(num(current.adjustment?.amount)),
    writeOffs: abs2(current.debt_writeoff?.debtDelta),
    disputes: abs2(current.dispute?.amount),

    // How earned revenue was funded: out of a wallet, or straight onto debt.
    funding: {
      fromWallet: round2(num(usageSplit._sum.toWallet)),
      toDebt: round2(num(usageSplit._sum.toDebt)),
      debtSharePercent: pct(num(usageSplit._sum.toDebt), num(usageSplit._sum.amount)),
    },

    payingAccounts,
    arpa: payingAccounts ? round2(grossEarned / payingAccounts) : 0,

    delta: {
      grossRevenue: deltaPct(grossEarned, prevEarned),
      topUps: deltaPct(num(current.topup?.amount), num(previous.topup?.amount)),
      refunds: deltaPct(Math.abs(num(current.refund?.amount)), Math.abs(num(previous.refund?.amount))),
    },
    window: describe(window),
  };
};

/* ── Movement over time ───────────────────────────────────────────────── */

const getTrend = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${bucketExpr(window.granularity, '"created_at"', window.timezone)} AS bucket,
            COALESCE(SUM(CASE WHEN "type" = 'topup'  THEN "amount" ELSE 0 END), 0)::float AS top_ups,
            COALESCE(SUM(CASE WHEN "type" = 'charge' THEN ABS("amount") ELSE 0 END), 0)::float AS charges,
            COALESCE(SUM(CASE WHEN "type" = 'refund' THEN ABS("amount") ELSE 0 END), 0)::float AS refunds,
            COALESCE(SUM(CASE WHEN "type" IN ('bonus','signup_credit') THEN "amount" ELSE 0 END), 0)::float AS bonuses,
            COALESCE(SUM(CASE WHEN "type" = 'debt_accrual'    THEN "debt_delta" ELSE 0 END), 0)::float AS debt_accrued,
            COALESCE(SUM(CASE WHEN "type" = 'debt_settlement' THEN ABS("debt_delta") ELSE 0 END), 0)::float AS debt_settled
     FROM "credit_transactions"
     WHERE "created_at" >= $1 AND "created_at" <= $2
     GROUP BY 1`,
    window.from, window.to,
  );

  return {
    series: fillSeries(rows, window, {
      fields: {
        top_ups: 0, charges: 0, refunds: 0, bonuses: 0, debt_accrued: 0, debt_settled: 0,
      },
    }).map((r) => ({
      bucket: r.bucket,
      topUps: round2(r.top_ups),
      charges: round2(r.charges),
      refunds: round2(r.refunds),
      bonuses: round2(r.bonuses),
      debtAccrued: round2(r.debt_accrued),
      debtSettled: round2(r.debt_settled),
      net: round2(r.top_ups - r.refunds),
    })),
    window: describe(window),
  };
};

/* ── Recurring revenue ────────────────────────────────────────────────── */

/**
 * There is no subscription on this platform — everything is metered. So MRR
 * here is explicitly "what the last 30 days of usage would annualise to", and
 * the definition travels with the number so nobody reads it as contracted
 * revenue. The alternative was to omit it, but an operator comparing this
 * platform to anything else will reach for MRR, and a clearly-defined
 * approximation beats them computing a worse one by hand.
 */
const getRecurring = async (window) => {
  const now = window.to;
  const thirty = new Date(now.getTime() - 30 * 86400000);
  const sixty = new Date(now.getTime() - 60 * 86400000);

  const [lastMonth, monthBefore, series] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(ABS("amount")), 0)::float AS earned,
              COUNT(DISTINCT "team_id")::int AS accounts
       FROM "credit_transactions"
       WHERE "type" = 'charge' AND "created_at" >= $1 AND "created_at" <= $2`,
      thirty, now,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(ABS("amount")), 0)::float AS earned,
              COUNT(DISTINCT "team_id")::int AS accounts
       FROM "credit_transactions"
       WHERE "type" = 'charge' AND "created_at" >= $1 AND "created_at" < $2`,
      sixty, thirty,
    ),
    prisma.$queryRawUnsafe(
      `SELECT to_char(date_trunc('month', "created_at"), 'YYYY-MM') AS month,
              COALESCE(SUM(ABS("amount")), 0)::float AS earned,
              COUNT(DISTINCT "team_id")::int AS accounts
       FROM "credit_transactions"
       WHERE "type" = 'charge' AND "created_at" >= $1
       GROUP BY 1 ORDER BY 1`,
      new Date(now.getFullYear() - 1, now.getMonth(), 1),
    ),
  ]);

  const mrr = round2(lastMonth[0]?.earned);
  const prevMrr = round2(monthBefore[0]?.earned);

  return {
    mrr,
    arr: round2(mrr * 12),
    mrrGrowthPercent: deltaPct(mrr, prevMrr),
    payingAccounts: lastMonth[0]?.accounts || 0,
    arpa: lastMonth[0]?.accounts ? round2(mrr / lastMonth[0].accounts) : 0,
    monthly: series.map((r) => ({
      month: r.month, earned: round2(r.earned), accounts: r.accounts,
    })),
    definition: 'Usage-based: the last 30 days of billed usage, annualised. Not contracted revenue — this platform has no subscriptions.',
    window: describe(window),
  };
};

/* ── Breakdowns ───────────────────────────────────────────────────────── */

const BY = {
  /** Which gateway the money came through. Only the ledger knows this —
   *  `Payment` has no gateway column at all. */
  gateway: async (window) => {
    const rows = await prisma.creditTransaction.groupBy({
      by: ['source'],
      where: { type: 'topup', createdAt: { gte: window.from, lte: window.to } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      key: r.source, label: r.source, amount: round2(num(r._sum.amount)), count: r._count._all,
    }));
  },

  /** What kind of movement it was. */
  kind: async (window) => {
    const byType = await ledgerTotals(window.from, window.to);
    return Object.entries(byType).map(([type, v]) => ({
      key: type, label: type.replace(/_/g, ' '), amount: abs2(v.amount), count: v.count,
    }));
  },

  /** Wallet vs debt — the honest prepaid/PAYG split, taken from how each
   *  usage tick was actually funded rather than from the deployment's current
   *  billing method, which can have changed since. */
  funding: async (window) => {
    const agg = await prisma.deploymentUsage.aggregate({
      where: { periodStart: { gte: window.from, lte: window.to } },
      _sum: { toWallet: true, toDebt: true },
    });
    return [
      { key: 'wallet', label: 'Paid from wallet', amount: round2(num(agg._sum.toWallet)) },
      { key: 'debt', label: 'Billed to debt', amount: round2(num(agg._sum.toDebt)) },
    ];
  },

  tier: async (window) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(NULLIF(d."tier_name", ''), 'Custom build') AS label,
              COALESCE(SUM(du."amount"), 0)::float AS amount,
              COUNT(DISTINCT du."deployment_id")::int AS count
       FROM "deployment_usages" du JOIN "deployments" d ON d."id" = du."deployment_id"
       WHERE du."period_start" >= $1 AND du."period_start" <= $2
       GROUP BY 1 ORDER BY amount DESC LIMIT 20`,
      window.from, window.to,
    );
    return rows.map((r) => ({ key: r.label, label: r.label, amount: round2(r.amount), count: r.count }));
  },

  model: async (window) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(NULLIF(d."model_name", ''), 'Unknown') AS label,
              COALESCE(SUM(du."amount"), 0)::float AS amount,
              COUNT(DISTINCT du."deployment_id")::int AS count
       FROM "deployment_usages" du JOIN "deployments" d ON d."id" = du."deployment_id"
       WHERE du."period_start" >= $1 AND du."period_start" <= $2
       GROUP BY 1 ORDER BY amount DESC LIMIT 20`,
      window.from, window.to,
    );
    return rows.map((r) => ({ key: r.label, label: r.label, amount: round2(r.amount), count: r.count }));
  },
};

const getByDimension = async (window, by = 'gateway') => {
  const fn = BY[by] || BY.gateway;
  const rows = await fn(window);
  return { by, rows: withShare(rows, 'amount'), window: describe(window) };
};

/* ── Wallets ──────────────────────────────────────────────────────────── */

/**
 * Wallet balances over time, rebuilt from the ledger.
 *
 * `credit_wallets.balance` is a single mutable number — there is no balance
 * history table and this module deliberately does not add one, because every
 * row of `credit_transactions` already carries the `balance_after` it produced.
 * Taking the last row per account per bucket and summing reconstructs the
 * platform's held balance on any day exactly, from data already written.
 */
const getWallets = async (window) => {
  const [totals, autoTopUp, distribution, seriesRows] = await Promise.all([
    prisma.creditWallet.aggregate({
      _sum: { balance: true, outstandingBalance: true, lifetimeTopUp: true, lifetimeSpend: true },
      _count: { _all: true },
    }),
    prisma.creditWallet.count({ where: { autoTopUpEnabled: true } }),
    prisma.$queryRawUnsafe(
      `SELECT CASE
                WHEN "balance" <= 0   THEN 'empty'
                WHEN "balance" < 10   THEN 'under10'
                WHEN "balance" < 50   THEN 'under50'
                WHEN "balance" < 250  THEN 'under250'
                ELSE 'over250' END AS bucket,
              COUNT(*)::int AS accounts,
              COALESCE(SUM("balance"), 0)::float AS amount
       FROM "credit_wallets" GROUP BY 1`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT bucket, SUM(balance_after)::float AS balance, SUM(outstanding_after)::float AS outstanding
       FROM (
         SELECT DISTINCT ON (team_id, bucket)
                team_id,
                ${bucketExpr(window.granularity, '"created_at"', window.timezone)} AS bucket,
                "balance_after"      AS balance_after,
                "outstanding_after"  AS outstanding_after
         FROM "credit_transactions"
         WHERE "created_at" >= $1 AND "created_at" <= $2
         ORDER BY team_id, bucket, "created_at" DESC
       ) last_per_bucket
       GROUP BY bucket`,
      window.from, window.to,
    ),
  ]);

  const LABEL = {
    empty: 'Empty', under10: 'Under $10', under50: '$10–50', under250: '$50–250', over250: 'Over $250',
  };

  return {
    walletCount: totals._count._all,
    totalBalance: round2(num(totals._sum.balance)),
    totalOutstanding: round2(num(totals._sum.outstandingBalance)),
    lifetimeTopUp: round2(num(totals._sum.lifetimeTopUp)),
    lifetimeSpend: round2(num(totals._sum.lifetimeSpend)),
    autoTopUpAccounts: autoTopUp,
    autoTopUpAdoptionPercent: pct(autoTopUp, totals._count._all),
    balanceDistribution: distribution.map((r) => ({
      key: r.bucket, label: LABEL[r.bucket] || r.bucket, accounts: r.accounts, amount: round2(r.amount),
    })),
    series: fillSeries(seriesRows, window, { fields: { balance: 0, outstanding: 0 } })
      .map((r) => ({ bucket: r.bucket, balance: round2(r.balance), outstanding: round2(r.outstanding) })),
    definition: 'Balance history is reconstructed from the running balance stamped on every ledger row — no snapshot table is involved.',
    window: describe(window),
  };
};

/* ── Receivables ──────────────────────────────────────────────────────── */

const getReceivables = async (window, policy) => {
  const buckets = policy?.receivables?.agingBuckets || [];
  const warnPercent = Number(policy?.receivables?.concentrationWarnPercent) || 20;

  const [wallets, movementRows, earnedAgg] = await Promise.all([
    prisma.creditWallet.findMany({
      where: { outstandingBalance: { gt: 0 } },
      select: {
        teamId: true, outstandingBalance: true, debtSince: true, autoChargeFailures: true,
        team: { select: { name: true, kind: true, disputeHold: true } },
      },
      orderBy: { outstandingBalance: 'desc' },
    }),
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, '"created_at"', window.timezone)} AS bucket,
              COALESCE(SUM(CASE WHEN "type" = 'debt_accrual'    THEN "debt_delta" ELSE 0 END), 0)::float AS accrued,
              COALESCE(SUM(CASE WHEN "type" = 'debt_settlement' THEN ABS("debt_delta") ELSE 0 END), 0)::float AS settled,
              COALESCE(SUM(CASE WHEN "type" = 'debt_writeoff'   THEN ABS("debt_delta") ELSE 0 END), 0)::float AS written_off
       FROM "credit_transactions"
       WHERE "created_at" >= $1 AND "created_at" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
    prisma.creditTransaction.aggregate({
      where: { type: 'charge', createdAt: { gte: window.from, lte: window.to } },
      _sum: { amount: true },
    }),
  ]);

  const now = Date.now();
  const aging = buckets.map((b) => ({ ...b, amount: 0, accounts: 0 }));
  for (const w of wallets) {
    const days = w.debtSince ? Math.floor((now - w.debtSince.getTime()) / 86400000) : 0;
    const bucket = bucketFor(days, buckets, 'maxDays');
    const row = aging.find((a) => a.key === bucket?.key) || aging[aging.length - 1];
    if (row) {
      row.amount = round2(row.amount + num(w.outstandingBalance));
      row.accounts += 1;
    }
  }

  const outstanding = round2(wallets.reduce((s, w) => s + num(w.outstandingBalance), 0));
  const earned = Math.abs(num(earnedAgg._sum.amount));

  return {
    outstanding,
    accounts: wallets.length,
    /*
     * Days sales outstanding: at the rate we earned over this window, how
     * many days of revenue are sitting uncollected. A single number an
     * operator can compare month to month without knowing the book size.
     */
    dso: earned > 0 ? Math.round(outstanding / (earned / Math.max(1, window.spanDays))) : null,
    aging: aging.map(({ key, label, amount, accounts }) => ({ key, label, amount, accounts })),
    concentration: wallets.slice(0, 10).map((w) => ({
      teamId: w.teamId,
      name: w.team?.name || 'Unknown account',
      kind: w.team?.kind || 'personal',
      disputeHold: !!w.team?.disputeHold,
      amount: round2(num(w.outstandingBalance)),
      sharePercent: pct(num(w.outstandingBalance), outstanding),
      days: w.debtSince ? Math.floor((now - w.debtSince.getTime()) / 86400000) : 0,
      autoChargeFailures: w.autoChargeFailures,
    })),
    concentrationWarnPercent: warnPercent,
    movement: fillSeries(movementRows, window, { fields: { accrued: 0, settled: 0, written_off: 0 } })
      .map((r) => ({
        bucket: r.bucket,
        accrued: round2(r.accrued),
        settled: round2(r.settled),
        writtenOff: round2(r.written_off),
        net: round2(r.accrued - r.settled - r.written_off),
      })),
    window: describe(window),
  };
};

/* ── Payments and dunning ─────────────────────────────────────────────── */

const getPayments = async (window) => {
  const [byStatus, avgAgg, seriesRows] = await Promise.all([
    prisma.payment.groupBy({
      by: ['status'],
      where: { createdAt: { gte: window.from, lte: window.to } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { status: 'succeeded', paidAt: { gte: window.from, lte: window.to } },
      _avg: { amount: true },
    }),
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, '"created_at"', window.timezone)} AS bucket,
              COUNT(*) FILTER (WHERE "status" = 'succeeded')::int AS succeeded,
              COUNT(*) FILTER (WHERE "status" = 'failed')::int    AS failed
       FROM "payments"
       WHERE "created_at" >= $1 AND "created_at" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
  ]);

  const count = (s) => byStatus.find((r) => r.status === s)?._count?._all || 0;
  const succeeded = count('succeeded');
  const failed = count('failed');
  const attempts = succeeded + failed;

  return {
    attempts,
    succeeded,
    failed,
    pending: count('pending'),
    refunded: count('refunded'),
    cancelled: count('cancelled'),
    successRate: attempts ? pct(succeeded, attempts) : null,
    averageAmount: round2(num(avgAgg._avg.amount)),
    byStatus: byStatus.map((r) => ({
      status: r.status, count: r._count._all, amount: round2(num(r._sum.amount)),
    })),
    series: fillSeries(seriesRows, window, { fields: { succeeded: 0, failed: 0 } }),
    window: describe(window),
  };
};

/**
 * Whether we can still collect from the people who owe us.
 *
 * Expired cards and repeated auto-charge failures are the quiet way a healthy
 * account turns into a receivable: nothing fails loudly, the balance simply
 * stops being topped up and the usage starts landing on debt instead.
 */
const getDunning = async (window, policy) => {
  const expiringDays = Number(policy?.churn?.thresholds?.cardExpiringWithinDays) || 30;
  const minFailures = Number(policy?.churn?.thresholds?.autoChargeFailures) || 2;
  const now = new Date();
  const soon = new Date(now.getTime() + expiringDays * 86400000);

  const [methodsByStatus, failing, allCards, accountsWithWallet, accountsWithMethod] = await Promise.all([
    prisma.paymentMethod.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.creditWallet.findMany({
      where: { autoChargeFailures: { gte: minFailures } },
      select: {
        teamId: true, autoChargeFailures: true, lastAutoChargeError: true, lastAutoChargeAt: true,
        outstandingBalance: true, team: { select: { name: true, kind: true } },
      },
      orderBy: { autoChargeFailures: 'desc' },
      take: 20,
    }),
    prisma.paymentMethod.findMany({
      where: { status: 'active' },
      select: { teamId: true, expMonth: true, expYear: true, brand: true, last4: true },
    }),
    prisma.creditWallet.count(),
    prisma.paymentMethod.findMany({ where: { status: 'active' }, select: { teamId: true }, distinct: ['teamId'] }),
  ]);

  // Expiry is month-granular on the card, so "expiring soon" is computed
  // against the END of the stated month — a card marked 10/2026 is valid
  // through the whole of October.
  const expiringSoon = allCards.filter((c) => {
    if (!c.expMonth || !c.expYear) return false;
    const endOfMonth = new Date(c.expYear, c.expMonth, 0, 23, 59, 59);
    return endOfMonth <= soon;
  });

  return {
    methodsByStatus: methodsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
    expiringWithinDays: expiringDays,
    expiringSoon: expiringSoon.length,
    expiringCards: expiringSoon.slice(0, 10).map((c) => ({
      teamId: c.teamId, brand: c.brand, last4: c.last4, expires: `${c.expMonth}/${c.expYear}`,
    })),
    autoChargeFailures: failing.map((w) => ({
      teamId: w.teamId,
      name: w.team?.name || 'Unknown account',
      kind: w.team?.kind || 'personal',
      failures: w.autoChargeFailures,
      lastError: w.lastAutoChargeError || '',
      lastAt: w.lastAutoChargeAt,
      outstanding: round2(num(w.outstandingBalance)),
    })),
    accountsWithNoMethod: Math.max(0, accountsWithWallet - accountsWithMethod.length),
    totalAccounts: accountsWithWallet,
    window: describe(window),
  };
};

/* ── Biggest accounts, by account ─────────────────────────────────────── */

const getTopAccounts = async (window, limit = 10) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "team_id" AS team_id,
            COALESCE(SUM(CASE WHEN "type" = 'charge' THEN ABS("amount") ELSE 0 END), 0)::float AS earned,
            COALESCE(SUM(CASE WHEN "type" = 'topup'  THEN "amount" ELSE 0 END), 0)::float AS top_ups,
            COUNT(*)::int AS movements
     FROM "credit_transactions"
     WHERE "created_at" >= $1 AND "created_at" <= $2
     GROUP BY "team_id"
     ORDER BY earned DESC
     LIMIT $3`,
    window.from, window.to, Number(limit) || 10,
  );
  if (!rows.length) return { accounts: [], window: describe(window) };

  const ids = rows.map((r) => r.team_id);
  const [teams, wallets] = await Promise.all([
    prisma.team.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, name: true, kind: true, disputeHold: true,
        createdBy: { select: { name: true, email: true } },
      },
    }),
    prisma.creditWallet.findMany({
      where: { teamId: { in: ids } },
      select: { teamId: true, balance: true, outstandingBalance: true },
    }),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const walletBy = new Map(wallets.map((w) => [w.teamId, w]));

  return {
    accounts: rows.map((r) => {
      const t = teamById.get(r.team_id);
      const w = walletBy.get(r.team_id);
      return {
        teamId: r.team_id,
        name: t?.name || 'Unknown account',
        kind: t?.kind || 'personal',
        ownerEmail: t?.createdBy?.email || '',
        disputeHold: !!t?.disputeHold,
        earned: round2(r.earned),
        topUps: round2(r.top_ups),
        movements: r.movements,
        balance: round2(num(w?.balance)),
        outstanding: round2(num(w?.outstandingBalance)),
      };
    }),
    window: describe(window),
  };
};

module.exports = {
  getSummary, getTrend, getRecurring, getByDimension,
  getWallets, getReceivables, getPayments, getDunning, getTopAccounts,
};
