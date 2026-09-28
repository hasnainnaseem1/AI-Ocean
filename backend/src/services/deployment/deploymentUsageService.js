/**
 * DeploymentUsage — one hourly billing tick, written by
 * services/billing/deploymentBilling.js and read back by the customer's usage
 * chart and the admin deployment detail page.
 *
 * Kept as its own leaf module (no dependency on deploymentService.js) so
 * deploymentBilling.js can create usage rows without creating a require cycle
 * — deploymentService.js depends on deploymentBilling.js for billOutstanding,
 * so the reverse dependency can't exist.
 */
const prisma = require('../../lib/prismaClient');
const { pgId } = require('./pgLookup');
const { byPublicId } = require('../../utils/helpers/publicId');
const {
  BILLABLE_STATUSES, STORAGE_BILLABLE_STATUSES, currentRateFor,
} = require('./deploymentConstants');

const num = (d) => (d === null || d === undefined ? 0 : (typeof d === 'object' && d.toNumber ? d.toNumber() : Number(d)));
const round4 = (n) => Math.round(n * 10000) / 10000;
// Four decimals, matching the Decimal(12,4) columns these figures are summed
// from — see the note on roundMoney in services/billing/creditService.js.
const roundMoney = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const MS_PER_HOUR = 60 * 60 * 1000;

/** The shape a usage row takes in an API response. */
const toUsageDoc = (row, ctx) => ({
  id: row.id,
  deploymentId: ctx.deploymentLegacyId,
  teamId: row.teamId,
  userId: ctx.userId,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  kind: row.kind,
  status: row.status,
  hours: num(row.hours),
  rate: num(row.rate),
  amount: num(row.amount),
  currency: row.currency,
  toWallet: num(row.toWallet),
  toDebt: num(row.toDebt),
  transactionId: ctx.transactionId || null,
  debtTransactionId: ctx.debtTransactionId || null,
  charged: row.charged,
  createdAt: row.createdAt,
});

/**
 * Record one billing tick. Mirrors `DeploymentUsage.create(...)` — the return
 * value is never used by callers (deploymentBilling.js fires and forgets it),
 * so this doesn't bother wrapping/returning a full document.
 */
const create = async (data) => {
  const [deploymentPgId, teamPgId, userPgId, transactionPgId, debtTransactionPgId] = await Promise.all([
    pgId(prisma.deployment, data.deploymentId),
    pgId(prisma.team, data.teamId),
    pgId(prisma.user, data.userId),
    pgId(prisma.creditTransaction, data.transactionId),
    pgId(prisma.creditTransaction, data.debtTransactionId),
  ]);

  const row = await prisma.deploymentUsage.create({
    data: {
      deploymentId: deploymentPgId,
      teamId: teamPgId,
      userId: userPgId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      kind: data.kind,
      status: data.status || '',
      hours: data.hours,
      rate: data.rate,
      amount: data.amount,
      currency: data.currency || 'USD',
      toWallet: data.toWallet || 0,
      toDebt: data.toDebt || 0,
      transactionId: transactionPgId,
      debtTransactionId: debtTransactionPgId,
      charged: data.charged !== false,
    },
  });

  return row;
};

/** Daily cost trend for one deployment — powers the usage chart. */
const getDailyTrend = async (deploymentLegacyId, days = 30) => {
  const deploymentPgId = await pgId(prisma.deployment, deploymentLegacyId);
  if (!deploymentPgId) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const rows = await prisma.deploymentUsage.findMany({
    where: { deploymentId: deploymentPgId, createdAt: { gte: startDate } },
    select: { periodStart: true, hours: true, amount: true },
  });

  const byDate = new Map();
  for (const row of rows) {
    const date = row.periodStart.toISOString().slice(0, 10);
    const entry = byDate.get(date) || { date, hours: 0, amount: 0 };
    entry.hours += num(row.hours);
    entry.amount += num(row.amount);
    byDate.set(date, entry);
  }

  return [...byDate.values()]
    .map((e) => ({ date: e.date, hours: round4(e.hours), amount: Math.round(e.amount * 100) / 100 }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
};

/** Most recent usage rows for a deployment — powers the "recent charges" list. */
const listRecent = async (deploymentLegacyId, limit = 50) => {
  const deploymentPgId = await pgId(prisma.deployment, deploymentLegacyId);
  if (!deploymentPgId) return [];

  const rows = await prisma.deploymentUsage.findMany({
    where: { deploymentId: deploymentPgId },
    orderBy: { periodStart: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true } },
      transaction: { select: { id: true } },
      debtTransaction: { select: { id: true } },
    },
  });

  return rows.map((row) => toUsageDoc(row, {
    deploymentLegacyId,
    userId: row.user?.id || null,
    transactionId: row.transaction?.id || null,
    debtTransactionId: row.debtTransaction?.id || null,
  }));
};

/**
 * What a customer was actually charged this period, per deployment, split by
 * what the charge was *for*.
 *
 * This exists because the billing page used to work the split out for itself by
 * dividing a deployment's cost by its hourly rate — which is only correct if
 * every charge was compute at the running rate. It is not: a *stopped*
 * deployment keeps being charged for its storage, at a much lower rate. On the
 * account that surfaced this, the page reported "7.5 hours at USD 2.39/hr" for
 * a machine that had run for **zero** hours that month and had actually
 * accrued 72.3 hours of storage at USD 0.246/hr. Same total, entirely wrong
 * story — and no hint anywhere that stopped deployments cost money at all.
 *
 * `DeploymentUsage` already records `kind`, `hours`, `rate` and `amount` per
 * tick, so the truth only needed to be read rather than inferred. Summed here
 * rather than in the client so there is one answer to "what did this cost me",
 * and so the client cannot drift from it.
 *
 * ── Billed, versus actually used ──
 *
 * Everything summed here comes from `DeploymentUsage` rows, and those only
 * exist once the hourly billing job has written them. So every figure is
 * "billed so far", never "used so far", and the gap between the two is exactly
 * what made this page read as broken. Two machines, both running, side by
 * side: one started at 12:51 showing 0.1449h because the job last ran at
 * 13:00, next to one started half an hour later showing 0.2248h because
 * stopping it briefly settled its bill on the spot. Both numbers were correct
 * and the page gave no way to know that — it looked like the newer deployment
 * had somehow run longer than the older one.
 *
 * With `includeAccruing`, each still-billable deployment also reports the time
 * since its `lastBilledAt` watermark, priced at the rate currently in force,
 * and a deployment that has not been billed even once yet appears at all
 * rather than silently missing from the page for its first hour.
 *
 * That figure is an estimate by nature — the charge does not exist until the
 * job writes it — so it is returned as its own `unbilled` field and is kept
 * strictly out of `total`, which has to keep meaning "money actually taken".
 *
 * @param {string} teamId  the account
 * @param {Date} from  start of the period (inclusive)
 * @param {Date} to    end of the period (exclusive)
 * @param {object}  [options]
 * @param {boolean} [options.includeAccruing]  also report un-billed time
 * @param {Date}    [options.asOf]             count un-billed time up to here
 */
const summariseForTeam = async (teamId, from, to, options = {}) => {
  const includeAccruing = options.includeAccruing === true;
  const asOf = options.asOf ? new Date(options.asOf) : new Date();

  const [ticks, liveRows] = await Promise.all([
    /*
     * Every tick that OVERLAPS the period — not every tick that ends inside it.
     *
     * A tick covers a stretch of time, and the billing job does not always run
     * hourly: after a gap it writes one tick spanning everything it missed. One
     * real tick here ran from 08 Sep 14:00 to 09 Sep 10:00. Selecting by end
     * date put all of it on the 9th; for a month that was a rounding-sized
     * error at the edges, but the page can now be filtered to a single day,
     * where it would move most of one day's bill onto the next.
     *
     * So each tick counts toward a period by exactly the fraction of its time
     * that falls inside it, and the same split feeds the totals, the funding
     * split and the day-by-day breakdown — they cannot disagree.
     */
    prisma.deploymentUsage.findMany({
      where: {
        teamId, charged: true, periodStart: { lt: to }, periodEnd: { gte: from },
      },
      select: {
        deploymentId: true,
        periodStart: true,
        periodEnd: true,
        kind: true,
        hours: true,
        amount: true,
        rate: true,
        toWallet: true,
        toDebt: true,
      },
      orderBy: { periodEnd: 'asc' },
    }),
    /*
     * Everything of this customer's that is on the clock right now — running
     * (compute) or merely holding its disk (storage). Fetched even when it has
     * no usage rows yet, which is the whole point: a deployment in its first
     * hour has been charged nothing and would otherwise not appear on the page
     * at all, despite visibly costing money.
     */
    includeAccruing
      ? prisma.deployment.findMany({
        where: {
          teamId: byPublicId(teamId).id,
          status: { in: [...BILLABLE_STATUSES, ...STORAGE_BILLABLE_STATUSES] },
        },
        select: {
          id: true, deploymentName: true, status: true, modelName: true, tierName: true,
          lastBilledAt: true, startedAt: true,
          pricePerHour: true, stoppedPricePerHour: true, planDiscountPercent: true,
        },
      })
      : Promise.resolve([]),
  ]);

  const empty = {
    total: 0,
    running: { hours: 0, cost: 0 },
    storage: { hours: 0, cost: 0 },
    unbilled: { hours: 0, cost: 0, asOf },
    paidFromWallet: 0,
    chargedToDebt: 0,
    deployments: [],
  };
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  /*
   * The fraction of a tick that falls inside this period. A zero-length tick
   * (a charge settled at the same instant it was raised) has no duration to
   * divide, so it belongs wholly to the period its end falls in — the query's
   * bounds guarantee that is exactly one period.
   */
  const shareOf = (startMs, endMs) => {
    const span = endMs - startMs;
    if (span <= 0) return endMs >= fromMs && endMs < toMs ? 1 : 0;
    return Math.max(0, Math.min(endMs, toMs) - Math.max(startMs, fromMs)) / span;
  };

  const rows = ticks.filter((tk) => shareOf(tk.periodStart.getTime(), tk.periodEnd.getTime()) > 0);
  if (!rows.length && !liveRows.length) return empty;

  const deployments = rows.length
    ? await prisma.deployment.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.deploymentId))] } },
      select: {
        id: true,
        deploymentName: true,
        status: true,
        modelName: true,
        tierName: true,
        pricePerHour: true,
        stoppedPricePerHour: true,
        tierIsCustom: true,
        tier: { select: { pricingMode: true } },
      },
    })
    : [];
  const byId = new Map(deployments.map((d) => [d.id, d]));

  /*
   * ── The disk inside the running rate ──
   *
   * A machine's disk is charged every hour it exists, not only while it is
   * paused. On a component-priced tier the running rate is the sum of every
   * part — GPU, CPU, RAM, network AND the disk — and the paused rate is just
   * the parts billed while stopped, which is the disk. So USD 1.469/hr running
   * is USD 1.346 of compute plus the same USD 0.123 of disk the machine pays
   * when paused.
   *
   * Reporting the whole running charge as "compute" made the disk look free
   * while the machine ran — a column of dashes under "Disk storage" for every
   * running day — when it was in fact charged all along, just inside another
   * number. So a running charge is split by the deployment's own frozen rates:
   * the paused-rate share of it is disk, the rest is compute. Nothing is added
   * or removed — the two parts sum to exactly what was charged.
   *
   * Only where that relationship is guaranteed: a component-priced or custom
   * build. A flat-priced tier's two rates are typed independently by an
   * admin, so its running charge stays whole.
   */
  const diskShare = new Map(deployments.map((d) => {
    const running = num(d.pricePerHour);
    const paused = num(d.stoppedPricePerHour);
    const componentPriced = d.tierIsCustom || d.tier?.pricingMode === 'components';
    return [d.id, componentPriced && running > 0 && paused > 0 && paused < running ? paused / running : 0];
  }));

  const blank = () => ({ hours: 0, cost: 0, rate: 0 });
  /*
   * How the period's charges were actually funded. The split is what makes a
   * usage statement's paid/unpaid status real: a statement is only settled if
   * the wallet covered all of it, and the part that went to the outstanding
   * balance is still owed.
   */
  let paidFromWallet = 0;
  let chargedToDebt = 0;
  const perDeployment = new Map();

  /**
   * One row of the "spend by deployment" table. Created on demand from either
   * source — a billed usage row, or a still-running deployment that has not
   * been billed yet — so a machine only ever gets one row no matter which of
   * the two found it first.
   */
  const entryFor = (deploymentId, d) => {
    if (!perDeployment.has(deploymentId)) {
      perDeployment.set(deploymentId, {
        deploymentId,
        name: d?.deploymentName || 'Removed deployment',
        model: d?.modelName || null,
        tier: d?.tierName || null,
        status: d?.status || null,
        running: blank(),
        storage: blank(),
        total: 0,
        unbilled: null,
        daily: [],
      });
    }
    return perDeployment.get(deploymentId);
  };

  /*
   * Split every tick across the days it actually covers, pro rata by time, so
   * a day's line means "this is what that day cost" and no single machine can
   * ever show more than 24 hours in one day.
   *
   * Whole-day slices are the common case and cost nothing to compute; only a
   * tick that straddles midnight is divided, and it is divided by elapsed time
   * rather than being assigned wholesale to either end.
   */
  const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const dayIndex = new Map();

  const dayBucket = (entry, date) => {
    const key = `${entry.deploymentId}|${date}`;
    if (!dayIndex.has(key)) {
      const day = {
        date, running: blank(), storage: blank(), total: 0,
      };
      dayIndex.set(key, day);
      entry.daily.push(day);
    }
    return dayIndex.get(key);
  };

  for (const tick of rows) {
    const entry = entryFor(tick.deploymentId, byId.get(tick.deploymentId));
    const startMs = tick.periodStart.getTime();
    const endMs = tick.periodEnd.getTime();
    const span = endMs - startMs;
    const hours = num(tick.hours);
    const amount = num(tick.amount);
    const rate = num(tick.rate);
    const isStorage = tick.kind === 'storage';

    // How much of a running charge was the disk (see diskShare above). A
    // storage tick is all disk already.
    const disk = isStorage ? 1 : (diskShare.get(tick.deploymentId) || 0);

    // Books `fraction` of this tick into a compute/disk pair: the disk part
    // carries the tick's full hours (the disk existed for all of them) at
    // the disk's own rate, and compute gets the remainder.
    const book = (target, fraction) => {
      if (disk < 1) {
        target.running.hours += hours * fraction;
        target.running.cost += amount * fraction * (1 - disk);
        target.running.rate = Math.max(target.running.rate, rate * (1 - disk));
      }
      if (disk > 0) {
        target.storage.hours += hours * fraction;
        target.storage.cost += amount * fraction * disk;
        target.storage.rate = Math.max(target.storage.rate, rate * disk);
      }
    };

    // This period's share of the tick — its hours, its money, and the same
    // share of how that money was funded.
    const share = shareOf(startMs, endMs);
    book(entry, share);
    paidFromWallet += num(tick.toWallet) * share;
    chargedToDebt += num(tick.toDebt) * share;

    const addToDay = (atMs, fraction) => book(dayBucket(entry, dayKey(atMs)), fraction);

    if (span <= 0) {
      addToDay(endMs, 1);
      continue;
    }

    // Walk only the part of the tick inside the period, a day at a time.
    const lo = Math.max(startMs, fromMs);
    const hi = Math.min(endMs, toMs);
    const loDate = new Date(lo);
    let cursor = Date.UTC(loDate.getUTCFullYear(), loDate.getUTCMonth(), loDate.getUTCDate());
    while (cursor < hi) {
      const next = cursor + MS_PER_DAY;
      const overlap = Math.min(next, hi) - Math.max(cursor, lo);
      if (overlap > 0) addToDay(Math.max(cursor, lo), overlap / span);
      cursor = next;
    }
  }

  // Rounded once, after every share is in — rounding on each addition would
  // take the error once per tick instead of once per figure.
  for (const entry of perDeployment.values()) {
    for (const part of [entry.running, entry.storage]) {
      part.hours = round4(part.hours);
      part.cost = round4(part.cost);
    }
    entry.total = round4(entry.running.cost + entry.storage.cost);
    for (const day of entry.daily) {
      for (const part of [day.running, day.storage]) {
        part.hours = round4(part.hours);
        part.cost = round4(part.cost);
      }
      day.total = round4(day.running.cost + day.storage.cost);
    }
  }

  /*
   * ── Time on the clock that has not been billed yet ──
   *
   * `lastBilledAt` is the watermark everything before which is paid for, so the
   * stretch between it and now is precisely what a customer has used and not
   * yet been charged for. Priced at the rate in force for the current status —
   * compute while running, storage while paused or stopped — which is the same
   * rate deploymentBilling will use when the job next runs.
   *
   * Clamped to the requested period at both ends: a deployment running since
   * last month has not accrued this month's bill since last month, and a
   * historical month must not pick up time from after it ended.
   */
  for (const d of liveRows) {
    const since = d.lastBilledAt || d.startedAt;
    if (!since) continue;

    const rate = currentRateFor(d);
    const startMs = Math.max(new Date(since).getTime(), from.getTime());
    const endMs = Math.min(asOf.getTime(), to.getTime());
    const hours = (endMs - startMs) / MS_PER_HOUR;
    if (!(hours > 0)) continue;

    const entry = entryFor(d.id, d);
    entry.status = d.status;
    entry.unbilled = {
      kind: BILLABLE_STATUSES.includes(d.status) ? 'running' : 'storage',
      hours: round4(hours),
      rate,
      cost: roundMoney(rate * hours),
      since: new Date(startMs),
    };
  }

  // Ordered by what the deployment is costing in total, billed or not —
  // otherwise a machine in its first un-billed hour sorts to the bottom of the
  // page however expensive it is.
  const weight = (d) => d.total + (d.unbilled?.cost || 0);
  const list = [...perDeployment.values()].sort((a, b) => weight(b) - weight(a));
  list.forEach((d) => d.daily.sort((a, b) => a.date.localeCompare(b.date)));

  return {
    total: round4(list.reduce((s, d) => s + d.total, 0)),
    running: {
      hours: round4(list.reduce((s, d) => s + d.running.hours, 0)),
      cost: round4(list.reduce((s, d) => s + d.running.cost, 0)),
    },
    storage: {
      hours: round4(list.reduce((s, d) => s + d.storage.hours, 0)),
      cost: round4(list.reduce((s, d) => s + d.storage.cost, 0)),
    },
    // Deliberately outside `total` — this is an estimate of a charge that does
    // not exist yet, and `total` has to keep meaning money actually taken.
    unbilled: {
      hours: round4(list.reduce((s, d) => s + (d.unbilled?.hours || 0), 0)),
      cost: roundMoney(list.reduce((s, d) => s + (d.unbilled?.cost || 0), 0)),
      asOf,
    },
    // What the wallet covered, versus what went onto the outstanding balance.
    paidFromWallet: roundMoney(paidFromWallet),
    chargedToDebt: roundMoney(chargedToDebt),
    deployments: list,
  };
};

/**
 * How much debt the charges in a window created, pro rata by time exactly as
 * summariseForTeam counts it — the lightweight version for when that is the
 * only number needed (statementService uses it to find how much of today's
 * outstanding balance belongs to charges newer than a given period).
 */
/**
 * The sum of one money field over the charges in a window, counted pro rata
 * by time exactly as summariseForTeam counts it. `field` is 'amount' (what
 * was charged) or 'toDebt' (how much of it went onto the outstanding
 * balance). `userId` narrows it to the deployments one member created — a
 * Developer's monthly spend for their limit (services/team/spendLimitService).
 */
const sumCharged = async (teamId, from, to, { field = 'amount', userId = null } = {}) => {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const ticks = await prisma.deploymentUsage.findMany({
    where: {
      teamId,
      ...(userId ? { userId } : {}),
      charged: true,
      [field]: { gt: 0 },
      periodStart: { lt: to },
      periodEnd: { gte: from },
    },
    select: { periodStart: true, periodEnd: true, [field]: true },
  });
  let total = 0;
  for (const tk of ticks) {
    const startMs = tk.periodStart.getTime();
    const endMs = tk.periodEnd.getTime();
    const span = endMs - startMs;
    const share = span <= 0
      ? (endMs >= fromMs && endMs < toMs ? 1 : 0)
      : Math.max(0, Math.min(endMs, toMs) - Math.max(startMs, fromMs)) / span;
    total += num(tk[field]) * share;
  }
  return roundMoney(total);
};

const sumChargedToDebt = (teamId, from, to) => sumCharged(teamId, from, to, { field: 'toDebt' });

module.exports = {
  create, getDailyTrend, listRecent, summariseForTeam, sumChargedToDebt, sumCharged,
};
