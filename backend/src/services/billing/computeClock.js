/**
 * The compute meter: when a machine starts costing the customer money.
 *
 * ── Why this is one file and not one per cloud ──
 *
 * Every cloud's reconciler needs exactly this, and the rules below are not
 * facts about any provider — they are facts about how this platform charges.
 * A second copy would be a second set of rounding, watermark and idempotency
 * decisions that start identical and drift, and the drift would show up as
 * two customers on two clouds being charged differently for the same hour.
 *
 * ── The three rules, each of which costs money if broken ──
 *
 * 1. **The clock starts when the CLOUD says the machine is running**, at the
 *    cloud's own timestamp — not when this job happened to notice. The job
 *    runs on a schedule; a machine that came up 50 seconds before the pass
 *    would otherwise get those 50 seconds free, every single time.
 *
 * 2. **Starting is idempotent.** A clock already running is left exactly where
 *    it is. Re-planting it moves the watermark forward and writes off every
 *    hour in between.
 *
 * 3. **Stopping settles first.** Clearing the clock is what makes the
 *    deployment stop being billable, so the elapsed time has to be charged
 *    *before* it is cleared. The other order silently gives away the compute
 *    between the last billing pass and the machine stopping.
 */

/**
 * The machine is up: start charging for it.
 *
 * Written through `deploymentService` rather than with a raw Prisma update,
 * because `Deployment` is behind a hand-rolled ORM whose `save()` writes from
 * an in-memory snapshot — a raw update here would be overwritten by the next
 * `save()` anywhere else.
 *
 * @param {string} deploymentId
 * @param {Date|string} runningAt  the CLOUD's timestamp, not ours
 * @param {string} cloud           for the log line only
 */
const start = async (deploymentId, runningAt, { cloud = 'cloud' } = {}) => {
  const deploymentService = require('../deployment/deploymentService');
  const deployment = await deploymentService.findById(deploymentId);
  if (!deployment) return { started: false, reason: 'deployment is gone' };

  if (deployment.computeClockStartedAt) {
    return { started: false, reason: 'already running', at: deployment.computeClockStartedAt };
  }

  /*
   * Never ahead of the present. A clock in the future makes the first billing
   * pass compute negative hours, which reads as a refund.
   *
   * A missing or unparseable timestamp falls back to now rather than to zero:
   * `new Date(undefined)` is Invalid Date, and its getTime() is NaN, which
   * would sail through a naive Math.min and poison the watermark.
   */
  const asked = runningAt ? new Date(runningAt).getTime() : NaN;
  const at = new Date(Number.isFinite(asked) ? Math.min(asked, Date.now()) : Date.now());

  deployment.computeClockStartedAt = at;

  /*
   * The watermark. `deploymentBilling` bills from `lastBilledAt || startedAt`
   * and plants its own watermark at `now` when both are missing — so leaving
   * this unset would give away everything between the machine starting and the
   * first billing pass noticing. Only moved forward, never back.
   */
  if (!deployment.lastBilledAt || new Date(deployment.lastBilledAt) < at) {
    deployment.lastBilledAt = at;
  }
  await deployment.save();

  console.log(`[${cloud}] compute clock started for ${deploymentId} at ${at.toISOString()}`);
  return { started: true, at };
};

/**
 * The machine is down: stop charging compute for it.
 *
 * @param {string} deploymentId
 * @param {Date|string} stoppedAt  the CLOUD's timestamp where known
 * @param {string} cloud           for the log line only
 */
const stop = async (deploymentId, stoppedAt, { cloud = 'cloud' } = {}) => {
  const deploymentService = require('../deployment/deploymentService');
  const deploymentBilling = require('./deploymentBilling');

  const deployment = await deploymentService.findById(deploymentId);
  if (!deployment || !deployment.computeClockStartedAt) return { stopped: false };

  const asked = stoppedAt ? new Date(stoppedAt).getTime() : NaN;
  const at = new Date(Number.isFinite(asked) ? Math.min(asked, Date.now()) : Date.now());

  try {
    // Settle BEFORE clearing — see rule 3 in the header.
    await deploymentBilling.billOutstanding(deployment, { now: at, save: false });
  } catch (err) {
    // Not fatal, and not silent: the watermark has not moved, so the hours are
    // still owed and the next pass bills them — as long as the deployment is
    // still billable by something, which a paused one is.
    console.error(
      `[${cloud}] Could not settle compute before stopping the clock on ${deploymentId}:`,
      err.message,
    );
  }

  deployment.computeClockStartedAt = null;
  await deployment.save();
  return { stopped: true, at };
};

module.exports = { start, stop };
