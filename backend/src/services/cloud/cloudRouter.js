/**
 * Cloud Router
 *
 * Which cloud does this deployment belong on?
 *
 * ── The one rule that matters more than the others ──
 *
 * **The answer is decided once, at creation, and frozen onto the deployment.**
 * Every later question — suspend it, resume it, terminate it, reconcile it —
 * reads the frozen answer, never re-derives it.
 *
 * That is not tidiness. An admin moving a model from AWS to Google tomorrow is
 * a normal thing to do, and if `terminate` re-derived the cloud it would send
 * the destroy order to Google for a machine living in AWS. Google would
 * cheerfully report "no such instance", the platform would mark it gone, and
 * the AWS machine would keep running and keep billing with nothing on this
 * platform watching it. A leaked machine is the most expensive bug this
 * codebase can produce, and re-deriving the route is the straightest road to
 * one.
 *
 * ── What decides a new deployment's cloud ──
 *
 * In order, first answer wins:
 *
 *   1. The model's own assignment. "Kimi K3 runs on AWS" is a deliberate
 *      choice an admin made; it beats everything else.
 *   2. The default cloud, for models nobody has assigned.
 *   3. The only cloud that is switched on, when there is exactly one — so a
 *      platform using a single cloud never has to set a default at all.
 *   4. Nothing: the manual queue.
 *
 * ── Why an assigned-but-disabled cloud goes to the queue ──
 *
 * If a model is pinned to AWS and AWS is switched off, this does **not** quietly
 * send it to Google. The admin pinned it for a reason — a tier that only exists
 * there, a licence, a region — and the other cloud may not even be able to
 * build it. Silently substituting one cloud for another is the kind of helpful
 * guess that produces a machine nobody asked for. It goes to a human instead.
 *
 * Pure: no database, no network, no clock. `resolve()` is the shell that
 * gathers the inputs.
 */

/** Every cloud this platform knows how to run machines on. */
const CLOUDS = ['gcp', 'aws'];

/** The answer when no cloud can take it: a person builds it by hand. */
const MANUAL = 'manual';

const CODES = {
  ROUTED: 'ROUTED',
  MODEL_PINNED: 'MODEL_PINNED',
  DEFAULT_CLOUD: 'DEFAULT_CLOUD',
  ONLY_CLOUD: 'ONLY_CLOUD',
  PINNED_CLOUD_OFF: 'PINNED_CLOUD_OFF',
  NO_CLOUD_ENABLED: 'NO_CLOUD_ENABLED',
  DEFAULT_CLOUD_OFF: 'DEFAULT_CLOUD_OFF',
  AMBIGUOUS: 'AMBIGUOUS',
  PROVISIONING_OFF: 'PROVISIONING_OFF',
};

const isCloud = (name) => CLOUDS.includes(String(name || '').trim());

/**
 * Which clouds are switched on right now.
 *
 * Read from each cloud's own settings block rather than from one combined
 * list, because the switch that decides whether Google builds machines is the
 * same switch an operator sees on the Google Cloud page. One place per cloud,
 * and no second list to fall out of step with it.
 */
const enabledClouds = (settings) => {
  const out = [];
  if (settings?.gcpSettings?.enabled) out.push('gcp');
  if (settings?.awsSettings?.enabled) out.push('aws');
  return out;
};

/**
 * Decide the cloud for a NEW deployment.
 *
 * @param {object} input
 * @param {string|null} input.modelCloud   the model's own assignment, or null
 * @param {string[]}    input.enabled      clouds switched on
 * @param {string|null} input.defaultCloud the platform default, or null
 * @param {boolean}     [input.provisioningEnabled] the platform-wide kill
 *   switch. False sends everything to the queue regardless of the rest.
 *
 * @returns {{cloud: string, code: string, reason: string}}
 *   `cloud` is a cloud name or `'manual'`. Never null, never undefined — a
 *   caller that forgets to check a flag still gets a safe answer.
 */
const decide = (input) => {
  const {
    modelCloud = null,
    enabled = [],
    defaultCloud = null,
    provisioningEnabled = true,
  } = input || {};

  const on = Array.isArray(enabled) ? enabled.filter(isCloud) : [];

  if (!provisioningEnabled) {
    return {
      cloud: MANUAL,
      code: CODES.PROVISIONING_OFF,
      reason: 'Automatic provisioning is switched off platform-wide, so this goes to the fulfilment queue.',
    };
  }

  if (on.length === 0) {
    return {
      cloud: MANUAL,
      code: CODES.NO_CLOUD_ENABLED,
      reason: 'No cloud is switched on, so deployments go to the fulfilment queue.',
    };
  }

  // ── 1. The model's own assignment ──
  const pinned = isCloud(modelCloud) ? String(modelCloud).trim() : null;
  if (pinned) {
    if (on.includes(pinned)) {
      return {
        cloud: pinned,
        code: CODES.MODEL_PINNED,
        reason: `This model is assigned to ${pinned.toUpperCase()}.`,
      };
    }
    /*
     * Pinned to a cloud that is off. Deliberately NOT re-routed to whatever
     * else happens to be on — see the file header. A human looks at it.
     */
    return {
      cloud: MANUAL,
      code: CODES.PINNED_CLOUD_OFF,
      reason: `This model is assigned to ${pinned.toUpperCase()}, which is switched off. `
        + 'It goes to the fulfilment queue rather than to a different cloud, because the '
        + 'assignment was a deliberate choice and the other cloud may not be able to build it.',
    };
  }

  // ── 2. The platform default ──
  const fallback = isCloud(defaultCloud) ? String(defaultCloud).trim() : null;
  if (fallback) {
    if (on.includes(fallback)) {
      return {
        cloud: fallback,
        code: CODES.DEFAULT_CLOUD,
        reason: `No cloud is assigned to this model, so it uses the default (${fallback.toUpperCase()}).`,
      };
    }
    /*
     * The default is off. Unlike a model pin, this is not a per-model choice —
     * so if exactly one cloud is on, using it is the obviously-intended
     * behaviour rather than a guess.
     */
    if (on.length === 1) {
      return {
        cloud: on[0],
        code: CODES.ONLY_CLOUD,
        reason: `The default cloud (${fallback.toUpperCase()}) is switched off, so this uses `
          + `${on[0].toUpperCase()} — the only one that is on.`,
      };
    }
    /*
     * ── Unreachable while there are only two clouds ──
     *
     * To land here the default has to be a real cloud that is switched OFF,
     * with two or more others switched ON. With `CLOUDS = ['gcp', 'aws']`
     * that cannot happen: two on means both are on, so the default is one of
     * them. A default naming a cloud this build does not know (a removed one,
     * a hand-edited row) fails `isCloud` above and falls through to the
     * ambiguity check instead.
     *
     * Kept rather than deleted because it is the correct answer the day a
     * third cloud is added, and that is exactly the change where the gap
     * would otherwise be noticed last. Flagged here so nobody spends an
     * afternoon trying to reproduce it.
     */
    return {
      cloud: MANUAL,
      code: CODES.DEFAULT_CLOUD_OFF,
      reason: `The default cloud (${fallback.toUpperCase()}) is switched off and more than one other `
        + 'cloud is on, so there is no unambiguous answer. Set a different default.',
    };
  }

  // ── 3. Exactly one cloud on, and no default set ──
  if (on.length === 1) {
    return {
      cloud: on[0],
      code: CODES.ONLY_CLOUD,
      reason: `${on[0].toUpperCase()} is the only cloud switched on.`,
    };
  }

  /*
   * More than one cloud on and nothing says which. Refusing beats picking: a
   * coin toss here would spread one customer's machines across two clouds for
   * no reason anybody could later explain.
   */
  return {
    cloud: MANUAL,
    code: CODES.AMBIGUOUS,
    reason: `${on.length} clouds are switched on but no default is set and this model is not `
      + 'assigned to one. Set a default cloud, or assign this model to a cloud.',
  };
};

/**
 * The cloud a deployment that ALREADY EXISTS belongs to.
 *
 * Reads the frozen value and nothing else. A deployment created before this
 * column existed has no value, and the honest answer for it is the manual
 * queue — the same place it was being fulfilled from before.
 *
 * Takes the deployment rather than ids so there is no way to call it without
 * the frozen field in hand.
 */
const cloudOf = (deployment) => {
  const frozen = deployment?.cloudProvider;
  return isCloud(frozen) ? String(frozen).trim() : MANUAL;
};

/**
 * Decide the cloud for a new deployment, gathering the inputs itself.
 *
 * @param {object} opts
 * @param {object} [opts.model]     the AI model row, for its assignment
 * @param {object} [opts.settings]  admin settings, re-read if omitted
 */
const resolve = async (opts = {}) => {
  let settings = opts.settings;
  if (!settings) {
    const adminSettingsService = require('../admin/adminSettingsService');
    settings = await adminSettingsService.getSettings().catch(() => null);
  }

  /*
   * `provisioningDriver` keeps its old meaning as the platform-wide kill
   * switch: 'manual' sends everything to the queue, exactly as it always has.
   * Any other value means "let the router decide", so switching a platform
   * over does not require touching this setting again every time a cloud is
   * added.
   */
  const driverSetting = settings?.deploymentSettings?.provisioningDriver || MANUAL;

  return decide({
    modelCloud: opts.model?.cloudProvider ?? null,
    enabled: enabledClouds(settings),
    defaultCloud: settings?.cloudRoutingSettings?.defaultCloud || null,
    provisioningEnabled: driverSetting !== MANUAL,
  });
};

module.exports = {
  CLOUDS,
  MANUAL,
  CODES,
  isCloud,
  enabledClouds,
  decide,
  cloudOf,
  resolve,
};
