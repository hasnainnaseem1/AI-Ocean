/**
 * AWS Settings Controller
 *
 * Mirrors `gcpSettingsController.js` exactly — same super-admin gate, same
 * "only overwrite a secret when a new non-empty value is sent" rule, same
 * cache-clear plus activity-log shape. Following that file rather than
 * inventing a shape means an admin's muscle memory, and the next reader's,
 * both still work across the two clouds.
 *
 * Two things here are deliberately the same as its sibling, and worth saying
 * out loud because they are the parts that matter:
 *
 *  - **The secret key is encrypted at rest.** Stripe's and Polar's secrets sit
 *    as plaintext in the settings JSON. This one can create and destroy
 *    machines that cost money by the hour, so it goes through
 *    `cryptoHelper.encrypt` first — the same exception the GCP key gets.
 *  - **Nothing here can be made dangerous by a typo.** Turning AWS on does not
 *    start creating machines: `dryRun` has to be turned off as well, and the
 *    router has to be pointed at AWS. Separate switches, because the failure
 *    mode is spending real money with nobody watching.
 */
const adminSettingsService = require('../../services/admin/adminSettingsService');
const activityLogService = require('../../services/admin/activityLogService');
const cryptoHelper = require('../../utils/helpers/cryptoHelper');
const { getClientIP } = require('../../utils/helpers/ipHelper');
const shape = require('../../services/aws/awsSettingsShape');
const awsRegionMap = require('../../services/aws/awsRegionMap');

/** What may be shown back to a client. The secret is never in here. */
const safeView = (aws = {}) => ({
  enabled: !!aws.enabled,
  accountId: aws.accountId || '',

  /*
   * The access key ID is shown; the secret never is. That asymmetry is correct
   * rather than sloppy: on AWS the key id identifies *which* credential is
   * loaded (the job the service-account email does on the GCP side) and is not
   * itself usable without the secret — see `awsSigner`, where the key id never
   * enters the signature at all.
   */
  accessKeyId: aws.accessKeyId || '',
  hasSecretAccessKey: !!aws.secretAccessKeyEncrypted,

  /*
   * One block per AWS region, because a VPC, security group, subnet and AMI
   * all belong to exactly one region on AWS — unlike Google, where one global
   * network covers every region. See `awsSettingsShape` for the full table.
   *
   * Every region the platform sells is listed, configured or not, so the form
   * shows what is still missing rather than hiding it behind an "add" button.
   */
  regions: Object.fromEntries(
    awsRegionMap.supportedAwsRegions().map((awsRegion) => {
      const built = shape.infraFor(aws, awsRegion);
      const block = shape.normalize(aws).regions?.[awsRegion] || shape.emptyRegion();
      return [awsRegion, {
        ...block,
        ready: built.ok,
        missing: built.ok ? [] : built.missing,
        // Which platform region names route here, so an admin can see that
        // filling this in is what makes "ap-south" sellable.
        platformRegions: Object.entries(awsRegionMap.REGIONS)
          .filter(([, v]) => v.awsRegion === awsRegion)
          .map(([k]) => k),
        azs: Object.values(awsRegionMap.REGIONS)
          .find((v) => v.awsRegion === awsRegion)?.azs || [],
      }];
    })
  ),

  // Global on AWS: one IAM instance profile works in every region, so copying
  // it per region would be several fields that must agree and eventually will
  // not.
  instanceProfile: aws.instanceProfile || '',

  environment: aws.environment || 'staging',

  dryRun: aws.dryRun !== false,
  dryRunRunningAfterSeconds: Number(aws.dryRunRunningAfterSeconds) || 45,

  maxConcurrentInstancesPerTeam: Number(aws.maxConcurrentInstancesPerTeam) || 0,
  maxConcurrentInstancesPlatform: Number(aws.maxConcurrentInstancesPlatform) || 0,

  enforceMarginGuard: aws.enforceMarginGuard !== false,
  // Not a secret, and an operator has to see what is recorded to know what is
  // missing — a margin guard whose inputs are invisible is one nobody can fix.
  machineCostPerHour: aws.machineCostPerHour && typeof aws.machineCostPerHour === 'object'
    ? aws.machineCostPerHour
    : {},

  requestTimeoutSeconds: Number(aws.requestTimeoutSeconds) || 30,
});

/**
 * PUT /api/v1/admin/settings/aws
 */
const updateAws = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can update AWS settings' });
    }

    const {
      enabled, accountId, region, accessKeyId, secretAccessKey,
      regions, vpcId, securityGroupId, subnetIds, instanceProfile, environment,
      dryRun, dryRunRunningAfterSeconds,
      maxConcurrentInstancesPerTeam, maxConcurrentInstancesPlatform,
      enforceMarginGuard, machineCostPerHour, requestTimeoutSeconds,
    } = req.body;

    const settings = await adminSettingsService.getSettings();
    if (!settings.awsSettings) settings.awsSettings = {};
    const aws = settings.awsSettings;

    if (enabled !== undefined) aws.enabled = !!enabled;
    if (instanceProfile !== undefined) aws.instanceProfile = String(instanceProfile).trim();
    if (environment !== undefined) aws.environment = String(environment).trim();
    if (dryRun !== undefined) aws.dryRun = !!dryRun;
    if (enforceMarginGuard !== undefined) aws.enforceMarginGuard = !!enforceMarginGuard;

    if (accountId !== undefined) {
      const id = String(accountId).trim();
      /*
       * Checked rather than trusted. An account id that is not 12 digits is a
       * typo, and the only place it would surface otherwise is the provider's
       * `allowed_account_ids` guard failing at apply time with a message about
       * something else entirely.
       */
      if (id && !/^\d{12}$/.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'An AWS account id is exactly 12 digits.',
        });
      }
      aws.accountId = id;
    }

    if (accessKeyId !== undefined) {
      const id = String(accessKeyId).trim();
      // AWS access key ids are 16-128 uppercase alphanumerics, conventionally
      // starting AKIA (long-lived) or ASIA (temporary).
      if (id && !/^[A-Z0-9]{16,128}$/.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'That does not look like an AWS access key id. They are uppercase letters and '
            + 'digits, usually starting with AKIA.',
        });
      }
      aws.accessKeyId = id;
    }

    const positiveInt = (v, fallback) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    if (dryRunRunningAfterSeconds !== undefined) {
      aws.dryRunRunningAfterSeconds = positiveInt(dryRunRunningAfterSeconds, 45);
    }
    if (maxConcurrentInstancesPerTeam !== undefined) {
      aws.maxConcurrentInstancesPerTeam = positiveInt(maxConcurrentInstancesPerTeam, 3);
    }
    if (maxConcurrentInstancesPlatform !== undefined) {
      aws.maxConcurrentInstancesPlatform = positiveInt(maxConcurrentInstancesPlatform, 25);
    }
    if (requestTimeoutSeconds !== undefined) {
      aws.requestTimeoutSeconds = Math.min(300, Math.max(5, positiveInt(requestTimeoutSeconds, 30)));
    }

    /*
     * The per-region infrastructure, which is the substance of this form.
     *
     * Validated rather than sanitised-by-dropping. The earlier version silently
     * skipped anything that did not match, so a mistyped subnet id vanished
     * without a word and the first sign of it was a customer's launch failing
     * with `InvalidSubnetID.NotFound` — a message that names neither the field
     * nor the form. A refusal that says which field is wrong costs an admin
     * five seconds; the silent version costs an afternoon.
     */
    if (regions !== undefined) {
      const source = regions && typeof regions === 'object' ? regions : {};
      const errors = [];
      const next = { ...(shape.normalize(aws).regions || {}) };

      for (const [rawRegion, rawBlock] of Object.entries(source)) {
        const awsRegion = String(rawRegion).trim();
        const block = rawBlock && typeof rawBlock === 'object' ? rawBlock : {};

        const clean = {
          vpcId: String(block.vpcId || '').trim(),
          securityGroupId: String(block.securityGroupId || '').trim(),
          imageId: String(block.imageId || '').trim(),
          subnetIds: Object.fromEntries(
            Object.entries(block.subnetIds && typeof block.subnetIds === 'object' ? block.subnetIds : {})
              .map(([az, id]) => [String(az).trim(), String(id || '').trim()])
              .filter(([, id]) => id)
          ),
        };

        const verdict = shape.validateRegion(awsRegion, clean);
        if (!verdict.ok) {
          errors.push(`${awsRegion}: ${verdict.errors.join(' ')}`);
          continue;
        }
        next[awsRegion] = clean;
      }

      if (errors.length) {
        return res.status(400).json({ success: false, message: errors.join('\n') });
      }
      aws.regions = next;
    }

    /*
     * The original single-region fields.
     *
     * Still accepted, and folded into the region they were meant for, because
     * anything already stored in them points at real infrastructure somebody
     * built by hand. Dropping them would lose a security group id that only
     * exists in the AWS console.
     */
    const legacy = { vpcId, securityGroupId, subnetIds };
    if (Object.values(legacy).some((v) => v !== undefined)) {
      const target = String(region || aws.region || '').trim();
      if (!target) {
        return res.status(400).json({
          success: false,
          message: 'A VPC, security group and subnets belong to one AWS region, so they cannot be '
            + 'saved without saying which region. Send them under `regions` instead.',
        });
      }
      aws.regions = aws.regions || shape.normalize(aws).regions || {};
      const block = { ...shape.emptyRegion(), ...(aws.regions[target] || {}) };
      if (vpcId !== undefined) block.vpcId = String(vpcId).trim();
      if (securityGroupId !== undefined) block.securityGroupId = String(securityGroupId).trim();
      if (subnetIds !== undefined) {
        block.subnetIds = Object.fromEntries(
          Object.entries(subnetIds && typeof subnetIds === 'object' ? subnetIds : {})
            .map(([az, id]) => [String(az).trim(), String(id || '').trim()])
            .filter(([az, id]) => /^[a-z]{2}-[a-z]+-\d[a-z]$/.test(az) && /^subnet-[0-9a-f]{8,}$/i.test(id))
        );
      }
      aws.regions[target] = block;
    }

    /*
     * There is no "default region" any more, and that is the point.
     *
     * A tier already says which regions it is sold in, and the customer's
     * choice travels on the deployment — so a default here would either be
     * ignored or, worse, override what the customer was sold. The field is
     * cleared rather than kept, so nothing can read a stale one.
     */
    if (aws.region !== undefined) delete aws.region;
    for (const dead of ['vpcId', 'securityGroupId', 'subnetIds', 'imageId']) {
      if (aws[dead] !== undefined) delete aws[dead];
    }

    /*
     * The cost table, which is the margin guard's fallback input. Keyed by
     * instance type. An unparseable value is dropped, which leaves the cost
     * unknown — and unknown is already a refusal, so a typo fails safe
     * instead of reading as free.
     */
    if (machineCostPerHour !== undefined) {
      const table = {};
      const source = machineCostPerHour && typeof machineCostPerHour === 'object' ? machineCostPerHour : {};
      for (const [rawType, rawCost] of Object.entries(source)) {
        const type = String(rawType).trim();
        // AWS instance types are like `m6i.xlarge` or `g4dn.12xlarge`.
        if (!type || !/^[a-z0-9]+\.[a-z0-9]+$/.test(type)) continue;
        const cost = Number(rawCost);
        if (!Number.isFinite(cost) || cost < 0) continue;
        table[type] = cost;
      }
      aws.machineCostPerHour = table;
    }

    /*
     * The secret. Same rule as every other secret on this platform — an empty
     * field means "leave what is stored alone", so re-saving the form without
     * pasting it again does not wipe it.
     */
    let secretChanged = false;
    if (secretAccessKey && String(secretAccessKey).trim()) {
      const raw = String(secretAccessKey).trim();
      // AWS secret keys are 40 base64-ish characters. Checked before storing,
      // because a truncated paste fails later as `SignatureDoesNotMatch`,
      // which points at the wrong thing entirely.
      if (!/^[A-Za-z0-9/+=]{40}$/.test(raw)) {
        return res.status(400).json({
          success: false,
          message: 'An AWS secret access key is 40 characters. That looks truncated or has extra '
            + 'characters in it — a wrong secret shows up later as "SignatureDoesNotMatch", which '
            + 'does not point here.',
        });
      }
      aws.secretAccessKeyEncrypted = cryptoHelper.encrypt(raw);
      secretChanged = true;
    }

    settings.lastUpdatedBy = req.userId;
    settings.markModified('awsSettings');
    await settings.save();

    // The clients cache credentials; the next call must re-read them.
    try { require('../../services/aws/awsClient').clearCache(); } catch { /* optional */ }
    try { require('../../services/aws/awsPricing').clearCache(); } catch { /* optional */ }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'AWS provisioning settings updated',
      metadata: {
        accountId: aws.accountId || '(unset)',
        // Which regions can actually build, rather than a single configured
        // one — there is no single region any more.
        regionsReady: shape.configuredRegions(aws).join(', ') || '(none)',
        // The two that decide whether real money can be spent, recorded on
        // every change so "when did this platform start creating machines on
        // AWS" has an answer.
        enabled: aws.enabled,
        dryRun: aws.dryRun,
        secretAccessKey: secretChanged ? '***set***' : '(unchanged)',
      },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    }).catch(() => {});

    res.json({ success: true, message: 'AWS settings saved', awsSettings: safeView(aws) });
  } catch (error) {
    console.error('Update AWS settings error:', error);
    res.status(500).json({ success: false, message: 'Error updating AWS settings' });
  }
};

/**
 * POST /api/v1/admin/settings/aws/test
 *
 * Proves the credentials work without creating anything. Separate from saving
 * so an operator can check a key that is already stored, and so a save is
 * never blocked by a network problem.
 */
const testAws = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can test the AWS connection' });
    }

    const awsClient = require('../../services/aws/awsClient');
    awsClient.clearCache();
    const result = await awsClient.testConnection();

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'read',
      targetModel: 'Settings',
      description: `AWS connection test: ${result.message}`,
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    }).catch(() => {});

    res.json({ success: true, ...result });
  } catch (error) {
    // A failed test is information, not a server fault — the message is the
    // whole point of pressing the button.
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  updateAws,
  testAws,
  safeView,
};
