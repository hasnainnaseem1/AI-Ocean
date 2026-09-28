/**
 * Debt Collection Job
 *
 * Runs once a day and closes the loop the rest of the billing system
 * deliberately leaves open:
 *
 *   - pay-as-you-go never pauses for balance on its own (deploymentBilling)
 *     — so something has to eventually act on debt that isn't getting paid
 *   - a stopped deployment's unpaid storage isn't held forever — a grace
 *     period ends somewhere and the disk actually gets released
 *   - a saved card silently expiring is worse discovered from a failed
 *     collection attempt than from a warning email
 *   - a deployment stuck in the fulfilment queue for days is stock nobody
 *     is being billed for and nobody may have noticed
 *
 * Every "should this fire today" decision is pure and lives in
 * services/billing/collectionSchedule.js — this file is only the I/O around
 * those decisions: what to query, what to do, who to tell.
 */
const notificationService = require('../services/notification/notificationService');
const billingModeService = require('../services/billing/billingModeService');
const creditService = require('../services/billing/creditService');
const debtService = require('../services/billing/debtService');
const paymentMethodService = require('../services/billing/paymentMethodService');
const { billingCopy } = require('../services/billing/copyTemplates');
const schedule = require('../services/billing/collectionSchedule');
const deploymentService = require('../services/deployment/deploymentService');
const adminNotifier = require('../services/notification/adminNotifier');
const debtEnforcement = require('../services/billing/debtEnforcement');
const teamService = require('../services/team/teamService');

/**
 * One notification per recipient. Account-level money events (a collection,
 * a card expiring) go to everyone who handles the account's money — pass
 * `teamId`; an event about one deployment goes to its member — pass `userId`.
 */
const notifyCustomer = async ({
  userId = null, teamId = null, type, contentKey = null, title, message, priority = 'medium', metadata = {},
}) => {
  const recipients = teamId ? await teamService.billingRecipientIds(teamId) : [userId];
  for (const recipientId of recipients.filter(Boolean)) {
    await notifyOne({
      recipientId, type, contentKey, title, message, priority, metadata,
    });
  }
};

const notifyOne = async ({
  recipientId, type, contentKey, title, message, priority, metadata,
}) => {
  try {
    await notificationService.createNotification({
      recipientId,
      recipientType: 'customer',
      type,
      // Names the copy in services/notification/notificationCopy.js so the bell
      // re-renders in the reader's language; `metadata` carries its
      // placeholders. A cron job has no request context and therefore no way to
      // know the recipient's language at write time, which is one of the
      // reasons this rendering happens at read time instead.
      contentKey,
      title,
      message,
      priority,
      metadata,
    });
  } catch (err) {
    console.error(`[CRON] Could not notify user ${recipientId}:`, err.message);
  }
};

/**
 * Everything keyed off a wallet carrying debt: the scheduled card-charge
 * attempt, and — for an account that has crossed the platform's configured
 * limit — pausing whatever pay-as-you-go deployments are still running for
 * them. Billing itself never pauses pay-as-you-go (see
 * deploymentBilling.planCharge); this is where that finally happens, once an
 * account has genuinely gone over the limit rather than merely owing
 * something.
 */
const processDebtAccounts = async (settings, now) => {
  const wallets = await creditService.listWithDebt();

  let attempted = 0;
  let collected = 0;
  let failed = 0;
  let escalated = 0;

  for (const wallet of wallets) {
    try {
      const debtDays = schedule.daysSince(wallet.debtSince, now);

      const status = debtService.evaluateDebtStatus({
        outstanding: wallet.outstandingBalance,
        debtSince: wallet.debtSince,
        now,
        creditLimit: settings.payg?.creditLimit ?? 0,
        maxDebtDays: settings.payg?.maxDebtDays ?? 0,
      });

      if (status.blocked) {
        const pausedCount = await debtEnforcement.pauseRunningForBlockedAccount(wallet.teamId, status, now);
        if (pausedCount > 0) escalated += pausedCount;
      }

      const threshold = settings.payg?.autoChargeThreshold ?? 0;
      if (wallet.outstandingBalance < threshold) continue;

      if (!schedule.shouldAttemptChargeToday({
        debtDays,
        lastAutoChargeAt: wallet.lastAutoChargeAt,
        now,
        autoChargeRetryDays: settings.payg?.autoChargeRetryDays || [],
      })) continue;

      attempted += 1;
      try {
        const result = await debtService.settleFromCard(wallet.teamId, wallet.outstandingBalance, {
          description: 'Automatic debt collection',
        });
        if (result.settled > 0) {
          collected += 1;
          await notifyCustomer({
            teamId: wallet.teamId,
            type: 'debt_collected',
            contentKey: 'debt.collected',
            title: 'Outstanding balance settled',
            message: `Your card was charged ${wallet.currency} ${result.settled.toFixed(2)} to settle your outstanding balance.`,
            metadata: { currency: wallet.currency, amount: result.settled.toFixed(2) },
            priority: 'medium',
          });
        }
      } catch (err) {
        failed += 1;
        await notifyCustomer({
          teamId: wallet.teamId,
          type: 'debt_collection_failed',
          contentKey: 'debt.collectionFailed',
          title: 'Could not collect your outstanding balance',
          message: `We tried to charge your card ${wallet.currency} ${wallet.outstandingBalance.toFixed(2)} to `
            + `settle your outstanding balance, but it failed (${err.message}). Please update your `
            + 'payment method or add funds.',
          metadata: {
            currency: wallet.currency,
            amount: wallet.outstandingBalance.toFixed(2),
            error: err.message,
          },
          priority: 'high',
        });
      }
    } catch (err) {
      console.error(`[CRON] debtCollection error for wallet ${wallet.id}:`, err.message);
    }
  }

  console.log(
    `[CRON] Debt collection: ${attempted} charge attempt(s) — ${collected} collected, ${failed} failed`
    + `${escalated ? `, ${escalated} deployment(s) paused for exceeding the debt limit` : ''}`
  );
};


/**
 * Daily reminders for a stopped deployment's unpaid storage, and — once the
 * configured grace period has fully elapsed — releasing the disk. The debt
 * itself is never forgiven by this; only the hardware is released.
 */
const runStorageGrace = async (settings, now) => {
  if (!settings.storageGrace?.enabled) return;

  const deployments = await deploymentService.listUnpaidStorage();

  /**
   * One wallet read for the whole batch instead of one per deployment.
   * A customer with several stopped deployments was being looked up once for
   * each of them.
   */
  const wallets = await creditService.findWalletsFor(deployments.map((d) => d.teamId));

  let warned = 0;
  let terminated = 0;

  for (const deployment of deployments) {
    try {
      const wallet = wallets.get(String(deployment.teamId))
        || await creditService.getOrCreateWallet(deployment.teamId);
      const debtDays = schedule.daysSince(wallet.debtSince, now);

      if (schedule.graceExpired({ debtDays, graceDays: settings.storageGrace.graceDays })) {
        if (settings.storageGrace.terminateAtEnd) {
          await deploymentService.transition(deployment, 'terminated', {
            note: 'Automatically terminated — unpaid storage exceeded the grace period. '
              + 'The outstanding balance is not affected and remains owed.',
            at: now,
          });
          await notifyCustomer({
            userId: deployment.userId,
            type: 'deployment_suspended',
            contentKey: 'storage.terminated',
            title: 'Deployment terminated — unpaid storage',
            message: `"${deployment.deploymentName}" was terminated because its storage went unpaid `
              + `for more than ${settings.storageGrace.graceDays} days. Any outstanding balance is still owed.`,
            metadata: {
              deploymentName: deployment.deploymentName,
              graceDays: settings.storageGrace.graceDays,
            },
            priority: 'urgent',
          });
          terminated += 1;
        }
        continue;
      }

      if (schedule.shouldSendGraceWarningToday({
        debtDays,
        warnDailyFrom: settings.storageGrace.warnDailyFrom,
        lastWarnedAt: deployment.storageGraceWarnedAt,
        now,
      })) {
        const daysLeft = Math.max(0, settings.storageGrace.graceDays - debtDays);
        // Heading only — the body is the operator's `storageDebtMessage` from
        // the Admin Center. See notificationCopy.js's header.
        await notifyCustomer({
          userId: deployment.userId,
          type: 'deployment_suspended',
          contentKey: 'storage.warning',
          title: 'Unpaid storage — action needed',
          message: `${billingCopy(settings, 'storageDebtMessage', {
            deploymentName: deployment.deploymentName,
            storageGb: deployment.tier?.storageGb || 0,
          })} ${daysLeft > 0 ? `${daysLeft} day(s) left before it is terminated.` : 'It will be terminated today.'}`,
          priority: 'high',
        });
        deployment.storageGraceWarnedAt = now;
        await deployment.save();
        warned += 1;
      }
    } catch (err) {
      console.error(`[CRON] storageGrace error for deployment ${deployment.id}:`, err.message);
    }
  }

  console.log(`[CRON] Storage grace: ${warned} warned, ${terminated} terminated`);
};

/** Warn a customer their saved card is about to stop working, and expire it once it has. */
const runCardExpiryCheck = async (settings, now) => {
  const methods = await paymentMethodService.listActive();
  const warningDays = settings.cardExpiryWarningDays || [];

  let warned = 0;
  let expired = 0;

  for (const pm of methods) {
    try {
      if (pm.isExpired(now)) {
        // PaymentMethod's real source of truth is Postgres now (see the
        // `pm` is a wrapped payment-method record, so
        // this goes through paymentMethodService rather than `pm.save()`.
        await paymentMethodService.markExpired(pm.id);
        expired += 1;
        await notifyCustomer({
          teamId: pm.teamId,
          type: 'card_expired',
          contentKey: 'card.expired',
          title: 'Your saved card has expired',
          message: `Your ${pm.brand} card ending ${pm.last4} has expired. Add a new card to keep `
            + 'pay-as-you-go and automatic top-ups working.',
          metadata: { brand: pm.brand, last4: pm.last4 },
          priority: 'high',
        });
        continue;
      }

      const daysUntilExpiry = pm.daysUntilExpiry(now);
      const threshold = schedule.dueExpiryWarning({
        daysUntilExpiry, warningDays, lastWarnedDays: pm.lastExpiryWarningDays,
      });

      if (threshold !== null) {
        await notifyCustomer({
          teamId: pm.teamId,
          type: 'card_expiring',
          contentKey: 'card.expiring',
          title: 'Your saved card is expiring soon',
          message: `Your ${pm.brand} card ending ${pm.last4} expires in ${daysUntilExpiry} day(s). `
            + 'Add a new card before then to avoid an interruption.',
          metadata: { brand: pm.brand, last4: pm.last4, days: daysUntilExpiry },
          priority: threshold <= 7 ? 'high' : 'medium',
        });
        await paymentMethodService.markExpiryWarned(pm.id, threshold);
        warned += 1;
      }
    } catch (err) {
      console.error(`[CRON] cardExpiry error for payment method ${pm.id}:`, err.message);
    }
  }

  console.log(`[CRON] Card expiry: ${warned} warned, ${expired} expired`);
};

/** Flag a deployment that has sat un-provisioned too long for admin attention. */
const runStaleProvisioningCheck = async (settings, now) => {
  const cutoff = new Date(now.getTime() - (settings.staleProvisioningDays || 3) * schedule.MS_PER_DAY);

  const stale = await deploymentService.listStaleProvisioning(cutoff);

  for (const deployment of stale) {
    try {
      const days = Math.floor((now.getTime() - new Date(deployment.createdAt).getTime()) / schedule.MS_PER_DAY);
      await adminNotifier.notifyStaleProvisioning(deployment, days);
      deployment.staleProvisioningNotifiedAt = now;
      await deployment.save();
    } catch (err) {
      console.error(`[CRON] staleProvisioning error for deployment ${deployment.id}:`, err.message);
    }
  }

  if (stale.length) console.log(`[CRON] Stale provisioning: flagged ${stale.length} deployment(s)`);
};

const run = async () => {
  const settings = await billingModeService.getBillingSettings();
  const now = new Date();

  await processDebtAccounts(settings, now);
  await runStorageGrace(settings, now);
  await runCardExpiryCheck(settings, now);
  await runStaleProvisioningCheck(settings, now);
};

module.exports = { run };
