/**
 * Statement Service
 *
 * The one answer to "how much of this month's bill has been paid", shared by
 * the billing Overview and the Invoices list so the two can never disagree.
 *
 * ── Why this exists ──
 *
 * A usage row records how a charge was funded AT THE MOMENT it was written:
 * `toWallet` (the balance covered it) and `toDebt` (it went onto the
 * outstanding balance). Summing `toWallet` for a month gives a real number,
 * but it is not "what you paid" — money that went to debt and was paid off
 * by a top-up a week later is paid too, and `toWallet` never sees it.
 *
 * Showing that figure as "Paid from wallet" told a customer who had topped up
 * USD 2,766 to clear their September debt that they had paid USD 343 of a
 * USD 3,958 bill. They had paid USD 3,110. The rest of the page was right; the
 * one number that answered "have I paid this?" was not.
 *
 * ── How a month's share of the debt is worked out ──
 *
 * Debt is one account-level number; it is not tagged with the month that
 * created it. So the current outstanding balance is allocated back across the
 * months that produced debt, newest first — the oldest debt is the first to
 * be paid off when a top-up arrives, so whatever is still unpaid belongs to
 * the most recent months. A month's still-unpaid amount is capped at what that
 * month actually put onto the balance; anything the allocation does not reach
 * has been paid.
 */
const deploymentUsageService = require('../deployment/deploymentUsageService');

const roundMoney = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 10000) / 10000;

const monthStart = (d, offset = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));

/**
 * How one month's bill was settled.
 *
 *   billed        what the month was charged (billed usage only)
 *   paidAtCharge  covered by the wallet balance when each charge was written
 *   paidLater     went onto the outstanding balance and has since been paid off
 *   paid          paidAtCharge + paidLater
 *   stillOwed     this month's share of the current outstanding balance
 *
 * billed = paid + stillOwed, always.
 */
const settle = (summary, stillOwed) => {
  const billed = roundMoney(summary.total);
  const paidAtCharge = roundMoney(summary.paidFromWallet);
  const toDebt = roundMoney(summary.chargedToDebt);
  const owed = roundMoney(Math.min(toDebt, Math.max(stillOwed, 0)));
  return {
    billed,
    paidAtCharge,
    paidLater: roundMoney(toDebt - owed),
    paid: roundMoney(billed - owed),
    stillOwed: owed,
  };
};

/**
 * Month-by-month statements, newest first, each with its settlement.
 *
 * `oldest` stops the walk once it has reached that month — the Overview only
 * needs one month's figures, and a month's share of the debt depends only on
 * the months newer than it, so there is no reason to summarise the older ones.
 * Empty months are returned too; callers that only want billed months filter
 * on `summary.total`.
 */
const monthlyStatements = async (teamId, { outstanding, monthsBack = 12, oldest = null, now = new Date() } = {}) => {
  let unallocated = roundMoney(outstanding);
  const statements = [];

  for (let i = 0; i < monthsBack; i += 1) {
    const from = monthStart(now, -i);
    if (oldest && from < oldest) break;
    const to = monthStart(from, 1);

    const summary = await deploymentUsageService.summariseForTeam(teamId, from, to);
    const settlement = settle(summary, unallocated);
    unallocated = roundMoney(unallocated - settlement.stillOwed);

    statements.push({ from, to, summary, settlement });
  }
  return statements;
};

/**
 * The same settlement for any window — a day, a month, a year.
 *
 * The month walk above allocates the outstanding balance newest month first.
 * For an arbitrary window the equivalent is: charges made AFTER the window
 * claim the outstanding balance first, and only what is left of it can belong
 * to the window. For a calendar month this gives exactly the figure the walk
 * does, so the Overview and the Invoices tab still agree.
 */
const settlementForRange = async (teamId, summary, { outstanding, to, now = new Date() }) => {
  const debtAfter = to < now
    ? await deploymentUsageService.sumChargedToDebt(teamId, to, new Date(now.getTime() + 1))
    : 0;
  return settle(summary, roundMoney(outstanding) - debtAfter);
};

module.exports = { monthlyStatements, settle, settlementForRange };
