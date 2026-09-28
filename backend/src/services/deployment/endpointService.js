/**
 * Endpoint Service
 *
 * Owns a deployment's credentials for its whole life: issuing them, taking them
 * away when the deployment stops earning, destroying them when it dies, and
 * handing them back when it legitimately resumes.
 *
 * ── Why this exists ──
 *
 * Until now, stopping a deployment changed its status and nothing else. The
 * endpoint URL and API key were left exactly as they were, so a customer whose
 * credit ran out was "paused" only in our database — their key kept working,
 * and they could keep consuming inference indefinitely while we billed them for
 * storage alone. Every other billing guarantee rests on "paused means the
 * customer is not consuming compute", and that was simply not true.
 *
 * ── Suspend vs revoke ──
 *
 * A pause is reversible, so it SUSPENDS: the key stays encrypted at rest but
 * stops working, and the customer gets it back on resume. A terminated,
 * rejected or failed deployment is not coming back, so it REVOKES: the
 * ciphertext is destroyed outright. There is no path from revoked to working —
 * a new key has to be issued.
 *
 * ── Rotation ──
 *
 * Coming back from an *enforcement* suspension rotates the key, because while
 * it was suspended we could not prove the old one wasn't being used. A customer
 * who paused their own work overnight keeps their key, and their integration
 * keeps working. That distinction is `suspendedForEnforcement`, and the
 * behaviour is an admin setting.
 *
 * ── What this can and cannot do ──
 *
 * It changes OUR records. Whether the customer's traffic actually stops depends
 * on the provisioning driver, and today that driver is a human. So every action
 * that must reach hardware raises `endpoint.shutdownRequired`, which surfaces in
 * the admin fulfilment queue until somebody confirms the machine is off. That
 * flag is the honest part: we do not claim an endpoint is down until a person
 * or a real driver says it is.
 */
const activityLogService = require('../admin/activityLogService');
const adminSettingsService = require('../admin/adminSettingsService');
const { cryptoHelper } = require('../../utils/helpers');
const provisioningDriver = require('./provisioningDriver');

// Statuses duplicated from the Deployment model rather than required, so this
// pure section has zero dependencies and can be tested with a plain object —
// no schema, no database, no connection.
const ACCESS_STATUSES = ['running'];
const STORAGE_BILLABLE_STATUSES = ['paused', 'stopped'];
const TERMINAL_STATUSES = ['terminated', 'rejected', 'failed'];

/**
 * ── The decision, with no I/O in it ──
 *
 * Given a deployment's current endpoint state and the status it is moving to,
 * what should happen to its credentials? Nothing here touches a database, the
 * clock, or the provisioning driver — it only classifies the transition, the
 * same way `planCharge` in deploymentBilling.js turned "how much do we bill"
 * into pure arithmetic so every case could be asserted directly rather than
 * only exercised end-to-end.
 *
 * `rotateOnEnforcedResume` is passed in rather than read from AdminSettings
 * here, for the same reason: a resolved boolean is testable, a database read
 * is not.
 *
 * @param {object} endpoint    the deployment's current `endpoint` sub-document
 * @param {string} newStatus   the status it is transitioning to
 * @param {object} [opts]
 * @param {boolean} [opts.enforcement]           true when this suspension is us
 *   acting (out of credit, admin action), not the customer choosing to pause
 * @param {boolean} [opts.rotateOnEnforcedResume] the resolved admin setting
 * @returns {{kind: 'none'|'revoke'|'suspend'|'restore', hadCredentials: boolean,
 *   alreadyThere: boolean, wasEnforced: boolean, keyDestroyed: boolean,
 *   shouldRotate: boolean}}
 */
const decideEndpointAction = (endpoint, newStatus, opts = {}) => {
  const { enforcement = false, rotateOnEnforcedResume = true } = opts;

  const hadCredentials = !!(endpoint?.apiKeyEncrypted || endpoint?.url);
  const wasEnforced = !!endpoint?.suspendedForEnforcement;
  const keyDestroyed = !endpoint?.apiKeyEncrypted;

  const none = {
    kind: 'none', hadCredentials, alreadyThere: false, wasEnforced, keyDestroyed, shouldRotate: false,
  };

  // A deployment that was never provisioned has nothing to take away and no
  // hardware task to raise — whatever status it moves to.
  if (!hadCredentials) return none;

  if (TERMINAL_STATUSES.includes(newStatus)) {
    return { ...none, kind: 'revoke' };
  }

  if (ACCESS_STATUSES.includes(newStatus)) {
    // Enforcement always rotates when the setting allows it; a destroyed key
    // (coming back from termination is impossible in practice, but a key
    // cleared some other way) is rotated regardless of the setting, because
    // there is no ciphertext to hand back at all.
    const shouldRotate = keyDestroyed || (wasEnforced && rotateOnEnforcedResume);
    return { ...none, kind: 'restore', shouldRotate };
  }

  if (STORAGE_BILLABLE_STATUSES.includes(newStatus)) {
    return { ...none, kind: 'suspend', alreadyThere: endpoint?.active === false };
  }

  // pending_review / approved / provisioning: on the way to running, nothing
  // has been earned or taken away yet.
  return none;
};

/** Never let an audit-log failure break a status change. */
const logEndpointAction = async (deployment, actor, description, metadata = {}) => {
  try {
    await activityLogService.logActivity({
      userId: actor?.id || deployment.userId,
      userName: actor?.name || 'System',
      userEmail: actor?.email || 'system@platform.local',
      userRole: actor?.role || 'system',
      action: 'deployment_endpoint_set',
      actionType: 'update',
      targetModel: 'Deployment',
      targetId: deployment.id,
      targetName: deployment.deploymentName,
      description,
      metadata,
      status: 'success',
    });
  } catch (err) {
    console.error('[Endpoint] Failed to write activity log:', err.message);
  }
};

/** Is there anything to take away? A deployment never provisioned has nothing. */
const hasCredentials = (deployment) =>
  !!(deployment.endpoint?.apiKeyEncrypted || deployment.endpoint?.url);

/**
 * Ask the driver to act on the hardware and record whether a human still has to.
 *
 * `shutdownRequired` is only ever raised here, and only when the driver says it
 * cannot finish the job itself. A real driver that reports success clears the
 * flag, so switching one on in Phase 2 empties the queue rather than leaving a
 * permanent backlog behind.
 */
const applyToHardware = async (deployment, action) => {
  const result = await provisioningDriver.run(action, deployment);

  if (result.requiresHumanAction) {
    deployment.endpoint.shutdownRequired = true;
    deployment.endpoint.shutdownRequestedAt = new Date();
    deployment.endpoint.shutdownCompletedAt = null;
    deployment.endpoint.shutdownCompletedBy = null;
  } else if (result.ok) {
    deployment.endpoint.shutdownRequired = false;
    deployment.endpoint.shutdownCompletedAt = new Date();
  }

  return result;
};

/**
 * Cut off access to a deployment that has stopped earning, keeping the key so
 * it can be given back.
 *
 * @param {Deployment} deployment
 * @param {object}  [options]
 * @param {string}  [options.reason]      shown to the admin and logged
 * @param {boolean} [options.enforcement] true when this is us acting, not the customer
 * @param {object}  [options.actor]
 * @param {boolean} [options.save]        persist (default true; the status
 *                                        machine passes false and saves once)
 */
const suspend = async (deployment, options = {}) => {
  const { reason = '', enforcement = false, actor = null, save = true } = options;

  const plan = decideEndpointAction(deployment.endpoint, 'paused', { enforcement });

  // Nothing was ever issued — no access to take away, and no hardware task to
  // raise for a machine that was never built.
  if (!plan.hadCredentials) return { changed: false, driver: null };

  const alreadySuspended = plan.alreadyThere;

  deployment.endpoint.active = false;
  deployment.endpoint.suspendedAt = deployment.endpoint.suspendedAt || new Date();
  deployment.endpoint.suspendReason = reason;
  // Latches on: a customer pause that follows an enforcement suspension must
  // not quietly downgrade it into one that hands the old key straight back.
  deployment.endpoint.suspendedForEnforcement =
    deployment.endpoint.suspendedForEnforcement || enforcement;

  const result = await applyToHardware(deployment, 'suspend');

  if (save) await deployment.save();

  if (!alreadySuspended) {
    await logEndpointAction(
      deployment,
      actor,
      `Endpoint access suspended for "${deployment.deploymentName}"${reason ? ` — ${reason}` : ''}`,
      { enforcement, driver: result.driver, requiresHumanAction: !!result.requiresHumanAction }
    );
  }

  return { changed: !alreadySuspended, ...result };
};

/**
 * Destroy a deployment's credentials for good.
 *
 * The ciphertext is cleared rather than merely flagged, so there is no stored
 * secret left to leak and no code path that could hand it back. The mask is
 * kept: the customer and the admin should still be able to see *which* key was
 * revoked when reading the history.
 */
const revoke = async (deployment, options = {}) => {
  const { reason = '', actor = null, save = true } = options;

  const plan = decideEndpointAction(deployment.endpoint, 'terminated', {});
  if (!plan.hadCredentials) return { changed: false, driver: null };

  const had = !plan.keyDestroyed;

  deployment.endpoint.active = false;
  deployment.endpoint.apiKeyEncrypted = '';
  deployment.endpoint.revokedAt = new Date();
  deployment.endpoint.revokeReason = reason;
  deployment.endpoint.keyVersion = (deployment.endpoint.keyVersion || 1) + 1;

  const result = await applyToHardware(deployment, 'terminate');

  if (save) await deployment.save();

  await logEndpointAction(
    deployment,
    actor,
    `Endpoint credentials revoked for "${deployment.deploymentName}"${reason ? ` — ${reason}` : ''}`,
    { hadKey: had, driver: result.driver, requiresHumanAction: !!result.requiresHumanAction }
  );

  return { changed: true, ...result };
};

/**
 * Issue a fresh API key, replacing whatever was there.
 *
 * Returns the plaintext exactly once — it is never readable again except
 * through the customer's own reveal route, which decrypts it on demand.
 */
const rotateKey = async (deployment, options = {}) => {
  const { actor = null, save = true, reason = '' } = options;

  const apiKey = cryptoHelper.generateApiKey();
  deployment.endpoint.apiKeyEncrypted = cryptoHelper.encrypt(apiKey);
  deployment.endpoint.apiKeyMasked = cryptoHelper.mask(apiKey);
  deployment.endpoint.keyVersion = (deployment.endpoint.keyVersion || 1) + 1;
  deployment.endpoint.revokedAt = null;
  deployment.endpoint.revokeReason = '';

  if (save) await deployment.save();

  await logEndpointAction(
    deployment,
    actor,
    `API key rotated for "${deployment.deploymentName}"${reason ? ` — ${reason}` : ''}`,
    { keyVersion: deployment.endpoint.keyVersion }
  );

  return { apiKey, keyVersion: deployment.endpoint.keyVersion };
};

/**
 * Give access back to a deployment that is legitimately running again.
 *
 * Rotates when the suspension was an enforcement action — see the note at the
 * top of this file. Returns the new key when one was issued so the caller can
 * put it in the "your deployment is live again" notification; the customer
 * would otherwise be left holding a key that silently stopped working.
 */
const resolveRotateSetting = async () => {
  try {
    const settings = await adminSettingsService.getSettings();
    return settings?.deploymentSettings?.rotateKeyOnEnforcedResume !== false;
  } catch {
    // Settings unreadable — rotate, because that is the safe direction.
    return true;
  }
};

const restore = async (deployment, options = {}) => {
  const { actor = null, save = true } = options;

  if (!hasCredentials(deployment)) return { changed: false, rotated: false, apiKey: null };

  const plan = decideEndpointAction(deployment.endpoint, 'running', {
    rotateOnEnforcedResume: await resolveRotateSetting(),
  });

  deployment.endpoint.active = true;
  deployment.endpoint.suspendedAt = null;
  deployment.endpoint.suspendReason = '';
  deployment.endpoint.suspendedForEnforcement = false;

  let apiKey = null;
  if (plan.shouldRotate) {
    ({ apiKey } = await rotateKey(deployment, {
      actor,
      save: false,
      reason: plan.keyDestroyed ? 'reissued after revocation' : 'reissued after enforced suspension',
    }));
  }

  const result = await applyToHardware(deployment, 'resume');

  if (save) await deployment.save();

  await logEndpointAction(
    deployment,
    actor,
    `Endpoint access restored for "${deployment.deploymentName}"`,
    { rotated: !!apiKey, wasEnforced: plan.wasEnforced, driver: result.driver }
  );

  return { changed: true, rotated: !!apiKey, apiKey, ...result };
};

/**
 * An admin confirming they have actually switched the machine off.
 *
 * Deliberately a separate, explicit action rather than something inferred from
 * the status: the whole point of the flag is that our records and the hardware
 * can disagree, so only a human (or a real driver) may close it.
 */
const markShutdownComplete = async (deployment, actor = null) => {
  deployment.endpoint.shutdownRequired = false;
  deployment.endpoint.shutdownCompletedAt = new Date();
  deployment.endpoint.shutdownCompletedBy = actor?.id || null;
  await deployment.save();

  await logEndpointAction(
    deployment,
    actor,
    `Endpoint confirmed shut down for "${deployment.deploymentName}"`
  );

  return deployment;
};

/**
 * Apply whatever a new status implies for credentials. Does not save — the
 * status machine saves once, after everything it changes.
 *
 * Terminal statuses revoke, non-earning statuses suspend, running restores, and
 * anything still on its way to running (pending_review, approved, provisioning)
 * is left alone because there is nothing to take away yet.
 */
const applyStatus = async (deployment, newStatus, options = {}) => {
  const {
    TERMINAL_STATUSES: TERMINAL, ACCESS_STATUSES: ACCESS, STORAGE_BILLABLE_STATUSES: STORAGE_BILLABLE,
  } = require('./deploymentConstants');
  const { actor = null, enforcement = false, note = '' } = options;

  if (TERMINAL.includes(newStatus)) {
    return revoke(deployment, { actor, save: false, reason: note || `deployment ${newStatus}` });
  }

  if (ACCESS.includes(newStatus)) {
    return restore(deployment, { actor, save: false });
  }

  if (STORAGE_BILLABLE.includes(newStatus)) {
    return suspend(deployment, {
      actor,
      save: false,
      enforcement,
      reason: note || `deployment ${newStatus}`,
    });
  }

  return { changed: false };
};

module.exports = {
  suspend,
  revoke,
  restore,
  rotateKey,
  markShutdownComplete,
  applyStatus,
  hasCredentials,
  // Exported purely for testing — see the doc comment above its definition.
  decideEndpointAction,
};
