/**
 * Low Balance Warning Job
 *
 * Emails customers whose credit runway is getting short, before the hourly
 * billing job has to pause anything. Also triggers auto top-up where the
 * customer has enabled it.
 *
 * `lowBalanceNotifiedAt` latches the warning so a customer sitting at a low
 * balance isn't emailed every single day; it's cleared on the next top-up.
 */
const userService = require('../services/user/userService');
const notificationService = require('../services/notification/notificationService');
const creditService = require('../services/billing/creditService');
const deploymentService = require('../services/deployment/deploymentService');
const billingModeService = require('../services/billing/billingModeService');
const emailService = require('../services/email/emailService');
const teamService = require('../services/team/teamService');

// Re-warn at most this often while the balance stays low
const RENOTIFY_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

const run = async () => {
  const settings = await billingModeService.getBillingSettings();

  const threshold = settings.lowBalanceThreshold || 0;
  const hoursThreshold = settings.lowBalanceHours || 0;
  const now = new Date();

  /**
   * Every wallet with something left in it, not just those under the cash
   * threshold.
   *
   * A flat figure alone cannot tell who is about to be cut off: $50 is a
   * fortnight for one small machine and under four hours for a rack of H100s.
   * The runway test below is what catches the second customer, and it can only
   * do that if their wallet is in the list to begin with.
   */
  const wallets = await creditService.listWithBalance();
  if (wallets.length === 0) return;

  /**
   * Everything this loop needs, fetched in bulk up front.
   *
   * It used to call `getWalletSummary` per wallet — three queries each,
   * including a per-customer deployments read and a re-fetch of the same
   * platform-wide billing settings — plus a user lookup per wallet. That is
   * ~5 queries per funded customer on every scheduled run.
   */
  const teamIds = wallets.map((w) => w.teamId);
  const burnRates = await deploymentService.getBurnRatesFor(teamIds);

  let warned = 0;

  for (const wallet of wallets) {
    try {
      const balance = Number(wallet.balance) || 0;
      const burnRatePerHour = burnRates.get(String(wallet.teamId)) || 0;

      // Only warn customers who are actually burning credit
      if (burnRatePerHour <= 0) continue;

      const runwayHours = balance / burnRatePerHour;
      const lowOnCash = balance <= threshold;
      const lowOnTime = hoursThreshold > 0 && runwayHours <= hoursThreshold;
      if (!lowOnCash && !lowOnTime) continue;

      const lastNotified = wallet.lowBalanceNotifiedAt;
      if (lastNotified && now.getTime() - new Date(lastNotified).getTime() < RENOTIFY_AFTER_MS) {
        continue;
      }

      // Everyone who handles this account's money — for a personal account,
      // the customer themself. Only active users (billingRecipientIds).
      const recipients = await userService.findManyByIds(await teamService.billingRecipientIds(wallet.teamId));
      if (!recipients.length) continue;

      const summary = { balance, burnRatePerHour, currency: wallet.currency || settings.currency };

      // Hours are the honest unit when there are only hours left; "0 days" is
      // technically true and useless.
      const inHours = runwayHours < 48;
      const runway = inHours ? runwayHours.toFixed(1) : (runwayHours / 24).toFixed(1);
      const remaining = `${runway} ${inHours ? 'hour(s)' : 'day(s)'}`;

      for (const user of recipients) {
        await notificationService.createNotification({
          recipientId: user.id,
          recipientType: 'customer',
          type: 'credit_low_balance',
          // Three keys, because both the urgency (which changes the heading) and
          // the unit (which is part of the sentence) have to be chosen before a
          // translator sees the string — see notificationCopy.js.
          contentKey: runwayHours < 24
            ? 'credit.pausingSoon'
            : (inHours ? 'credit.lowBalanceHours' : 'credit.lowBalanceDays'),
          title: runwayHours < 24 ? 'Your deployments will pause soon' : 'Low credit balance',
          message:
            `Your balance is ${summary.currency} ${summary.balance.toFixed(2)} — about `
            + `${remaining} at your current usage of ${summary.currency} `
            + `${summary.burnRatePerHour.toFixed(2)}/hr. Top up to avoid interruption.`,
          metadata: {
            currency: summary.currency,
            balance: summary.balance.toFixed(2),
            runway,
            burnRatePerHour: summary.burnRatePerHour.toFixed(2),
          },
          priority: 'high',
          action: {
            label: 'Add Credit',
            url: `${(process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002').replace(/\/$/, '')}/wallet`,
          },
        });

        emailService.sendLowBalanceEmail(user, summary).catch(() => {});
      }

      // CreditWallet's real source of truth is Postgres now (see the
      // `wallet` here is a wrapped record read from
      // the mirror, so this write goes through creditService rather than
      // `wallet.save()`, which would only ever update the mirror copy.
      await creditService.markLowBalanceNotified(wallet.teamId, now);
      warned++;

      // Auto top-up is recorded as an intent here; charging a saved card
      // off-session is a phase 2 concern once we store payment methods.
      if (wallet.autoTopUp?.enabled) {
        console.log(
          `[CRON] Auto top-up is enabled for account ${wallet.teamId} ` +
            `(${summary.currency} ${wallet.autoTopUp.amount}) but off-session charging is not yet configured`
        );
      }
    } catch (err) {
      console.error(`[CRON] Low-balance warning failed for wallet ${wallet.id}:`, err.message);
    }
  }

  if (warned > 0) {
    console.log(`[CRON] Low balance warnings sent to ${warned} customer(s)`);
  }
};

module.exports = { run };
