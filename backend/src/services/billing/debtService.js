/**
 * Debt Service
 *
 * The ONLY place `CreditWallet.outstandingBalance` is allowed to change —
 * mirroring the rule creditService.js states for `balance`. Two operations
 * touch `wallet.balance` as well as `outstandingBalance` (`settleFromWallet`)
 * — and for exactly that reason this is the other file (besides
 * creditService.js) allowed to write `wallet.balance` directly, reusing
 * creditService's internal `resolveWallet`/doc-builders/mirror helpers
 * rather than duplicating them. Every write here goes through a real
 * `prisma.$transaction`, same as creditService — the wallet update and its
 * ledger row commit atomically.
 */
const prisma = require('../../lib/prismaClient');
const creditService = require('./creditService');
const billingModeService = require('./billingModeService');

const {
  resolveWallet, resolveUserDbId, wrapWallet, wrapTransaction,
} = creditService;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
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

/**
 * ── Is this customer's debt within the platform's limits? ──
 *
 * Pure by construction — given the numbers, it returns a decision, with no
 * database read inside it.
 */
const evaluateDebtStatus = ({ outstanding, debtSince, now, creditLimit, maxDebtDays }) => {
  const owed = roundMoney(outstanding || 0);

  if (owed <= 0) {
    return {
      outstanding: 0, debtDays: 0, overCreditLimit: false, overDayLimit: false,
      blocked: false, reason: null,
    };
  }

  const debtDays = debtSince
    ? Math.max(0, Math.floor((now.getTime() - new Date(debtSince).getTime()) / MS_PER_DAY))
    : 0;

  const overCreditLimit = creditLimit > 0 && owed > creditLimit;
  const overDayLimit = maxDebtDays > 0 && debtDays > maxDebtDays;

  return {
    outstanding: owed,
    debtDays,
    overCreditLimit,
    overDayLimit,
    blocked: overCreditLimit || overDayLimit,
    reason: overCreditLimit ? 'CREDIT_LIMIT_EXCEEDED' : overDayLimit ? 'DEBT_TOO_OLD' : null,
  };
};

/**
 * Record usage the wallet could not cover as debt.
 *
 * Debt and idle spendable balance must never coexist, so this sweeps
 * whatever the wallet is currently holding into the new debt before
 * returning (via `settleFromWallet`) — a guarantee this function enforces
 * itself rather than relying on every caller to arrange it first.
 */
const accrue = async (teamId, amount, meta = {}) => {
  const owed = roundMoney(amount);
  if (!owed || owed <= 0) {
    throw new Error('Debt amount must be greater than zero');
  }

  const { row: wallet, pgTeamId } = await resolveWallet(teamId);
  // The member whose deployment ran up this debt, when known (the ledger row's
  // `userId`); it is always the account's debt, never theirs personally.
  const actorId = meta.actorUserId ? await resolveUserDbId(meta.actorUserId) : null;

  const wasZero = num(wallet.outstandingBalance || 0) <= 0;
  const outstandingBalance = roundMoney(num(wallet.outstandingBalance || 0) + owed);
  const debtSince = wasZero ? new Date() : wallet.debtSince;
  const [updatedWallet, transaction] = await prisma.$transaction([
    prisma.creditWallet.update({ where: { id: wallet.id }, data: { outstandingBalance, debtSince } }),
    prisma.creditTransaction.create({
      data: {
        teamId: pgTeamId,
        userId: actorId,
        walletId: wallet.id,
        type: 'debt_accrual',
        amount: 0, // wallet.balance is untouched here — see the class comment on the model
        balanceAfter: num(wallet.balance),
        debtDelta: owed,
        outstandingAfter: outstandingBalance,
        currency: wallet.currency,
        source: meta.source || 'system',
        referenceId: meta.referenceId || null,
        referenceModel: meta.referenceModel || null,
        description: meta.description || `Usage of ${owed} could not be covered by the wallet balance`,
        metadata: meta.metadata || {},
      },
    }),
  ]);

  const ctx = { walletId: updatedWallet.id, teamId };

  // Self-healing sweep — see the doc comment above.
  const settlement = await settleFromWallet(teamId);

  return {
    wallet: settlement.wallet,
    transaction: wrapTransaction(transaction, ctx),
    settledImmediately: settlement.settled,
  };
};

/**
 * Pay down debt from whatever is sitting in the wallet right now.
 *
 * Called at the end of every top-up (see creditService.topUp). Also safe to
 * call any other time — no-op if there is no debt or no balance to settle it
 * with.
 */
const settleFromWallet = async (teamId, reference = {}) => {
  const { row: wallet, pgTeamId } = await resolveWallet(teamId);
  const outstanding = num(wallet.outstandingBalance || 0);
  const balance = num(wallet.balance);

  if (outstanding <= 0 || balance <= 0) {
    return { settled: 0, wallet: wrapWallet(wallet, teamId) };
  }

  const settled = roundMoney(Math.min(balance, outstanding));
  if (settled <= 0) return { settled: 0, wallet: wrapWallet(wallet, teamId) };

  const newBalance = roundMoney(balance - settled);
  const newLifetimeSpend = roundMoney(num(wallet.lifetimeSpend || 0) + settled);
  let newOutstanding = roundMoney(outstanding - settled);
  let debtSince = wallet.debtSince;
  let debtNotifiedAt = wallet.debtNotifiedAt;
  if (newOutstanding <= 0) {
    newOutstanding = 0;
    debtSince = null;
    debtNotifiedAt = null;
  }

  const [updatedWallet, transaction] = await prisma.$transaction([
    prisma.creditWallet.update({
      where: { id: wallet.id },
      data: {
        balance: newBalance, lifetimeSpend: newLifetimeSpend, outstandingBalance: newOutstanding, debtSince, debtNotifiedAt,
      },
    }),
    prisma.creditTransaction.create({
      data: {
        teamId: pgTeamId,
        walletId: wallet.id,
        type: 'debt_settlement',
        amount: -settled, // this one genuinely left the spendable balance
        balanceAfter: newBalance,
        debtDelta: -settled,
        outstandingAfter: newOutstanding,
        currency: wallet.currency,
        source: 'system',
        // The top-up that paid it, when there is one — so a receipt can say
        // how much of it went to debt and how much became spendable balance.
        // Without the link the settlement row stood alone in the ledger and
        // the receipt could only show the total.
        referenceId: reference.referenceId || null,
        referenceModel: reference.referenceModel || null,
        description: `Outstanding balance settled from top-up: ${settled}`,
        metadata: {},
      },
    }),
  ]);

  const ctx = { walletId: updatedWallet.id, teamId };

  return { settled, wallet: wrapWallet(updatedWallet, teamId), transaction: wrapTransaction(transaction, ctx) };
};

/**
 * Pay down debt by charging the customer's saved card directly. Unlike
 * `settleFromWallet`, `wallet.balance` is never touched — the money never
 * passed through the wallet, so this cannot be "spendable balance
 * decreasing", only debt decreasing.
 */
const settleFromCard = async (teamId, amount, meta = {}) => {
  const { row: wallet, pgTeamId } = await resolveWallet(teamId);
  const outstanding = num(wallet.outstandingBalance || 0);

  if (outstanding <= 0) return { settled: 0, wallet: wrapWallet(wallet, teamId) };

  const toCharge = roundMoney(Math.min(amount, outstanding));
  if (toCharge <= 0) return { settled: 0, wallet: wrapWallet(wallet, teamId) };

  const paymentMethodService = require('./paymentMethodService');

  let chargeResult;
  try {
    chargeResult = await paymentMethodService.chargeOffSession(teamId, toCharge, {
      currency: wallet.currency,
      description: meta.description || 'Outstanding balance settlement',
      metadata: meta.metadata || {},
    });
  } catch (err) {
    await prisma.creditWallet.update({
      where: { id: wallet.id },
      data: {
        autoChargeFailures: (wallet.autoChargeFailures || 0) + 1,
        lastAutoChargeError: err.message,
        lastAutoChargeAt: new Date(),
      },
    });
    throw err;
  }

  let newOutstanding = roundMoney(outstanding - toCharge);
  let debtSince = wallet.debtSince;
  let debtNotifiedAt = wallet.debtNotifiedAt;
  if (newOutstanding <= 0) {
    newOutstanding = 0;
    debtSince = null;
    debtNotifiedAt = null;
  }

  const [updatedWallet, transaction] = await prisma.$transaction([
    prisma.creditWallet.update({
      where: { id: wallet.id },
      data: {
        outstandingBalance: newOutstanding,
        lifetimeSpend: roundMoney(num(wallet.lifetimeSpend || 0) + toCharge),
        lastAutoChargeAt: new Date(),
        autoChargeFailures: 0,
        lastAutoChargeError: '',
        debtSince,
        debtNotifiedAt,
      },
    }),
    prisma.creditTransaction.create({
      data: {
        teamId: pgTeamId,
        walletId: wallet.id,
        type: 'debt_settlement',
        amount: 0, // wallet.balance never held this money — see the class comment
        balanceAfter: num(wallet.balance),
        debtDelta: -toCharge,
        outstandingAfter: newOutstanding,
        currency: wallet.currency,
        source: chargeResult.gateway || 'stripe',
        description: meta.description || `Card charge settled ${toCharge} of outstanding balance`,
        metadata: { paymentIntentId: chargeResult.paymentIntentId, ...(meta.metadata || {}) },
      },
    }),
  ]);

  const ctx = { walletId: updatedWallet.id, teamId };

  return { settled: toCharge, wallet: wrapWallet(updatedWallet, teamId), transaction: wrapTransaction(transaction, ctx) };
};

/**
 * Erase a customer's outstanding balance without collecting it. Requires a
 * reason and records who did it — the only place debt is ever forgiven on
 * this platform.
 */
const writeOff = async (teamId, { reason, actor } = {}) => {
  if (!reason || !reason.trim()) {
    throw new Error('A reason is required to write off a debt');
  }

  const { row: wallet, pgTeamId } = await resolveWallet(teamId);
  const written = roundMoney(num(wallet.outstandingBalance || 0));
  if (written <= 0) {
    return { written: 0, wallet: wrapWallet(wallet, teamId) };
  }

  const actorDbId = await resolveUserDbId(actor?.id);
  const [updatedWallet, transaction] = await prisma.$transaction([
    prisma.creditWallet.update({
      where: { id: wallet.id },
      data: { outstandingBalance: 0, debtSince: null, debtNotifiedAt: null },
    }),
    prisma.creditTransaction.create({
      data: {
        teamId: pgTeamId,
        walletId: wallet.id,
        type: 'debt_writeoff',
        amount: 0, // wallet.balance is untouched — the money was never collected
        balanceAfter: num(wallet.balance),
        debtDelta: -written,
        outstandingAfter: 0,
        currency: wallet.currency,
        source: 'admin',
        createdById: actorDbId,
        description: `Outstanding balance of ${written} written off by ${actor?.name || 'an admin'}: ${reason.trim()}`,
        metadata: { reason: reason.trim() },
      },
    }),
  ]);

  const ctx = { walletId: updatedWallet.id, teamId, createdById: actor?.id || null };

  return { written, wallet: wrapWallet(updatedWallet, teamId), transaction: wrapTransaction(transaction, ctx) };
};

/**
 * Everything a caller needs to decide "can this customer keep using
 * pay-as-you-go right now?" — see evaluateDebtStatus for the actual rule.
 */
const status = async (teamId, options = {}) => {
  const wallet = await creditService.getOrCreateWallet(teamId);
  const settings = options.settings || (await billingModeService.getBillingSettings());

  return evaluateDebtStatus({
    outstanding: num(wallet.outstandingBalance || 0),
    debtSince: wallet.debtSince,
    now: options.now || new Date(),
    creditLimit: settings.payg?.creditLimit ?? 0,
    maxDebtDays: settings.payg?.maxDebtDays ?? 0,
  });
};

module.exports = {
  accrue,
  settleFromWallet,
  settleFromCard,
  writeOff,
  status,
  // Exported purely for testing — see the doc comment above its definition.
  evaluateDebtStatus,
};
