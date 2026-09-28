/**
 * Provisioning Driver
 *
 * The seam between "what our records say about a deployment" and "what is
 * actually running on hardware".
 *
 * Today the platform is fulfilled by hand: an admin builds the machine, pastes
 * the endpoint and key into the admin center, and emails the customer. That
 * means clearing a flag in our database does not stop anyone's traffic — a
 * person still has to go and switch the thing off. Pretending otherwise is how
 * a customer ends up consuming inference for months after their credit ran out.
 *
 * So the manual driver is honest about it: every action that must reach real
 * hardware returns `requiresHumanAction`, and the caller turns that into a task
 * in the admin fulfilment queue rather than assuming the job is done.
 *
 * When Phase 2 adds real provisioning, it implements the same four methods
 * against an actual API, returns `requiresHumanAction: false`, and nothing else
 * in the codebase changes — the billing job, the status machine and the admin
 * UI already speak through this interface.
 *
 * Which driver is in force is an admin setting, not a constant, so the platform
 * owner can switch a region or an environment over without a deploy.
 *
 * ── The interface every driver implements ──
 *
 *   provision(deployment)  → bring the machine up
 *   suspend(deployment)    → cut the customer's access, keep their disk
 *   resume(deployment)     → restore access after a suspension
 *   terminate(deployment)  → destroy the machine and release the disk
 *
 * Every method resolves to:
 *   { ok, requiresHumanAction, message, detail? }
 *
 * A driver must never throw for an expected failure — return `ok: false` with a
 * message. Callers treat a rejected promise as a bug, not as a business
 * outcome, and will fall back to the safest behaviour (deny access).
 */

/**
 * The default driver: we cannot reach the hardware, so say so plainly.
 *
 * Note that every action reports `ok: true`. That is not a claim the machine
 * changed — it is a claim that the driver did everything it could, which is to
 * hand the work to a human. The `requiresHumanAction` flag is the part callers
 * act on.
 */
const manualDriver = {
  name: 'manual',
  canReachHardware: false,

  async provision(deployment) {
    return {
      ok: true,
      requiresHumanAction: true,
      message: `Build the machine for "${deployment.deploymentName}" and record its endpoint.`,
    };
  },

  async suspend(deployment) {
    return {
      ok: true,
      requiresHumanAction: true,
      message:
        `Shut off the endpoint for "${deployment.deploymentName}". Its API key has been `
        + 'revoked in our records, but the live endpoint must be stopped by hand.',
    };
  },

  async resume(deployment) {
    return {
      ok: true,
      requiresHumanAction: true,
      message: `Bring the endpoint for "${deployment.deploymentName}" back online.`,
    };
  },

  async terminate(deployment) {
    return {
      ok: true,
      requiresHumanAction: true,
      message:
        `Destroy the machine for "${deployment.deploymentName}" and release its disk. `
        + 'Its credentials have been destroyed in our records.',
    };
  },
};

const DRIVERS = {
  manual: manualDriver,
};

/**
 * Resolve the driver the platform owner has selected.
 *
 * Falls back to `manual` for anything unknown — including a settings read that
 * fails — because the manual driver is the one that assumes least. Guessing
 * that some automated driver is present when it isn't would silently drop the
 * human task and leave endpoints running.
 */
const getDriver = async () => {
  try {
const adminSettingsService = require('../admin/adminSettingsService');
    const settings = await adminSettingsService.getSettings();
    const name = settings?.deploymentSettings?.provisioningDriver || 'manual';
    return DRIVERS[name] || manualDriver;
  } catch (err) {
    console.error('[Provisioning] Could not resolve driver, using manual:', err.message);
    return manualDriver;
  }
};

/**
 * Run one driver action without ever letting it break the caller.
 *
 * A status transition must not fail because the hardware layer had a bad
 * minute — but the failure also must not vanish, or an endpoint stays up with
 * nobody knowing. So an exception is converted into "not ok, and a human needs
 * to look at this", which is exactly how a real failure should be treated.
 */
const run = async (action, deployment) => {
  const driver = await getDriver();

  if (typeof driver[action] !== 'function') {
    return {
      ok: false,
      requiresHumanAction: true,
      message: `Driver "${driver.name}" cannot ${action} — do it by hand.`,
    };
  }

  try {
    const result = await driver[action](deployment);
    return { driver: driver.name, ...result };
  } catch (err) {
    console.error(`[Provisioning] ${driver.name}.${action} failed:`, err.message);
    return {
      driver: driver.name,
      ok: false,
      requiresHumanAction: true,
      message: `Automatic ${action} failed (${err.message}) — do it by hand.`,
    };
  }
};

module.exports = {
  DRIVERS,
  getDriver,
  run,
  manualDriver,
};
