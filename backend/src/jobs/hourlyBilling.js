/**
 * Hourly Billing Job
 *
 * Charges every deployment that is currently costing the customer something:
 * running ones at the full machine rate, paused and stopped ones at their
 * storage rate — because their disk is still ours and still occupied.
 *
 * The arithmetic lives in services/billing/deploymentBilling.js, which the
 * status-transition path also calls so a pause mid-hour bills the compute
 * before the rate drops. This job's own work is scheduling, and stopping
 * machines whose owner has run out of credit.
 *
 * On that last point: billing reports the exact instant a wallet was exhausted
 * and bills only up to it, so the pause is back-dated to that instant rather
 * than to whenever this job happened to notice. Otherwise every customer would
 * overdraw by up to one full billing period — and by a great deal more than
 * that after any gap in cron runs.
 */
const userService = require('../services/user/userService');
const creditService = require('../services/billing/creditService');
const billingModeService = require('../services/billing/billingModeService');
const deploymentBilling = require('../services/billing/deploymentBilling');
const deploymentService = require('../services/deployment/deploymentService');
const { BILLABLE_STATUSES } = require('../services/deployment/deploymentConstants');
const adminNotifier = require('../services/notification/adminNotifier');
const { billingCopy } = require('../services/billing/copyTemplates');
const debtEnforcement = require('../services/billing/debtEnforcement');
const fundingService = require('../services/billing/fundingService');
const teamService = require('../services/team/teamService');

/**
 * Where a deployment falls in the billing order when one customer's wallet
 * can't cover everything running for them at once.
 *
 * Deployments are charged one at a time, in place, so whichever one is
 * charged LAST inherits whatever the wallet has left — that is the one that
 * runs short and gets suspended. So "suspend the most expensive first" means
 * the most expensive one must be billed LAST: everything else is billed
 * first and protected, and it is left to whatever remains.
 *
 * Pay-as-you-go deployments and anything not currently running at full rate
 * are given the lowest possible rank — always billed early, never the target
 * of this ordering, because pay-as-you-go is never suspended for balance at
 * all (see planCharge) and a paused/stopped deployment's storage billing has
 * its own, separate policy.
 */
const suspendOrderRank = (deployment, suspendOrder) => {
  const isPrepaidRunning = deployment.billingMethod !== 'payg'
    && BILLABLE_STATUSES.includes(deployment.status);
  if (!isPrepaidRunning) return -Infinity;

  switch (suspendOrder) {
    case 'least_expensive': return -deployment.pricePerHour;
    case 'newest': return new Date(deployment.createdAt).getTime();
    case 'oldest': return -new Date(deployment.createdAt).getTime();
    case 'most_expensive':
    default: return deployment.pricePerHour;
  }
};

const run = async () => {
  const settings = await billingModeService.getBillingSettings();

  /*
   * Safety net, before anything is billed: a customer who has lost
   * pay-as-you-go (platform switch off, or blocked individually) must not
   * have a PAYG deployment left running up debt. The admin actions that
   * remove access already do this; this catches whatever they missed. Each
   * one is billed as PAYG up to this moment first, then moved to prepaid —
   * so the loop below sees it as prepaid and applies prepaid's rules.
   */
  try {
    const moved = await fundingService.enforcePaygAccessNow({ settings });
    if (moved.switched) console.log(`[CRON] Moved ${moved.switched} deployment(s) off pay-as-you-go — access removed`);
  } catch (err) {
    console.error('[CRON] Pay-as-you-go access enforcement failed:', err.message);
  }

  const now = new Date();

  const billable = await deploymentService.listBillable();

  if (billable.length === 0) return;

  billable.sort((a, b) => suspendOrderRank(a, settings.suspendOrder) - suspendOrderRank(b, settings.suspendOrder));

  const runningCount = billable.filter((d) => BILLABLE_STATUSES.includes(d.status)).length;
  console.log(
    `[CRON] Billing ${billable.length} deployment(s) — ${runningCount} running, `
    + `${billable.length - runningCount} stopped (storage only)`
  );

  let charged = 0;
  let storageCharged = 0;
  let suspended = 0;
  let indebted = 0;

  for (const deployment of billable) {
    try {
      const result = await deploymentBilling.billOutstanding(deployment, { now, settings });

      if (result.billed && result.amount > 0) {
        if (result.kind === 'storage') storageCharged++;
        else charged++;
      }

      // Unpaid storage is now debt on the outstanding balance rather than a
      // negative wallet balance (see planCharge), so this reads the debt the
      // charge actually produced instead of the old `overdrawn` flag.
      if (result.kind === 'storage' && result.toDebt > 0) {
        indebted++;
        await flagStorageDebt(deployment, settings);
      }

      /**
       * Out of credit → stop the machine, as of the moment the money ran out.
       *
       * Only applies to a still-running PREPAID deployment. A deployment that
       * is already stopped has no compute left to release, and destroying a
       * customer's disk over an unpaid balance is not a decision a cron job
       * should make — that case is handled by the storage-debt policy above
       * instead. A pay-as-you-go deployment is never suspended for balance at
       * all: planCharge already sent its shortfall to debt rather than
       * reporting `exhausted`, and the wallet-balance safety net below must
       * not override that by suspending it anyway just because the shared
       * wallet happens to read zero.
       */
      const stillRunning = BILLABLE_STATUSES.includes(deployment.status);
      const isPayg = deployment.billingMethod === 'payg';

      if (settings.autoSuspendAtZero && stillRunning && !isPayg) {
        const wallet = await creditService.getOrCreateWallet(deployment.teamId);
        const floor = settings.graceBalance || 0;

        // `exhausted` is the precise signal. The balance check behind it is a
        // safety net for a wallet driven under by something other than this
        // job — an admin adjustment, say — where nothing was owed this tick.
        if (result.exhausted || wallet.balance <= floor) {
          await deploymentService.transition(deployment, 'paused', {
            note: 'Automatically paused — credit balance exhausted',
            autoSuspendedForCredit: true,
            balance: wallet.balance,
            at: result.exhaustedAt || now,
          });

          await creditService.markSuspended(deployment.teamId, now);
          suspended++;

          // The customer already gets their own notification from
          // deploymentService.transition() — this is the admin's copy, sent at
          // the same moment, so someone can act on it right away rather than
          // finding out only when the customer complains.
          const owner = await userService.findById(deployment.userId);
          await adminNotifier.notifyDeploymentAutoSuspended({
            deployment, customer: owner, balance: wallet.balance, cause: 'credit_exhausted',
          });

          await offerPayg(deployment, settings);
        }
      }
    } catch (err) {
      // A deployment that cannot be billed must never be left quietly running:
      // that is how one ends up consuming hardware for free indefinitely.
      console.error(`[CRON] Failed to bill deployment ${deployment.id}:`, err.message);
      await stopUnbillable(deployment, settings, err);
    }
  }

  /*
   * ── Stop accounts that have just gone past a debt limit ──
   *
   * Billing above never pauses a pay-as-you-go deployment for balance — that is
   * correct and deliberate, because the shortfall becomes debt rather than a
   * reason to stop serving. But the debt limits the operator configured have to
   * be acted on *somewhere*, and until now the only place was the debt
   * collection cron, which runs once a day.
   *
   * That made the limit up to 24 hours late while debt kept growing every ten
   * minutes: an account that crossed a USD 1,000 limit shortly after the
   * nightly run went on billing until the next one, and three machines at about
   * USD 20/hr turned that USD 1,000 ceiling into a USD 2,766 balance.
   *
   * So the check runs here too, at billing cadence. It is deliberately AFTER
   * the loop rather than inside it: the debt this tick just wrote is what the
   * limit has to be judged against, and an account with four machines should be
   * evaluated once rather than four times.
   *
   * Nothing is forgiven by stopping — every hour already consumed stays billed
   * and owed. This only decides how much further the hardware may run.
   */
  const { paused: limitPaused, resumed: limitResumed, blockedAccounts } = await debtEnforcement.enforceForTeams(
    billable.map((d) => d.teamId),
    { settings, now },
  );

  /*
   * Team spend limits moved with this run's charges — tell owners/admins once
   * when a Developer passes 80% and 100% of theirs this month. Never allowed
   * to fail the billing run it follows.
   */
  try {
    await require('../services/team/spendLimitService').runAlerts(now);
  } catch (err) {
    console.error('[CRON] Spend limit alerts failed:', err.message);
  }

  console.log(
    `[CRON] Hourly billing complete — ${charged} compute, ${storageCharged} storage, `
    + `${suspended} suspended for insufficient credit`
    + `${indebted ? `, ${indebted} accruing storage debt` : ''}`
    + `${limitPaused ? `, ${limitPaused} paused across ${blockedAccounts} account(s) over a debt limit` : ''}`
    + `${limitResumed ? `, ${limitResumed} resumed after settling back under it` : ''}`
  );
};

/**
 * Last-resort stop for a deployment whose billing threw.
 *
 * Before this existed, an exception here just moved on to the next deployment,
 * so a machine that could not be charged kept running — unbilled and
 * unsuspended — until somebody noticed by hand.
 */
const stopUnbillable = async (deployment, settings, cause) => {
  if (!settings.autoSuspendAtZero) return;
  if (!BILLABLE_STATUSES.includes(deployment.status)) return;

  try {
    await deploymentService.transition(deployment, 'paused', {
      note: `Automatically paused — billing could not be completed (${cause.message})`,
      autoSuspendedForCredit: cause.code === 'INSUFFICIENT_BALANCE',
    });
    console.error(`[CRON] Paused ${deployment.id} because it could not be billed`);

    // This path is a genuine exception, not routine credit exhaustion — an
    // admin needs to know regardless of the usual auto-suspend notification
    // volume, since the deployment may need manual attention beyond a top-up.
    const owner = await userService.findById(deployment.userId);
    await adminNotifier.notifyDeploymentAutoSuspended({
      deployment, customer: owner, balance: null, cause: 'billing_failed',
    });
  } catch (err) {
    console.error(`[CRON] Could not pause unbillable ${deployment.id}:`, err.message);
  }
};

/** Tell the owner once that their stopped deployment is running up a disk bill. */
const flagStorageDebt = async (deployment, settings) => {
  if (deployment.storageDebtNotifiedAt) return;

  try {
    await deploymentService.notifyCustomer(deployment, {
      type: 'deployment_suspended',
      // A decision about the account's money — its money handlers hear it.
      money: true,
      title: 'Your stopped deployment is running up a balance',
      message: billingCopy(settings, 'storageDebtMessage', {
        deploymentName: deployment.deploymentName,
        storageGb: deployment.tier?.storageGb || 0,
      }),
      priority: 'high',
    });
    deployment.storageDebtNotifiedAt = new Date();
    await deployment.save();
  } catch (err) {
    console.error(`[CRON] Could not flag storage debt on ${deployment.id}:`, err.message);
  }
};

/**
 * Offer a customer whose prepaid deployment just auto-paused the alternative
 * of switching to pay-as-you-go instead of topping up — latched so it is
 * offered once per exhaustion, not on every hour it sits paused. Cleared on
 * resume (deploymentService.transition), so a future exhaustion gets a fresh
 * offer rather than silence because this one already fired.
 *
 * Only made when pay-as-you-go actually exists on this platform — offering a
 * switch to something the admin has turned off would be a dead end.
 */
const offerPayg = async (deployment, settings) => {
  if (deployment.paygOfferedAt) return;
  // This account's access, not just the platform switch — offering PAYG to
  // one an admin has blocked from it would be a dead end, and to one
  // individually allowed while it is off platform-wide, a real way out.
  const account = await teamService.findById(deployment.teamId);
  if (!fundingService.resolvePaygAccess(account, settings).available) return;

  try {
    await deploymentService.notifyCustomer(deployment, {
      type: 'deployment_suspended',
      // A decision about the account's money — its money handlers hear it.
      money: true,
      title: 'Switch to pay-as-you-go instead?',
      message:
        `"${deployment.deploymentName}" is paused because your balance ran out. Instead of topping `
        + 'up, you can switch it to pay-as-you-go — it stays running and the balance becomes an '
        + 'outstanding amount you settle later. You can switch it back at any time.',
      priority: 'high',
    });
    deployment.paygOfferedAt = new Date();
    await deployment.save();
  } catch (err) {
    console.error(`[CRON] Could not offer pay-as-you-go on ${deployment.id}:`, err.message);
  }
};

module.exports = { run };
