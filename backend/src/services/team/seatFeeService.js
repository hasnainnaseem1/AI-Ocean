/**
 * Charging a team for its seats.
 *
 * Off by default. A platform that wants to charge for people sets a monthly
 * fee and how many seats it gives away, and from then on every team pays for
 * the members above that number.
 *
 * ── Why it is billed a day at a time ──
 *
 * One lump on the 1st would mean a member who joins on the 10th is either free
 * for three weeks or charged for days before they existed. So each day carries
 * its own share of the month: seats × fee ÷ days-in-that-month. Somebody who
 * joins today is paid for from today, and somebody removed today stops costing
 * tomorrow. No day is free, and no day is charged twice — the (team, day)
 * unique index in `team_seat_charges` is what makes the second attempt at a day
 * do nothing at all, whether it comes from a retry, a restart or an admin
 * running the job by hand.
 *
 * ── What the wallet cannot cover ──
 *
 * Becomes debt on the account, exactly as unpaid usage does. A seat fee is
 * money the platform is owed, and an account that cannot pay it today still
 * owes it; the existing debt limit, collection and enforcement then apply
 * without this file needing to know about any of them.
 */
const prisma = require('../../lib/prismaClient');
const teamSettingsService = require('./teamSettingsService');

const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

/** Midnight UTC of the day this instant falls in — the key a charge is filed under. */
const dayKey = (now = new Date()) => new Date(Date.UTC(
  now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
));

const daysInMonth = (date) => new Date(Date.UTC(
  date.getUTCFullYear(), date.getUTCMonth() + 1, 0,
)).getUTCDate();

/**
 * What one team owes for one day, given the settings in force.
 *
 * Kept separate from the charging so it can be read straight out of a test, and
 * so the admin screen can show what a team will be billed without billing it.
 */
const dailyAmount = ({ members, freeSeats, monthlyFee, day }) => {
  const billable = Math.max(0, members - Math.max(0, freeSeats));
  if (!billable || !(monthlyFee > 0)) {
    return { seats: billable, amount: 0 };
  }
  return { seats: billable, amount: round4((billable * monthlyFee) / daysInMonth(day)) };
};

/**
 * Bill one team for one day. Returns what happened, and never throws for a
 * reason the caller should not care about — a team that owes nothing today is
 * a normal outcome, not a failure.
 */
const chargeTeamForDay = async (team, { settings, now = new Date() } = {}) => {
  const conf = settings || await teamSettingsService.getTeamSettings();
  if (!conf.seatFeeEnabled || !(conf.seatFeeMonthly > 0)) return { skipped: 'disabled' };

  const day = dayKey(now);
  const already = await prisma.teamSeatCharge.findUnique({
    where: { teamId_day: { teamId: team.id, day } },
    select: { id: true },
  });
  if (already) return { skipped: 'already_charged' };

  const members = await prisma.teamMember.count({ where: { teamId: team.id } });
  const { seats, amount } = dailyAmount({
    members,
    freeSeats: conf.seatFeeFreeSeats,
    monthlyFee: conf.seatFeeMonthly,
    day,
  });
  if (amount <= 0) return { skipped: 'nothing_to_charge', seats };

  const creditService = require('../billing/creditService');
  const debtService = require('../billing/debtService');
  const billingModeService = require('../billing/billingModeService');
  const billing = await billingModeService.getBillingSettings();
  const currency = billing.currency || 'USD';

  /*
   * Claim the day BEFORE taking any money. If two runs overlap, the second one
   * loses here — on a unique index, not on a check it made a moment earlier —
   * and stops before it can charge the same day again.
   */
  let claim;
  try {
    claim = await prisma.teamSeatCharge.create({
      data: {
        teamId: team.id,
        day,
        seats,
        freeSeats: Math.max(0, conf.seatFeeFreeSeats),
        monthlyFee: conf.seatFeeMonthly,
        amount,
        currency,
      },
      select: { id: true },
    });
  } catch (error) {
    if (error.code === 'P2002') return { skipped: 'already_charged' };
    throw error;
  }

  const description = `Seat fee — ${seats} paid seat(s) of ${members} member(s), `
    + `${day.toISOString().slice(0, 10)}`;

  // What the wallet can take, and what it cannot.
  const { available } = await creditService.affordable(team.id, 0);
  const toWallet = round4(Math.min(amount, Math.max(0, available)));
  const toDebt = round4(amount - toWallet);

  if (toWallet > 0) {
    await creditService.charge(team.id, toWallet, {
      // `system` is the platform charging its own fee — the ledger's source
      // enum names who moved the money, and the description below says what
      // for. A new enum value would need a migration to say no more than this.
      source: 'system',
      description,
      metadata: {
        kind: 'seat_fee',
        seats,
        members,
        day: day.toISOString().slice(0, 10),
        monthlyFee: conf.seatFeeMonthly,
      },
    });
  }
  if (toDebt > 0) {
    await debtService.accrue(team.id, toDebt, {
      source: 'system',
      description,
      metadata: {
        kind: 'seat_fee', seats, members, day: day.toISOString().slice(0, 10),
      },
    });
  }

  await prisma.teamSeatCharge.update({
    where: { id: claim.id },
    data: { toWallet, toDebt },
  });

  return {
    charged: true, seats, members, amount, toWallet, toDebt, currency,
  };
};

/**
 * One pass over every live team. Called by the daily job, and safe to call
 * again: a team already charged for today is left alone.
 *
 * One team's failure never stops the rest — an account whose charge could not
 * be recorded is logged and picked up on the next run, because its day was
 * never marked as settled.
 */
const runDaily = async (now = new Date()) => {
  const settings = await teamSettingsService.getTeamSettings();
  const summary = {
    teams: 0, charged: 0, amount: 0, toDebt: 0, failed: 0,
  };
  if (!settings.seatFeeEnabled || !(settings.seatFeeMonthly > 0)) return { ...summary, disabled: true };

  const teams = await prisma.team.findMany({
    where: { kind: 'team', deletedAt: null },
    select: { id: true, name: true },
  });

  for (const team of teams) {
    summary.teams += 1;
    try {
      const result = await chargeTeamForDay(team, { settings, now });
      if (result.charged) {
        summary.charged += 1;
        summary.amount = round4(summary.amount + result.amount);
        summary.toDebt = round4(summary.toDebt + result.toDebt);
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`[SeatFee] ${team.name} (${team.id}) could not be charged:`, error.message);
    }
  }

  console.log(`[SeatFee] ${summary.charged}/${summary.teams} teams charged, `
    + `${summary.amount} total (${summary.toDebt} to debt), ${summary.failed} failed`);
  return summary;
};

/** What a team is paying now, for the admin screen — read-only. */
const preview = async (teamId, { now = new Date() } = {}) => {
  const settings = await teamSettingsService.getTeamSettings();
  const members = await prisma.teamMember.count({ where: { teamId } });
  const day = dayKey(now);
  const { seats, amount } = dailyAmount({
    members,
    freeSeats: settings.seatFeeFreeSeats,
    monthlyFee: settings.seatFeeMonthly,
    day,
  });
  const charged = await prisma.teamSeatCharge.findUnique({
    where: { teamId_day: { teamId, day } },
    select: { amount: true, toWallet: true, toDebt: true },
  });
  return {
    enabled: !!settings.seatFeeEnabled && settings.seatFeeMonthly > 0,
    monthlyFee: settings.seatFeeMonthly,
    freeSeats: settings.seatFeeFreeSeats,
    members,
    paidSeats: seats,
    perDay: amount,
    perMonth: round4(seats * settings.seatFeeMonthly),
    chargedToday: charged ? Number(charged.amount) : null,
  };
};

module.exports = {
  dayKey, daysInMonth, dailyAmount, chargeTeamForDay, runDaily, preview,
};
