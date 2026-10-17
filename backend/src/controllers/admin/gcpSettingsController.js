/**
 * GCP Settings Controller
 *
 * Mirrors polarSettingsController.js exactly — same super-admin gate, same
 * "only overwrite a secret when a new non-empty value is sent" rule, same
 * cache-clear plus activity-log shape. Following that file rather than
 * inventing a shape means an admin's muscle memory, and the next reader's,
 * both still work.
 *
 * Two things here are deliberately NOT like its sibling:
 *
 *  - **The key is encrypted at rest.** Stripe's and Polar's secrets sit as
 *    plaintext in the settings JSON. This one can create and destroy machines
 *    that cost money by the hour, so it goes through `cryptoHelper.encrypt`
 *    first. That is a deliberate exception, not an oversight; the comment in
 *    adminSettingsDefaults.js says why.
 *  - **Nothing here can be made dangerous by a typo.** Turning GCP on does not
 *    start creating machines: `dryRun` has to be turned off and a team has to
 *    be on the allowlist as well. Three separate switches, because the failure
 *    mode is spending real money with nobody watching.
 */
const adminSettingsService = require('../../services/admin/adminSettingsService');
const activityLogService = require('../../services/admin/activityLogService');
const cryptoHelper = require('../../utils/helpers/cryptoHelper');
const { getClientIP } = require('../../utils/helpers/ipHelper');

/** What may be shown back to a client. The key is never in here. */
const safeView = (gcp = {}) => ({
  enabled: !!gcp.enabled,
  projectId: gcp.projectId || '',
  // Which key is loaded, without the key. An operator needs to tell "the right
  // key" from "a key" after a rotation, and the service-account email is the
  // part that answers that and is not itself a secret.
  serviceAccountEmail: gcp.serviceAccountEmail || '',
  hasServiceAccountKey: !!gcp.serviceAccountKeyEncrypted,
  customerServiceAccount: gcp.customerServiceAccount || '',
  network: gcp.network || '',
  environment: gcp.environment || '',
  dryRun: gcp.dryRun !== false,
  dryRunRunningAfterSeconds: Number(gcp.dryRunRunningAfterSeconds) || 45,
  maxConcurrentInstancesPerTeam: Number(gcp.maxConcurrentInstancesPerTeam) || 0,
  maxConcurrentInstancesPlatform: Number(gcp.maxConcurrentInstancesPlatform) || 0,
  enforceMarginGuard: gcp.enforceMarginGuard !== false,
  // Not a secret, and an operator has to see what is recorded to know what is
  // missing — a margin guard whose inputs are invisible is a margin guard
  // nobody can fix.
  machineCostPerHour: gcp.machineCostPerHour && typeof gcp.machineCostPerHour === 'object'
    ? gcp.machineCostPerHour
    : {},
  requestTimeoutSeconds: Number(gcp.requestTimeoutSeconds) || 30,
});

/**
 * PUT /api/v1/admin/settings/gcp
 */
const updateGcp = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can update Google Cloud settings' });
    }

    const {
      enabled, projectId, serviceAccountKey, customerServiceAccount, network, environment,
      dryRun, dryRunRunningAfterSeconds,
      maxConcurrentInstancesPerTeam, maxConcurrentInstancesPlatform,
      enforceMarginGuard, requestTimeoutSeconds, machineCostPerHour,
    } = req.body;

    const settings = await adminSettingsService.getSettings();
    if (!settings.gcpSettings) settings.gcpSettings = {};
    const gcp = settings.gcpSettings;

    if (projectId !== undefined) gcp.projectId = String(projectId).trim();
    if (customerServiceAccount !== undefined) gcp.customerServiceAccount = String(customerServiceAccount).trim();
    if (network !== undefined) gcp.network = String(network).trim();
    if (environment !== undefined) gcp.environment = String(environment).trim();
    if (enabled !== undefined) gcp.enabled = !!enabled;
    if (dryRun !== undefined) gcp.dryRun = !!dryRun;
    if (enforceMarginGuard !== undefined) gcp.enforceMarginGuard = !!enforceMarginGuard;

    const positiveInt = (v, fallback) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    if (dryRunRunningAfterSeconds !== undefined) {
      gcp.dryRunRunningAfterSeconds = positiveInt(dryRunRunningAfterSeconds, 45);
    }
    if (maxConcurrentInstancesPerTeam !== undefined) {
      gcp.maxConcurrentInstancesPerTeam = positiveInt(maxConcurrentInstancesPerTeam, 3);
    }
    if (maxConcurrentInstancesPlatform !== undefined) {
      gcp.maxConcurrentInstancesPlatform = positiveInt(maxConcurrentInstancesPlatform, 25);
    }
    if (requestTimeoutSeconds !== undefined) {
      gcp.requestTimeoutSeconds = Math.min(300, Math.max(5, positiveInt(requestTimeoutSeconds, 30)));
    }
    /*
     * The cost table, which is the margin guard's only input.
     *
     * Sanitised rather than trusted: a key that is not a machine type, or a
     * value that is not a number, would make the guard refuse every build with
     * a message nobody can act on. An unparseable value is dropped, which
     * leaves the cost unknown — and unknown is already a refusal, so a typo
     * fails safe instead of reading as free.
     */
    if (machineCostPerHour !== undefined) {
      const table = {};
      const source = machineCostPerHour && typeof machineCostPerHour === 'object' ? machineCostPerHour : {};
      for (const [rawType, rawCost] of Object.entries(source)) {
        const type = String(rawType).trim();
        // GCP machine types are lowercase letters, digits and hyphens.
        if (!type || !/^[a-z0-9-]{1,64}$/.test(type)) continue;
        const cost = Number(rawCost);
        if (!Number.isFinite(cost) || cost < 0) continue;
        table[type] = cost;
      }
      gcp.machineCostPerHour = table;
    }

    /*
     * The key. Same rule as every other secret on this platform — an empty
     * field means "leave what is stored alone", so re-saving the form without
     * pasting the key again does not wipe it.
     *
     * Validated before it is stored: a key that cannot be parsed is a key that
     * will fail at the worst moment, on a customer's first deployment, with an
     * error nobody connects back to this screen.
     */
    let keyChanged = false;
    if (serviceAccountKey && String(serviceAccountKey).trim()) {
      const raw = String(serviceAccountKey).trim();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return res.status(400).json({
          success: false,
          message: 'That is not valid JSON. Paste the whole service-account key file, including the braces.',
        });
      }
      if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
        return res.status(400).json({
          success: false,
          message: 'That JSON is not a service-account key — it needs "type": "service_account", a client_email and a private_key.',
        });
      }
      if (gcp.projectId && parsed.project_id && parsed.project_id !== gcp.projectId) {
        return res.status(400).json({
          success: false,
          message: `That key belongs to project "${parsed.project_id}" but this platform is configured for "${gcp.projectId}". `
            + 'Fix one of the two before saving.',
        });
      }

      gcp.serviceAccountKeyEncrypted = cryptoHelper.encrypt(raw);
      gcp.serviceAccountEmail = parsed.client_email;
      if (!gcp.projectId && parsed.project_id) gcp.projectId = parsed.project_id;
      keyChanged = true;
    }

    settings.lastUpdatedBy = req.userId;
    settings.markModified('gcpSettings');
    await settings.save();

    // The client caches credentials; the next call must re-read them.
    try {
      require('../../services/gcp/gcpClient').clearCache();
    } catch { /* the client is optional at this point in the rollout */ }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Google Cloud provisioning settings updated',
      metadata: {
        projectId: gcp.projectId || '(unset)',
        enabled: gcp.enabled,
        // The two that decide whether real money can be spent, recorded on
        // every change so "when did this platform start creating machines" has
        // an answer. Per-account exceptions live on the account, not here.
        dryRun: gcp.dryRun,
        serviceAccountKey: keyChanged ? '***set***' : '(unchanged)',
      },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: 'Google Cloud settings saved',
      gcpSettings: safeView(gcp),
    });
  } catch (error) {
    console.error('Update GCP settings error:', error);
    res.status(500).json({ success: false, message: 'Error updating Google Cloud settings' });
  }
};

/**
 * POST /api/v1/admin/settings/gcp/test
 *
 * Proves the credentials work without creating anything. Separate from saving
 * so an operator can check a key that is already stored, and so a save is never
 * blocked by a network problem.
 */
const testGcp = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can test the Google Cloud connection' });
    }

    const gcpClient = require('../../services/gcp/gcpClient');
    gcpClient.clearCache();
    const result = await gcpClient.testConnection();

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'read',
      targetModel: 'Settings',
      description: `Google Cloud connection test: ${result.message}`,
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({ success: true, ...result });
  } catch (error) {
    // A failed test is information, not a server fault — the message is the
    // whole point of pressing the button.
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  updateGcp,
  testGcp,
  safeView,
};
