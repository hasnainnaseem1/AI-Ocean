/**
 * Deployment Billing
 *
 * The one routine that turns elapsed time on a deployment into a charge.
 *
 * It exists as a service rather than living inside the hourly cron because a
 * deployment can change rate between two cron runs. When a customer pauses at
 * 14:20 and the job next runs at 15:00, the 20 minutes of full-rate compute
 * before the pause and the 40 minutes of storage-only after it are two
 * different prices. Billing the outstanding period at the moment of the
 * transition — and only then changing the status — keeps every hour charged at
 * the rate that was actually in force.
 *
 * Billing is watermark-based: `lastBilledAt` marks the point everything before
 * which is paid for. Running this twice in a row is safe, and a missed run
 * bills correctly on the next pass rather than losing the hours.
 */
const deploymentUsageService = require('../deployment/deploymentUsageService');
const { BILLABLE_STATUSES, STORAGE_BILLABLE_STATUSES } = require('../deployment/deploymentConstants');
const creditService = require('./creditService');
const debtService = require('./debtService');
const billingModeService = require('./billingModeService');

const MS_PER_HOUR = 60 * 60 * 1000;
const round4 = (n) => Math.round(n * 10000) / 10000;
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

// Don't write a usage row for a sliver of time — it just clutters the ledger
const MIN_BILLABLE_HOURS = 1 / 60; // one minute

/** Is this deployment being charged for compute, for storage, or not at all? */
const billingKind = (status) => {
  if (BILLABLE_STATUSES.includes(status)) return 'compute';
  if (STORAGE_BILLABLE_STATUSES.includes(status)) return 'storage';
  return null;
};

/**
 * ── Who pays for the time that just elapsed ──
 *
 * Pure arithmetic, kept separate from the database so it can be tested against
 * every awkward combination directly.
 *
 * There is one rule and it has no exceptions: **time that was consumed is
 * always billed, in full, at the rate that was in force while it was
 * consumed.** The platform is renting real hardware — every second a machine
 * runs and every hour a disk stays allocated has already cost it money — so
 * nothing is ever waived, for any customer, on any billing method, for any
 * duration.
 *
 * The wallet pays whatever it can cover. Every remaining cent becomes debt on
 * the customer's outstanding balance: the same ledger pay-as-you-go uses, and
 * the only one with collection, a credit limit, an age limit and a grace
 * period wired to it. `toWallet`/`toDebt` say where the money actually came
 * from, so the caller records them as two honest ledger entries rather than
 * one blended number.
 *
 * ── What prepaid and pay-as-you-go actually differ on ──
 *
 * Not the money. Both bill the full elapsed period and both send the shortfall
 * to debt. The difference is only what happens to the machine next: a prepaid
 * deployment is stopped once the wallet runs dry (`exhausted`, which the caller
 * acts on), while pay-as-you-go keeps running by design. The platform's debt
 * limits are real but are enforced elsewhere — fundingService refuses new
 * deployments and resumes on an over-limit account, and debt collection pauses
 * what is already running. Neither of those is "stop billing an hour that has
 * already happened", which is never a thing this function does.
 *
 * ── What this replaced ──
 *
 * Prepaid used to bill only the hours the balance could afford and let the rest
 * of the elapsed period go. In principle the machine "should have been stopped
 * at the exhaustion instant", so the extra time was treated as never consumed.
 * In practice it very much was consumed: billing runs hourly, so a deployment
 * whose wallet emptied at 15:05 kept serving traffic until 16:00 and the
 * platform ate those fifty-five minutes — up to a full hour of an H100 per
 * exhaustion, repeatable. Idle storage had a `stop_charging` policy that wrote
 * off unpaid disk outright. Both are gone: the hours are billed and the
 * shortfall is owed.
 *
 * @param {number} rate           $/hour in force for this period
 * @param {number} elapsedHours   hours since the watermark
 * @param {number} available      what the wallet can cover (balance − graceBalance)
 * @param {'compute'|'storage'} kind
 * @param {'prepaid'|'payg'} [billingMethod]
 * @returns {{hours, amount, exhausted, toWallet, toDebt}}
 */
const planCharge = ({
  rate, elapsedHours, available, kind, billingMethod = 'prepaid',
}) => {
  const full = {
    hours: elapsedHours,
    // The watermark always advances over the whole period, because the whole
    // period is always billed. There is no longer any such thing as elapsed
    // time the watermark has to be held back from.
    amount: roundMoney(rate * elapsedHours),
    exhausted: false,
    kind,
  };

  // A rate of zero is a price the admin set — a tier with no storage component
  // genuinely costs nothing while stopped. That is not a waiver.
  if (rate <= 0) return { ...full, amount: 0, toWallet: 0, toDebt: 0 };

  if (full.amount <= available) return { ...full, toWallet: full.amount, toDebt: 0 };

  const toWallet = roundMoney(Math.max(available, 0));
  const toDebt = roundMoney(full.amount - toWallet);

  return {
    ...full,
    toWallet,
    toDebt,
    /**
     * The wallet is dry. On prepaid that is the signal to stop the machine —
     * and the stop is dated now, not back-dated to the instant the money ran
     * out, because every minute up to now has just been billed. Back-dating
     * belonged to the old behaviour, where the unbilled tail was pretended not
     * to have happened.
     *
     * Pay-as-you-go is never stopped by billing; that is the entire offer.
     */
    exhausted: billingMethod !== 'payg',
  };
};

/**
 * Charge a deployment for everything owed since its watermark, then advance it.
 *
 * @param {Deployment} deployment  a wrapped deployment — saved by this function
 * @param {object}     [options]
 * @param {Date}       [options.now]      bill up to this instant
 * @param {object}     [options.settings] billing settings, re-read if omitted
 * @param {boolean}    [options.save]     persist the deployment (default true)
 * @returns {Promise<{billed: boolean, kind: string|null, hours: number, amount: number, rate: number}>}
 */
const billOutstanding = async (deployment, options = {}) => {
  const now = options.now || new Date();
  const settings = options.settings || (await billingModeService.getBillingSettings());
  const save = options.save !== false;

  const idle = {
    billed: false, kind: null, hours: 0, amount: 0, rate: 0,
    exhausted: false, exhaustedAt: null,
    // Explicit, because `transition()` reads this to decide whether a closing
    // deployment still owes anything. Left undefined it would compare as
    // "nothing owed" and quietly skip the final settlement.
    unsettled: 0,
  };

  const kind = billingKind(deployment.status);
  if (!kind) return idle;

  // The platform owner can turn idle-storage charging off entirely without
  // touching any tier's component prices.
  if (kind === 'storage' && settings.billStorageWhileStopped === false) {
    deployment.lastBilledAt = now;
    if (save) await deployment.save();
    return idle;
  }

  const periodStart = deployment.lastBilledAt || deployment.startedAt;
  if (!periodStart) {
    // Never bill from an unknown start point — just plant the watermark
    deployment.lastBilledAt = now;
    if (save) await deployment.save();
    return idle;
  }

  const elapsedHours = (now.getTime() - new Date(periodStart).getTime()) / MS_PER_HOUR;
  const rate = deployment.currentRate();

  // A zero rate is a legitimate outcome — a tier with no storage component
  // costs nothing while stopped. Advance the watermark so those hours can
  // never be re-billed at a different rate later, and write no ledger noise.
  if (rate <= 0) {
    deployment.lastBilledAt = now;
    if (save) await deployment.save();
    return { ...idle, kind, hours: round4(elapsedHours), rate, unsettled: 0 };
  }

  /**
   * A sliver of a period is DEFERRED, never waived. The watermark deliberately
   * does not move, so these seconds are billed by whichever pass next finds
   * more than a minute behind it — writing a usage row per second would bury
   * the customer's own ledger for no benefit to anyone.
   *
   * The one place a deferral would quietly become a write-off is a deployment
   * being closed, because nothing bills it afterwards. So what is outstanding
   * is reported rather than swallowed, and `transition()` settles it through
   * `settleTerminal` — which has no minimum at all. Twenty seconds of an H100
   * is nine cents, and nine cents is not nothing.
   */
  if (elapsedHours < MIN_BILLABLE_HOURS) {
    return { ...idle, kind, rate, unsettled: roundMoney(rate * elapsedHours) };
  }

  const available = (await creditService.affordable(deployment.teamId, settings.graceBalance || 0)).available;

  const plan = planCharge({
    rate,
    elapsedHours,
    available,
    kind,
    billingMethod: deployment.billingMethod || 'prepaid',
  });

  const { amount, exhausted, toWallet, toDebt } = plan;

  /**
   * ── The fraction of a cent that will not fit ──
   *
   * A charge is an hourly rate times a fraction of an hour, and the result
   * almost never lands exactly on the four decimals the database stores. Ten
   * minutes of a USD 1.469/hr machine is USD 0.2448333…, which is recorded as
   * USD 0.2448 — three ten-thousandths short, every single tick.
   *
   * That remainder is not written off. The watermark advances only as far as
   * the money actually charged reaches, so the unbilled sliver stays behind it
   * and is picked up by the next pass, where it is added to that period and
   * eventually crosses into a recordable amount. Over any stretch of time the
   * customer pays the published rate exactly, no matter how often billing runs.
   *
   * Billing `hours` is derived from the amount for the same reason: it keeps
   * `hours × rate = amount` true on the customer's own statement, which is what
   * makes the line reconcile when they check it.
   */
  const hours = round4(amount / rate);
  const periodEnd = new Date(new Date(periodStart).getTime() + (amount / rate) * MS_PER_HOUR);

  if (amount <= 0) {
    /*
     * The period is worth less than the smallest amount that can be recorded.
     * The watermark deliberately does NOT move: those moments carry forward to
     * the next pass rather than being given away. An empty wallet never lands
     * here — that bills in full and sends the shortfall to debt.
     */
    return {
      billed: false, kind, hours: 0, amount: 0, rate,
      exhausted, exhaustedAt: exhausted ? now : null,
      unsettled: roundMoney(rate * elapsedHours),
    };
  }

  let transactionId = null;
  let debtTransactionId = null;

  const label = kind === 'storage'
    ? `${deployment.deploymentName} — ${round4(hours)}h storage at ${rate}/hr (${deployment.status})`
    : `${deployment.deploymentName} — ${round4(hours)}h at ${rate}/hr`;

  const baseMetadata = {
    deploymentId: deployment.id,
    modelName: deployment.model?.name,
    tierName: deployment.tier?.name,
    kind,
    status: deployment.status,
    hours: round4(hours),
    rate,
    ...(exhausted ? { exhaustedBalance: true } : {}),
  };

  /**
   * ── Move the money, and remember how much of it actually moved ──
   *
   * This used to let a failure here abandon the whole call, which was safe
   * only because of an assumption written into the class comment above: a
   * missed run "bills correctly on the next pass rather than losing the
   * hours". That assumption does not hold for a deployment on its way to
   * being terminated — nothing ever bills it again, `listBillable` does not
   * return terminal statuses, and the unbilled hours were simply free.
   *
   * So what was taken is tracked rather than assumed, the watermark advances
   * over exactly that much time and no further, and any shortfall is reported
   * back to the caller (`unsettled`) instead of disappearing with the stack
   * trace. `transition()` uses that to make a last-chance settlement before a
   * deployment reaches a state nothing can bill.
   */
  let paidToWallet = 0;
  let paidToDebt = 0;
  let settlementError = null;

  try {
    if (toWallet > 0) {
      // The account pays; the ledger row records whose deployment it was.
      const { transaction } = await creditService.charge(deployment.teamId, toWallet, {
        actorUserId: deployment.userId,
        referenceId: deployment.id,
        referenceModel: 'Deployment',
        description: label,
        floor: settings.graceBalance || 0,
        // Only ever true on the deliberate prepaid storage-accrue path —
        // pay-as-you-go's shortfall goes to debt below, never to overdraft.
        // Nothing ever drives the wallet negative now: whatever the balance
        // cannot cover was already split out into `toDebt` above, which is a
        // ledger that can actually be collected from.
        allowOverdraft: false,
        metadata: baseMetadata,
      });
      transactionId = transaction.id;
      paidToWallet = toWallet;
    }

    if (toDebt > 0) {
      const { transaction: debtTx } = await debtService.accrue(deployment.teamId, toDebt, {
        actorUserId: deployment.userId,
        referenceId: deployment.id,
        referenceModel: 'Deployment',
        description: `${label} (pay-as-you-go — balance did not cover this period)`,
        metadata: baseMetadata,
      });
      debtTransactionId = debtTx.id;
      paidToDebt = toDebt;
    }
  } catch (err) {
    settlementError = err;
    console.error(
      `[Billing] Could not fully settle "${deployment.deploymentName}" (${deployment.id}): ${err.message}`
    );
  }

  const settledAmount = roundMoney(paidToWallet + paidToDebt);
  const unsettled = roundMoney(Math.max(0, amount - settledAmount));

  if (settledAmount <= 0) {
    // Nothing was taken, so nothing has been paid for: the watermark must not
    // move at all, or these hours become free. The caller decides what happens
    // next — retry on the next pass, or settle as debt if there is no next pass.
    return {
      billed: false, kind, hours: 0, amount: 0, rate, toWallet: 0, toDebt: 0,
      exhausted, exhaustedAt: exhausted ? periodEnd : null,
      settlementError, unsettled: amount,
    };
  }

  /**
   * Part-paid — the wallet charge went through but the debt accrual did not,
   * or vice versa. The watermark advances pro rata over the time that was
   * actually paid for, so the remainder stays genuinely outstanding instead of
   * being written off by a watermark that jumped past it.
   */
  const paidFraction = settledAmount / amount;
  const paidHours = round4(hours * paidFraction);
  const settledPeriodEnd = paidFraction >= 1
    ? periodEnd
    : new Date(new Date(periodStart).getTime() + paidHours * MS_PER_HOUR);

  /**
   * Bookkeeping from here down. The money is already in the ledger, so none of
   * it may throw: surfacing a failed usage-row write as "billing failed" is
   * precisely what would let the caller charge this same period a second time.
   */
  try {
    await deploymentUsageService.create({
      deploymentId: deployment.id,
      teamId: deployment.teamId,
      userId: deployment.userId,
      periodStart,
      periodEnd: settledPeriodEnd,
      kind,
      status: deployment.status,
      hours: paidHours,
      rate,
      amount: settledAmount,
      toWallet: paidToWallet,
      toDebt: paidToDebt,
      currency: deployment.currency,
      transactionId,
      debtTransactionId,
      charged: true,
    });
  } catch (err) {
    console.error(
      `[Billing] Charged ${settledAmount} for "${deployment.deploymentName}" but could not write `
      + `its usage row: ${err.message}. The credit ledger is the record of the charge.`
    );
  }

  // Advance the watermark BEFORE the caller does anything else — including
  // suspending or transitioning — so the same hours can never be billed twice
  // even if what follows throws.
  deployment.lastBilledAt = settledPeriodEnd;
  // Runtime hours mean time actually running; idle storage is not runtime.
  if (kind === 'compute') {
    deployment.totalRuntimeHours = round4((deployment.totalRuntimeHours || 0) + paidHours);
  }
  deployment.totalCost = roundMoney((deployment.totalCost || 0) + settledAmount);
  // A storage bill that went to debt — whether via the prepaid accrue policy
  // or pay-as-you-go's shortfall — means this deployment currently holds
  // unpaid storage, regardless of which path produced the debt.
  if (kind === 'storage' && paidToDebt > 0) deployment.hasUnpaidStorage = true;
  if (save) {
    try {
      await deployment.save();
    } catch (err) {
      console.error(
        `[Billing] Charged ${settledAmount} for "${deployment.deploymentName}" but could not save `
        + `its watermark: ${err.message}`
      );
    }
  }

  return {
    billed: true,
    kind,
    hours: paidHours,
    amount: settledAmount,
    rate,
    toWallet: paidToWallet,
    toDebt: paidToDebt,
    // The instant the balance ran out — the caller stops the machine here.
    // Pay-as-you-go is never exhausted by billing itself — see planCharge.
    exhausted,
    exhaustedAt: exhausted ? settledPeriodEnd : null,
    settlementError,
    unsettled,
  };
};

/**
 * Last-chance settlement, for a deployment about to enter a state that nothing
 * will ever bill again.
 *
 * `billOutstanding` is written on the assumption that a failed charge is
 * harmless because the next hourly pass will retry it. That assumption is true
 * for a pause or a stop and false for a terminate: `listBillable` only returns
 * running, paused and stopped deployments, so the moment a deployment becomes
 * `terminated` (or `rejected`, or `failed`) the hours it ran since its last
 * watermark stop being anybody's problem and become free. A transient database
 * or wallet error at the instant a customer clicks Terminate was therefore a
 * silent write-off of real, delivered compute.
 *
 * ── Why debt rather than refusing the terminate ──
 *
 * Blocking the transition until the bill clears was the other option, and it is
 * worse in every direction. The customer asked for the machine to be destroyed;
 * refusing leaves it running and still charging them for the privilege of a
 * database error they cannot see or fix. A persistent failure becomes a
 * deployment that can never be deleted. And debt collection itself terminates
 * deployments whose unpaid storage has run past its grace period — that job
 * would deadlock against its own precondition.
 *
 * Debt is the platform's existing answer to "owed but not taken". It survives
 * the deployment being gone, it is visible to the customer on their billing
 * page, the collection job already chases it against their saved card, and an
 * admin can write it off in one click if it turns out not to be owed. So the
 * terminate always succeeds and the money always lands somewhere it can be
 * seen.
 *
 * `debtService.accrue` sweeps whatever the wallet is holding into the new debt
 * as it records it, so a customer with credit still simply pays from their
 * balance — this is not a way of putting a solvent customer into arrears.
 *
 * @param {Deployment} deployment  wrapped, still carrying its PRE-transition status
 * @param {object}  [options]
 * @param {Date}    [options.now]
 * @param {boolean} [options.save]
 * @returns {Promise<{settled: boolean, amount: number, hours: number, rate: number, error?: Error}>}
 */
const settleTerminal = async (deployment, options = {}) => {
  const now = options.now || new Date();
  const save = options.save !== false;
  const nothingOwed = { settled: true, amount: 0, hours: 0, rate: 0 };

  const kind = billingKind(deployment.status);
  if (!kind) return nothingOwed;

  const periodStart = deployment.lastBilledAt || deployment.startedAt;
  if (!periodStart) return nothingOwed;

  /*
   * No minimum duration here, unlike billOutstanding. There, a sliver under a
   * minute is deferred — the watermark stays put and the next pass bills it.
   * Here there is no next pass, so the same floor would be a write-off of up
   * to fifty-nine seconds of a machine that may cost USD 15/hr, every time a
   * deployment is closed. Whatever ran is billed, however briefly.
   */
  const elapsedHours = (now.getTime() - new Date(periodStart).getTime()) / MS_PER_HOUR;
  if (elapsedHours <= 0) return nothingOwed;

  const rate = deployment.currentRate();
  if (rate <= 0) {
    deployment.lastBilledAt = now;
    if (save) await deployment.save().catch(() => {});
    return nothingOwed;
  }

  const hours = round4(elapsedHours);
  const amount = roundMoney(rate * hours);
  if (amount <= 0) return nothingOwed;

  const label = `${deployment.deploymentName} — ${hours}h at ${rate}/hr`;
  const metadata = {
    deploymentId: deployment.id,
    modelName: deployment.model?.name,
    tierName: deployment.tier?.name,
    kind,
    status: deployment.status,
    hours,
    rate,
    finalSettlement: true,
  };

  let transaction = null;
  try {
    ({ transaction } = await debtService.accrue(deployment.teamId, amount, {
      actorUserId: deployment.userId,
      referenceId: deployment.id,
      referenceModel: 'Deployment',
      description: `${label} (final settlement — charged when the deployment was closed)`,
      metadata,
    }));
  } catch (err) {
    /*
     * Even the debt write failed. This is the one case where the money cannot
     * be captured automatically, so it must not be allowed to vanish quietly:
     * an admin is told the customer, the deployment, the exact hours and the
     * exact amount, so it can be recovered by hand.
     */
    console.error(
      `[Billing] FINAL SETTLEMENT FAILED for "${deployment.deploymentName}" (${deployment.id}) — `
      + `${hours}h at ${rate}/hr = ${deployment.currency || 'USD'} ${amount} is unbilled: ${err.message}`
    );
    require('../notification/adminNotifier')
      .notifyUnbilledOnClose({ deployment, hours, rate, amount, error: err })
      .catch(() => {});
    return { settled: false, amount, hours, rate, error: err };
  }

  // The money is captured. Everything below is bookkeeping and must not throw.
  try {
    await deploymentUsageService.create({
      deploymentId: deployment.id,
      teamId: deployment.teamId,
      userId: deployment.userId,
      periodStart,
      periodEnd: now,
      kind,
      status: deployment.status,
      hours,
      rate,
      amount,
      toWallet: 0,
      toDebt: amount,
      currency: deployment.currency,
      transactionId: null,
      debtTransactionId: transaction?.id || null,
      charged: true,
    });
  } catch (err) {
    console.error(`[Billing] Final settlement recorded as debt but its usage row failed: ${err.message}`);
  }

  deployment.lastBilledAt = now;
  if (kind === 'compute') {
    deployment.totalRuntimeHours = round4((deployment.totalRuntimeHours || 0) + hours);
  }
  deployment.totalCost = roundMoney((deployment.totalCost || 0) + amount);
  if (save) {
    try {
      await deployment.save();
    } catch (err) {
      console.error(`[Billing] Final settlement recorded but watermark not saved: ${err.message}`);
    }
  }

  return { settled: true, amount, hours, rate };
};

module.exports = {
  billOutstanding,
  settleTerminal,
  billingKind,
  planCharge,
  MIN_BILLABLE_HOURS,
};
