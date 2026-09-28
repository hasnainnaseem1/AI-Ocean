/**
 * Credit Service
 *
 * The ONLY place CreditWallet.balance is allowed to change. Every mutation
 * writes a matching CreditTransaction row, so the balance can always be
 * reconciled against the ledger — which is exactly what the admin wallet view
 * does, and how tampering gets caught.
 *
 * `wallet.balance` and `wallet.outstandingBalance` change together in exactly
 * one real-money operation (a top-up settling debt — see debtService's
 * `settleFromWallet`), and separately in every other case. Because both live
 * on the same Postgres row, every write in this file goes through a real
 * `prisma.$transaction` — the wallet update and its ledger row commit
 * atomically. They used to be two independent writes with nothing tying them
 * together, which meant a failure between them left the balance and the ledger
 * disagreeing about how much money the customer had.
 *
 * ── Whose money ──
 *
 * A wallet belongs to an ACCOUNT (a Team — a customer's personal account or a
 * shared team), never to a user directly, so every function here takes a
 * `teamId`. Where a ledger row was written on some member's behalf — who paid
 * a top-up, who created the deployment being charged — that member is recorded
 * separately as the row's `userId` (`actorUserId` below); it never decides
 * whose balance moves.
 *
 * `CreditWallet.outstandingBalance` — an unpaid pay-as-you-go debt — is a
 * separate number owned by debtService.js, not this file. The two touch at
 * exactly one point: a top-up settles any outstanding debt before whatever is
 * left becomes spendable balance. debtService is required lazily inside the
 * functions that need it (never at the top of this file) because debtService
 * itself requires this file — a top-level require on both sides would hand
 * one of them a still-empty module.exports.
 */
const prisma = require('../../lib/prismaClient');
const { paginate } = require('../../utils/helpers/pagination');
const billingModeService = require('./billingModeService');
const paymentMethodService = require('./paymentMethodService');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');

/**
 * Money is rounded to four decimals, not two, because that is the precision the
 * database actually stores (`Decimal(12, 4)` on every balance and amount) and
 * because a charge is an hourly rate multiplied by a fraction of an hour, which
 * almost never lands on a cent.
 *
 * Rounding each tick to two decimals looked harmless while billing ran once an
 * hour and stopped being harmless the moment it ran more often: the same error
 * is taken once per tick, so six ticks an hour take it six times. On a real
 * tier at USD 1.469/hr that was USD 0.03 lost every hour — USD 21.60 a month,
 * per deployment — and on a USD 0.396/hr tier it went the other way and
 * OVERCHARGED by USD 14.40 a month, which is worse. Neither is acceptable: the
 * customer pays the published rate for the time they used, exactly.
 */
const roundMoney = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const num = (d) => (d === null || d === undefined ? d : Number(d));

// ── Response shape builders ────────

const toWalletDoc = (row, teamId) => ({
  teamId,
  balance: num(row.balance),
  outstandingBalance: num(row.outstandingBalance),
  debtSince: row.debtSince,
  debtNotifiedAt: row.debtNotifiedAt,
  lastAutoChargeAt: row.lastAutoChargeAt,
  autoChargeFailures: row.autoChargeFailures,
  lastAutoChargeError: row.lastAutoChargeError,
  currency: row.currency,
  lifetimeTopUp: num(row.lifetimeTopUp),
  lifetimeSpend: num(row.lifetimeSpend),
  autoTopUp: {
    enabled: row.autoTopUpEnabled,
    threshold: num(row.autoTopUpThreshold),
    amount: num(row.autoTopUpAmount),
  },
  lowBalanceNotifiedAt: row.lowBalanceNotifiedAt,
  suspendedAt: row.suspendedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const wrapWallet = (row, teamId) => (row ? { id: row.id, ...toWalletDoc(row, teamId || row.teamId) } : null);

const toTransactionDoc = (row, ctx) => ({
  teamId: ctx.teamId || row.teamId,
  userId: row.userId || null,
  walletId: ctx.walletId,
  type: row.type,
  amount: num(row.amount),
  balanceAfter: num(row.balanceAfter),
  debtDelta: num(row.debtDelta),
  outstandingAfter: num(row.outstandingAfter),
  currency: row.currency,
  source: row.source,
  referenceId: row.referenceId,
  referenceModel: row.referenceModel,
  description: row.description,
  metadata: row.metadata || {},
  createdBy: ctx.createdById || null,
  createdAt: row.createdAt,
});
const wrapTransaction = (row, ctx) => (row ? { id: row.id, ...toTransactionDoc(row, ctx) } : null);

const resolveUserDbId = async (id) => {
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: byPublicId(id), select: { id: true } });
  return user?.id || null;
};

/**
 * Internal: resolve (creating on first touch) the wallet for an account, as a
 * RAW Prisma record — `.id`/`.teamId` are the real Postgres uuids here,
 * needed by this file and debtService.js to build further writes against
 * the same row. External callers get `getOrCreateWallet`'s wrapped shape
 * instead.
 */
const resolveWallet = async (teamId) => {
  const team = await prisma.team.findUnique({ where: byPublicId(teamId), select: { id: true } });
  if (!team) throw new Error(`No account found for id ${teamId}`);

  let row = await prisma.creditWallet.findUnique({ where: { teamId: team.id } });
  if (!row) {
    const settings = await billingModeService.getBillingSettings();
    // Upsert on the unique `teamId` FK, not a plain create — this function is
    // called from several places, sometimes concurrently for the same
    // brand-new account (fundingService.check and debtService.status both
    // touch this at once). The unique index makes only one insert actually
    // happen; Postgres resolves the race, not application code.
    row = await prisma.creditWallet.upsert({
      where: { teamId: team.id },
      create: { teamId: team.id, balance: 0, currency: settings.currency || 'USD' },
      update: {},
    });
  }

  return { row, teamId, pgTeamId: team.id };
};

/**
 * Read-only wallet lookup — never creates one. Used by the admin customer
 * detail view, where merely looking at a customer's page shouldn't silently
 * provision them a wallet the way `getOrCreateWallet` deliberately does for
 * actual billing call sites.
 */
const findWallet = async (teamId) => {
  const row = await prisma.creditWallet.findUnique({ where: { teamId: byPublicId(teamId).id } });
  return row ? wrapWallet(row, String(teamId)) : null;
};

/** Fetch an account's wallet, creating it on first access. */
const getOrCreateWallet = async (teamId) => {
  const { row } = await resolveWallet(teamId);
  return wrapWallet(row, teamId);
};

/**
 * Internal: apply a signed amount to the wallet and write the ledger row,
 * both inside one Postgres transaction.
 */
const applyTransaction = async ({
  teamId,
  actorUserId = null,
  amount,
  type,
  source = 'system',
  referenceId = null,
  referenceModel = null,
  description = '',
  metadata = {},
  createdBy = null,
}) => {
  const { row: wallet, pgTeamId } = await resolveWallet(teamId);
  const createdById = await resolveUserDbId(createdBy);
  const actorId = await resolveUserDbId(actorUserId);

  const newBalance = roundMoney(num(wallet.balance) + amount);
  const lifetimeTopUp = amount > 0 ? roundMoney(num(wallet.lifetimeTopUp) + amount) : num(wallet.lifetimeTopUp);
  const lifetimeSpend = amount < 0 ? roundMoney(num(wallet.lifetimeSpend) + Math.abs(amount)) : num(wallet.lifetimeSpend);
  const [updatedWallet, transaction] = await prisma.$transaction([
    prisma.creditWallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance, lifetimeTopUp, lifetimeSpend },
    }),
    prisma.creditTransaction.create({
      data: {
        teamId: pgTeamId,
        userId: actorId,
        walletId: wallet.id,
        type,
        amount: roundMoney(amount),
        balanceAfter: newBalance,
        currency: wallet.currency,
        source,
        referenceId,
        referenceModel,
        description,
        metadata,
        createdById,
      },
    }),
  ]);

  const ctx = { walletId: updatedWallet.id, teamId, createdById: createdBy };

  return { wallet: wrapWallet(updatedWallet, teamId), transaction: wrapTransaction(transaction, ctx) };
};

/**
 * Add credit after a successful payment (or a bonus/refund).
 * `options.actorUserId` — the member who paid, recorded on the ledger row.
 */
const topUp = async (teamId, amount, options = {}) => {
  if (!amount || amount <= 0) {
    throw new Error('Top-up amount must be greater than zero');
  }

  const result = await applyTransaction({
    teamId,
    actorUserId: options.actorUserId || null,
    amount: Math.abs(amount),
    type: options.type || 'topup',
    source: options.source || 'system',
    referenceId: options.referenceId || null,
    referenceModel: options.referenceModel || (options.referenceId ? 'Payment' : null),
    description: options.description || `Credit top-up of ${amount}`,
    metadata: options.metadata || {},
    createdBy: options.createdBy || null,
  });

  // A top-up clears the low-balance warning latch
  if (result.wallet.lowBalanceNotifiedAt) {
    const cleared = await prisma.creditWallet.update({
      where: { id: (await resolveWallet(teamId)).row.id },
      data: { lowBalanceNotifiedAt: null, suspendedAt: null },
    });
    result.wallet = wrapWallet(cleared, teamId);
  }

  /**
   * Pay down any outstanding debt with this top-up before anything else sees
   * the new balance. `settleFromWallet` re-reads the wallet itself, so it
   * always acts on the balance this top-up just produced, not a stale copy.
   */
  const debtService = require('./debtService');
  const settlement = await debtService.settleFromWallet(teamId, {
    referenceId: options.referenceId || null,
    referenceModel: options.referenceModel || (options.referenceId ? 'Payment' : null),
  });

  return { ...result, wallet: settlement.wallet, debtSettled: settlement.settled };
};

/**
 * How much of a charge this wallet can actually cover right now.
 *
 * `floor` is the balance a charge is not allowed to take the wallet below —
 * `billingSettings.graceBalance`, normally 0. Setting it negative is how an
 * admin deliberately allows a customer to run a tab.
 */
const affordable = async (teamId, floor = 0) => {
  const wallet = await getOrCreateWallet(teamId);
  return { wallet, available: roundMoney(num(wallet.balance) - floor) };
};

/**
 * Deduct credit for usage.
 *
 * Refuses by default rather than overdrawing. Callers that genuinely need to
 * overdraw (storage debt on an already-stopped deployment) must say so
 * explicitly with `allowOverdraft`.
 *
 * @throws {Error} code `INSUFFICIENT_BALANCE`, carrying `available` and `shortfall`
 */
const charge = async (teamId, amount, options = {}) => {
  if (!amount || amount <= 0) {
    throw new Error('Charge amount must be greater than zero');
  }

  const floor = options.floor === undefined ? 0 : options.floor;

  if (!options.allowOverdraft) {
    const { wallet, available } = await affordable(teamId, floor);
    if (roundMoney(amount) > available) {
      const err = new Error(
        `Charge of ${roundMoney(amount)} exceeds the available balance of ${available}`
      );
      err.code = 'INSUFFICIENT_BALANCE';
      err.available = available;
      err.shortfall = roundMoney(amount - available);
      err.balance = num(wallet.balance);
      throw err;
    }
  }

  return applyTransaction({
    teamId,
    actorUserId: options.actorUserId || null,
    amount: -Math.abs(amount),
    type: 'charge',
    source: options.source || 'system',
    referenceId: options.referenceId || null,
    referenceModel: options.referenceModel || (options.referenceId ? 'Deployment' : null),
    description: options.description || `Usage charge of ${amount}`,
    metadata: options.metadata || {},
  });
};

/**
 * Manual admin credit/debit. `amount` is signed.
 */
const adjust = async (teamId, amount, options = {}) => {
  if (!amount || Number(amount) === 0) {
    throw new Error('Adjustment amount cannot be zero');
  }

  return applyTransaction({
    teamId,
    amount: Number(amount),
    type: options.type || 'adjustment',
    source: 'admin',
    referenceId: options.referenceId || null,
    referenceModel: options.referenceModel || 'Team',
    description: options.description || 'Manual adjustment by administrator',
    metadata: options.metadata || {},
    createdBy: options.createdBy || null,
  });
};

/**
 * Grant the configured signup bonus to a user's PERSONAL account. Idempotent
 * per person, not per account: a user who creates teams never gets a second
 * welcome credit (plan loophole #1 — otherwise every new team would be free
 * money). Checked by the user on any ledger row, in any account.
 */
const grantSignupBonus = async (userId) => {
  const settings = await billingModeService.getBillingSettings();
  const bonus = Number(settings.signupBonusCredits) || 0;
  if (bonus <= 0) return null;

  const pgUserId = await resolveUserDbId(userId);
  if (!pgUserId) return null;

  const existing = await prisma.creditTransaction.findFirst({ where: { userId: pgUserId, type: 'signup_credit' } });
  if (existing) return null;

  const personal = await prisma.team.findFirst({
    where: { createdById: pgUserId, kind: 'personal' }, select: { id: true },
  });
  if (!personal) return null;

  return topUp(personal.id, bonus, {
    type: 'signup_credit',
    source: 'system',
    description: 'Welcome credits',
    actorUserId: pgUserId,
  });
};

/**
 * Current burn rate ($/hr) across the customer's running deployments.
 * `deploymentService` is required lazily — it requires `fundingService`,
 * which requires this file, so a top-level require on both sides would hand
 * one of them a still-empty `module.exports`.
 */
const getBurnRate = async (teamId) => require('../deployment/deploymentService').getBurnRate(teamId);

/**
 * How many days the current balance lasts at the current burn rate.
 * Returns null when nothing is burning (runway is effectively infinite).
 */
const getRunwayDays = async (teamId) => {
  const [wallet, burnRate] = await Promise.all([
    getOrCreateWallet(teamId),
    getBurnRate(teamId),
  ]);

  if (!burnRate || burnRate <= 0) return null;
  const hours = num(wallet.balance) / burnRate;
  return Math.max(0, Math.round((hours / 24) * 10) / 10);
};

/** Set once a low-balance email goes out, so it isn't sent again on every cron run. */
const markLowBalanceNotified = async (teamId, at = new Date()) => {
  const { row: wallet } = await resolveWallet(teamId);
  const updated = await prisma.creditWallet.update({ where: { id: wallet.id }, data: { lowBalanceNotifiedAt: at } });
  return wrapWallet(updated, teamId);
};

/**
 * Record the instant a wallet was auto-suspended (hourly billing pausing
 * every deployment for lack of credit). Purely informational — nothing reads
 * it back today — but it must go through here rather than the caller mutating
 * `getOrCreateWallet`'s return value and calling a document-style `.save()`,
 * which that plain wrapped object has never had since this domain moved to
 * Postgres (Phase 3). Found while porting jobs/hourlyBilling.js (Phase 4):
 * that exact `wallet.save()` call was throwing on every real auto-suspend,
 * which was silently swallowing the admin notification and the pay-as-you-go
 * offer that were supposed to fire right after it.
 */
const markSuspended = async (teamId, at = new Date()) => {
  const { row: wallet } = await resolveWallet(teamId);
  const updated = await prisma.creditWallet.update({ where: { id: wallet.id }, data: { suspendedAt: at } });
  return wrapWallet(updated, teamId);
};

/** Update the customer's auto-top-up preferences. Only touches fields that are present. */
const updateAutoTopUp = async (teamId, { enabled, threshold, amount } = {}) => {
  const { row: wallet } = await resolveWallet(teamId);

  const data = {};
  if (enabled !== undefined) data.autoTopUpEnabled = !!enabled;
  if (threshold !== undefined) data.autoTopUpThreshold = Number(threshold);
  if (amount !== undefined) data.autoTopUpAmount = Number(amount);

  const updated = await prisma.creditWallet.update({ where: { id: wallet.id }, data });
  return wrapWallet(updated, teamId);
};

/** Everything the customer's wallet widget needs in one call. */
const getWalletSummary = async (teamId) => {
  const [wallet, burn, settings] = await Promise.all([
    getOrCreateWallet(teamId),
    // The split by billing method, not just the total — anything projecting
    // spend forward needs to know which half stops when the balance runs out
    // (prepaid) and which half keeps running and accrues debt (pay-as-you-go).
    require('../deployment/deploymentService').getBurnRateBreakdown(teamId),
    billingModeService.getBillingSettings(),
  ]);
  const burnRate = burn.total;

  const balance = num(wallet.balance);

  const runwayHours = burnRate > 0
    ? Math.max(0, Math.round((balance / burnRate) * 100) / 100)
    : null;

  const runwayDays = runwayHours === null
    ? null
    : Math.max(0, Math.round((runwayHours / 24) * 10) / 10);

  const hoursThreshold = settings.lowBalanceHours || 0;

  const debtService = require('./debtService');
  const debt = await debtService.status(teamId, { settings });

  const cardGateRequired = !!settings.cardGate?.requireVerifiedCard;
  const cardGateVerified = cardGateRequired
    ? await paymentMethodService.hasVerifiedCard(teamId)
    : true;

  return {
    balance,
    spendable: balance,
    outstandingBalance: debt.outstanding,
    debtSince: wallet.debtSince,
    debtDays: debt.debtDays,
    debtBlocked: debt.blocked,
    debtBlockedReason: debt.reason,
    // The admin-set ceilings themselves, not just the pass/fail verdict above —
    // without these the UI can tell a customer THAT they're blocked but not
    // how close to the line they are before that happens. 0 means "off" for
    // that dimension (see debtService.evaluateDebtStatus).
    debtCreditLimit: settings.payg?.creditLimit ?? 0,
    debtMaxDays: settings.payg?.maxDebtDays ?? 0,
    currency: wallet.currency,
    lifetimeTopUp: wallet.lifetimeTopUp,
    lifetimeSpend: wallet.lifetimeSpend,
    burnRatePerHour: burnRate,
    burnRatePerDay: Math.round(burnRate * 24 * 100) / 100,
    burnRateByMethod: { prepaid: burn.prepaid, payg: burn.payg },
    runwayDays,
    runwayHours,
    stopAtBalance: settings.graceBalance || 0,
    isLow: balance <= (settings.lowBalanceThreshold || 0)
      || (hoursThreshold > 0 && runwayHours !== null && runwayHours <= hoursThreshold),
    autoTopUp: wallet.autoTopUp,
    suspendedAt: wallet.suspendedAt,
    cardGate: { required: cardGateRequired, verified: cardGateVerified },
    settings: {
      minTopUp: settings.minTopUp,
      maxTopUp: settings.maxTopUp,
      topUpPresets: settings.topUpPresets,
      lowBalanceThreshold: settings.lowBalanceThreshold,
      graceBalance: settings.graceBalance,
      currency: settings.currency,
    },
  };
};

/**
 * Admin wallet list — `routes/v1/admin/wallets.routes.js`'s `GET /` and
 * `GET /debt`. `debtOnly` restricts to wallets currently carrying an
 * outstanding balance (the receivables view); `search` matches the owning
 * customer's name/email.
 */
const listWalletsAdmin = async ({
  search, debtOnly = false, page = 1, limit = 20, sortBy = 'balance', order = 'desc',
} = {}) => {
  const { skip, take } = paginate({ page, limit });
  const SORT_FIELDS = ['balance', 'outstandingBalance', 'lifetimeTopUp', 'lifetimeSpend', 'debtSince'];
  const orderBy = { [SORT_FIELDS.includes(sortBy) ? sortBy : 'balance']: order === 'asc' ? 'asc' : 'desc' };

  const where = {
    ...(debtOnly ? { outstandingBalance: { gt: 0 } } : {}),
    ...(search ? {
      team: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { createdBy: { email: { contains: search, mode: 'insensitive' } } },
          { createdBy: { name: { contains: search, mode: 'insensitive' } } },
        ],
      },
    } : {}),
  };

  const [rows, total, agg] = await Promise.all([
    prisma.creditWallet.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        team: {
          select: {
            id: true, name: true, kind: true,
            createdBy: { select: { id: true, name: true, email: true, status: true } },
          },
        },
      },
    }),
    prisma.creditWallet.count({ where }),
    prisma.creditWallet.aggregate({
      where: debtOnly ? { outstandingBalance: { gt: 0 } } : {},
      _sum: {
        balance: true, lifetimeTopUp: true, lifetimeSpend: true, outstandingBalance: true,
      },
      _count: { _all: true },
    }),
  ]);

  // `userId` is the account's owner, kept in the shape the admin wallets page
  // already reads; `team` says which account the wallet is.
  const wallets = rows.map((row) => ({
    ...wrapWallet(row, row.team.id),
    team: { id: row.team.id, name: row.team.name, kind: row.team.kind },
    userId: {
      id: row.team.createdBy.id,
      name: row.team.createdBy.name,
      email: row.team.createdBy.email,
      status: row.team.createdBy.status,
    },
  }));

  return {
    wallets,
    total,
    totals: {
      totalBalance: num(agg._sum.balance) || 0,
      totalTopUp: num(agg._sum.lifetimeTopUp) || 0,
      totalSpend: num(agg._sum.lifetimeSpend) || 0,
      totalOutstanding: num(agg._sum.outstandingBalance) || 0,
      count: agg._count._all,
    },
  };
};

/** Revenue/spend totals for the admin analytics dashboard, grouped by transaction type. */
const getTotals = async (startDate, endDate) => {
  const where = {};
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const rows = await prisma.creditTransaction.groupBy({
    by: ['type'], where, _sum: { amount: true }, _count: { _all: true },
  });

  const byType = {};
  rows.forEach((r) => {
    byType[r.type] = { total: Math.round(num(r._sum.amount) * 100) / 100, count: r._count._all };
  });

  return {
    topUps: byType.topup?.total || 0,
    charges: Math.abs(byType.charge?.total || 0),
    bonuses: (byType.bonus?.total || 0) + (byType.signup_credit?.total || 0),
    refunds: byType.refund?.total || 0,
    byType,
  };
};

/** Sum of every ledger row for an account — surfaces drift against the cached wallet balance. */
const reconcileLedger = async (teamId) => {
  const agg = await prisma.creditTransaction.aggregate({
    where: { teamId: byPublicId(teamId).id }, _sum: { amount: true },
  });
  return num(agg._sum.amount) || 0;
};

/** Ledger page for a customer's wallet widget/statement. */
const listTransactions = async (teamId, { page = 1, limit = 20, type } = {}) => {
  const where = { teamId: byPublicId(teamId).id, ...(type ? { type } : {}) };
  const { skip, take } = paginate({ page, limit });

  const [rows, total] = await Promise.all([
    prisma.creditTransaction.findMany({
      where,
      include: { createdBy: { select: { id: true } }, wallet: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.creditTransaction.count({ where }),
  ]);

  const transactions = rows.map((row) => wrapTransaction(row, {
    teamId,
    walletId: row.wallet?.id || null,
    createdById: row.createdBy?.id || null,
  }));

  return { transactions, total };
};

/** jobs/lowBalanceWarning.js: every wallet with something left in it. */
const listWithBalance = async () => {
  const rows = await prisma.creditWallet.findMany({ where: { balance: { gt: 0 } } });
  return rows.map((row) => wrapWallet(row, row.teamId));
};

/**
 * How much of the outstanding balance was paid off during a period.
 *
 * The billing page needs this to answer a question its own numbers were
 * raising and not answering: a statement can say USD 3,542 went onto the
 * outstanding balance this month while the balance itself reads USD 767,
 * and with nothing in between the two look like they contradict each other.
 * They don't — top-ups settle debt first, so the balance came down in the
 * meantime — but the customer has no way to know that from the page.
 *
 * Read from the ledger's own `debtDelta` (negative when debt is settled)
 * rather than inferred from the difference between two balances, so it
 * states what actually happened instead of what must have happened.
 */
const debtMovement = async (teamId, from, to) => {
  const empty = { opening: 0, accrued: 0, settled: 0, closing: 0, settlements: [] };
  const wallet = await prisma.creditWallet.findUnique({ where: { teamId: byPublicId(teamId).id }, select: { id: true } });
  if (!wallet) return empty;

  const [priorRow, rows] = await Promise.all([
    // The balance carried into the period, read off the last row before it
    // rather than inferred by subtraction — a recorded fact, so the opening
    // figure does not depend on the arithmetic it is supposed to anchor.
    prisma.creditTransaction.findFirst({
      where: { walletId: wallet.id, createdAt: { lt: from } },
      orderBy: { createdAt: 'desc' },
      select: { outstandingAfter: true },
    }),
    prisma.creditTransaction.findMany({
      where: { walletId: wallet.id, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true, type: true, description: true, debtDelta: true, outstandingAfter: true,
      },
    }),
  ]);

  const opening = roundMoney(num(priorRow?.outstandingAfter) || 0);

  let accrued = 0;
  let settled = 0;
  const settlements = [];
  for (const row of rows) {
    const delta = num(row.debtDelta);
    if (delta > 0) accrued += delta;
    if (delta < 0) {
      settled += Math.abs(delta);
      // Charges arrive in hundreds of tiny hourly rows and are only useful
      // as a total; payments are a handful of discrete events, and "when did
      // I actually pay this off" is the question the total cannot answer.
      settlements.push({
        at: row.createdAt,
        type: row.type,
        description: row.description || '',
        amount: roundMoney(Math.abs(delta)),
      });
    }
  }

  const lastRow = rows.length ? rows[rows.length - 1] : null;
  return {
    opening,
    accrued: roundMoney(accrued),
    settled: roundMoney(settled),
    closing: lastRow ? roundMoney(num(lastRow.outstandingAfter)) : opening,
    settlements,
  };
};

/**
 * How much of each given top-up went to paying off the outstanding balance,
 * keyed by payment id. The rest of that top-up became spendable balance.
 *
 * Read from the settlement rows that carry the payment's id (see
 * debtService.settleFromWallet), so a receipt can state where its money went
 * instead of only how much it was.
 */
const debtSettledByReference = async (teamId, referenceIds = []) => {
  const result = new Map();
  if (!referenceIds.length) return result;
  const wallet = await prisma.creditWallet.findUnique({ where: { teamId: byPublicId(teamId).id }, select: { id: true } });
  if (!wallet) return result;

  const rows = await prisma.creditTransaction.groupBy({
    by: ['referenceId'],
    where: { walletId: wallet.id, type: 'debt_settlement', referenceId: { in: referenceIds } },
    _sum: { debtDelta: true },
  });
  rows.forEach((r) => result.set(r.referenceId, roundMoney(Math.abs(num(r._sum.debtDelta) || 0))));
  return result;
};

/**
 * Every kind of money that ever entered or left the wallet, summed by ledger
 * type, with the wallet's standing figures — the raw material for a "where
 * did my money go" statement that has to balance to the cent.
 */
const ledgerTotals = async (teamId) => {
  const empty = { byType: {}, balance: 0, outstanding: 0 };
  const wallet = await prisma.creditWallet.findUnique({ where: { teamId: byPublicId(teamId).id } });
  if (!wallet) return empty;

  const rows = await prisma.creditTransaction.groupBy({
    by: ['type'],
    where: { walletId: wallet.id },
    _sum: { amount: true, debtDelta: true },
    _count: true,
  });
  const byType = {};
  rows.forEach((r) => {
    byType[r.type] = {
      amount: roundMoney(num(r._sum.amount) || 0),
      debtDelta: roundMoney(num(r._sum.debtDelta) || 0),
      count: r._count,
    };
  });
  return {
    byType,
    balance: roundMoney(num(wallet.balance) || 0),
    outstanding: roundMoney(num(wallet.outstandingBalance) || 0),
  };
};

/** jobs/debtCollection.js: every wallet currently carrying outstanding debt. */
const listWithDebt = async () => {
  const rows = await prisma.creditWallet.findMany({ where: { outstandingBalance: { gt: 0 } } });
  return rows.map((row) => wrapWallet(row, row.teamId));
};

/**
 * Wallets for many accounts in one query, keyed by team id.
 *
 * For the background jobs, which walk a list of deployments and used to fetch
 * the owner's wallet once per deployment — several times over for an account
 * with more than one. Returns only wallets that already exist; a caller that
 * needs one created still falls back to `getOrCreateWallet`.
 */
const findWalletsFor = async (teamIds = []) => {
  const ids = [...new Set((teamIds || []).filter(Boolean).map(String))];
  const byTeam = new Map();
  if (!ids.length) return byTeam;

  const rows = await prisma.creditWallet.findMany({ where: { teamId: byPublicIds(ids).id } });
  for (const row of rows) {
    byTeam.set(String(row.teamId), wrapWallet(row, row.teamId));
  }
  return byTeam;
};

/**
 * All ledger rows and wallets for a set of accounts — part of the "permanently
 * delete customer" cascade (userDeletionService), which erases a customer's
 * PERSONAL account. `CreditTransaction.teamId`/`.walletId` are `onDelete:
 * Restrict` (a ledger row must never lose its link by accident), so a wallet
 * can only be deleted after its own ledger rows are gone.
 */
const deleteAllForTeams = async (teamIds, db = prisma) => {
  const ids = byPublicIds(teamIds).id.in;
  if (!ids.length) return;

  await db.creditTransaction.deleteMany({ where: { teamId: { in: ids } } });
  await db.creditWallet.deleteMany({ where: { teamId: { in: ids } } });
};

module.exports = {
  getOrCreateWallet,
  affordable,
  topUp,
  charge,
  adjust,
  grantSignupBonus,
  getBurnRate,
  getRunwayDays,
  getWalletSummary,
  markLowBalanceNotified,
  markSuspended,
  updateAutoTopUp,
  deleteAllForTeams,
  listTransactions,
  listWithBalance,
  listWithDebt,
  debtMovement,
  debtSettledByReference,
  ledgerTotals,
  findWalletsFor,
  listWalletsAdmin,
  reconcileLedger,
  findWallet,
  getTotals,
  // Exported for debtService.js's reuse — see its class comment.
  resolveWallet,
  resolveUserDbId,
  toWalletDoc,
  wrapWallet,
  toTransactionDoc,
  wrapTransaction,
};
