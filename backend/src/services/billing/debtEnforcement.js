/**
 * Stopping machines when an account is past the platform's debt limits.
 *
 * ── Why this is its own module ──
 *
 * The rule itself (`debtService.evaluateDebtStatus`) was always correct: a
 * customer is blocked when their outstanding balance is over the credit limit
 * OR when it has gone unpaid for longer than the age limit. Either one is
 * enough; the two are independent.
 *
 * What was wrong was *when* that rule got acted on. Debt accrues in the
 * billing job, which runs every ten minutes, but the only thing that paused an
 * over-limit account was the debt-collection cron, which runs once a day. So
 * the limit was real but up to 24 hours late: an account that crossed a USD
 * 1,000 limit just after the nightly run kept billing until the next one. On
 * three pay-as-you-go deployments at about USD 20/hr that is roughly USD 500 a
 * day of further debt, and it is how a USD 1,000 limit produced a USD 2,766
 * balance.
 *
 * The enforcement therefore belongs next to the accrual, not next to the
 * collection. This module holds it once so both jobs run exactly the same
 * action — the billing job to stop the bleeding within a tick, and debt
 * collection to catch anything that changed between ticks (an admin
 * adjustment, a failed card charge that pushed an account over).
 *
 * Nothing here forgives money. The hours already consumed are billed and owed
 * either way; the limit governs how much further a customer may go before the
 * hardware stops, not whether they pay for what they used.
 */
const debtService = require('./debtService');
const deploymentService = require('../deployment/deploymentService');

/**
 * Pause everything this customer has running once their outstanding balance
 * passes the platform's limit or its age — prepaid included, not just
 * pay-as-you-go. Both methods bill the full elapsed period and send whatever
 * the wallet cannot cover to the same outstanding balance, so both are capable
 * of putting an account over the line and both have to stop when it does.
 */
const pauseRunningForBlockedAccount = async (teamId, status, now) => {
  const running = await deploymentService.listRunningForTeam(teamId);

  let count = 0;
  for (const deployment of running) {
    try {
      await deploymentService.transition(deployment, 'paused', {
        note: `Automatically paused — outstanding balance exceeded the platform's debt limit (${status.reason})`,
        enforcement: true,
        // Its own flag, not autoSuspendedForCredit — that one is wired to
        // resumeCreditSuspended, which every payment webhook calls
        // unconditionally on ANY top-up. Reusing it here let a $1 payment
        // wake a deployment back up while the account was still thousands
        // over the debt limit. debtLimitSuspended only clears once
        // debtService says this account is back under the limit — see
        // deploymentService.resumeDebtLimitSuspended.
        debtLimitSuspended: true,
        at: now,
      });

      // Two keys instead of one sentence with a conditional clause spliced into
      // it: a mid-sentence substitution only works in languages whose word
      // order matches English, and Urdu's does not.
      //
      // About the account's money, so it goes to the members who handle it
      // (and the deployment's creator only if their role may see money).
      await deploymentService.notifyCustomer(deployment, {
        type: 'deployment_suspended',
        contentKey: status.reason === 'CREDIT_LIMIT_EXCEEDED'
          ? 'debt.pausedOverLimit'
          : 'debt.pausedTooOld',
        title: 'Deployment paused — outstanding balance',
        message: `"${deployment.deploymentName}" was paused because your outstanding balance has gone `
          + `${status.reason === 'CREDIT_LIMIT_EXCEEDED' ? "above the platform's limit" : 'unpaid for too long'}. `
          + 'Settle it to resume.',
        priority: 'urgent',
        money: true,
      });

      count += 1;
    } catch (err) {
      console.error(`[CRON] Could not pause over-limit deployment ${deployment.id}:`, err.message);
    }
  }
  return count;
};

/**
 * Check a set of accounts and stop the ones now over a limit.
 *
 * Deduplicated by customer: the billing job walks deployments, and one account
 * with four machines must be evaluated once, not four times. The status is read
 * after billing has been written, so it reflects the debt this tick just
 * created rather than the figure from before it.
 *
 * A customer who is within both limits either stays untouched, or — if they
 * were previously paused for crossing the limit and have since paid it down
 * — gets those deployments resumed. This is what makes the limit symmetric:
 * it used to only ever get enforced on the way up (a webhook resumed on any
 * top-up regardless of whether the debt was actually cleared); now the same
 * pass that pauses an over-limit account also resumes one that has settled
 * back under it, without needing a payment webhook to fire.
 */
const enforceForTeams = async (teamIds, { settings, now = new Date() } = {}) => {
  let paused = 0;
  let resumed = 0;
  let blockedAccounts = 0;

  for (const teamId of new Set((teamIds || []).filter(Boolean).map(String))) {
    try {
      const status = await debtService.status(teamId, { settings, now });
      if (status.blocked) {
        blockedAccounts += 1;
        paused += await pauseRunningForBlockedAccount(teamId, status, now);
      } else {
        resumed += (await deploymentService.resumeDebtLimitSuspended(teamId, { settings, now })).length;
      }
    } catch (err) {
      // One unreadable wallet must not stop the rest of the sweep — and must
      // not be silent either, or an account sits over its limit unnoticed.
      console.error(`[CRON] Could not evaluate debt limits for account ${teamId}:`, err.message);
    }
  }

  return { paused, resumed, blockedAccounts };
};

module.exports = { pauseRunningForBlockedAccount, enforceForTeams };
