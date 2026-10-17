/**
 * The shape of `awsSettings`, and which parts of it are per-region.
 *
 * ── Why this file exists ──
 *
 * AWS scopes its resources differently from Google, and the difference is not
 * cosmetic — it decides what a settings form can look like.
 *
 * On Google a VPC is **global**: one network, with a subnet in each region, so
 * one network name covers every region the platform sells. On AWS a VPC is
 * **regional**. So is everything hanging off it:
 *
 *   | Resource          | Scope    | Where it is stored  |
 *   |-------------------|----------|---------------------|
 *   | VPC               | regional | per region          |
 *   | Security group    | regional | per region          |
 *   | Subnet            | one AZ   | per region, per AZ  |
 *   | AMI (image)       | regional | per region          |
 *   | IAM instance role | GLOBAL   | once, at the top    |
 *   | Account, API key  | global   | once, at the top    |
 *
 * The AMI is the one most easily missed: `ami-0abc…` in Ireland names a
 * different image — usually no image at all — in Mumbai. One image id shared
 * across regions means every launch outside the region it was copied from
 * fails with `InvalidAMIID.NotFound`.
 *
 * IAM, by contrast, genuinely is global: one instance profile name works in
 * every region, so copying it per region would be three fields that must agree
 * and will eventually disagree.
 *
 * ── Why the old flat shape is folded in rather than dropped ──
 *
 * The first version of this feature had one region's worth of fields at the
 * top level. Anything already typed in is real infrastructure that somebody
 * built by hand, so `normalize` moves it under its region instead of
 * discarding it. A settings migration that loses a security group id costs an
 * afternoon of hunting through the AWS console.
 *
 * Pure: no database, no network, no clock.
 */
const regionMap = require('./awsRegionMap');

/** Fields that live once, at the top, because AWS scopes them globally. */
const GLOBAL_FIELDS = [
  'enabled', 'dryRun', 'accountId', 'accessKeyId', 'secretAccessKeyEncrypted',
  'instanceProfile', 'environment', 'requestTimeoutSeconds',
  'maxInstancesPerTeam', 'maxInstancesPlatform', 'enforceMarginGuard',
  'machineCostPerHour', 'priceSource',
];

/** Fields that must exist once per AWS region, because AWS scopes them there. */
const REGIONAL_FIELDS = ['vpcId', 'securityGroupId', 'imageId', 'subnetIds'];

const ID_PATTERNS = {
  vpcId: /^vpc-[0-9a-f]{8,17}$/,
  securityGroupId: /^sg-[0-9a-f]{8,17}$/,
  imageId: /^ami-[0-9a-f]{8,17}$/,
  subnetId: /^subnet-[0-9a-f]{8,17}$/,
};

/**
 * A real example per field, for the error message.
 *
 * Written out rather than derived from the pattern: a slice of a regex source
 * reads as `vpc-[0-…`, which tells an operator nothing about what to paste.
 */
const ID_EXAMPLES = {
  vpcId: 'vpc-0a1b2c3d4e5f6789',
  securityGroupId: 'sg-0a1b2c3d4e5f6789',
  imageId: 'ami-0a1b2c3d4e5f6789',
  subnetId: 'subnet-0a1b2c3d4e5f6789',
};

/** The AWS console's own name for each field, so the message matches the screen. */
const FIELD_LABELS = {
  vpcId: 'The VPC id',
  securityGroupId: 'The security group id',
  imageId: 'The machine image (AMI) id',
};

/** An empty per-region block, so a form always has something to bind to. */
const emptyRegion = () => ({ vpcId: '', securityGroupId: '', imageId: '', subnetIds: {} });

/**
 * Read a settings object into the per-region shape, whatever shape it is in.
 *
 * Accepts both the current shape (`regions: { 'eu-west-1': {...} }`) and the
 * original flat one (`region: 'eu-west-1', vpcId, securityGroupId, subnetIds`),
 * and returns the former. Idempotent — normalizing twice changes nothing.
 */
const normalize = (raw = {}) => {
  const out = {};
  for (const key of GLOBAL_FIELDS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }

  const regions = {};

  // Already in the per-region shape.
  for (const [awsRegion, block] of Object.entries(raw.regions || {})) {
    regions[awsRegion] = {
      ...emptyRegion(),
      ...Object.fromEntries(
        REGIONAL_FIELDS.filter((f) => block?.[f] !== undefined).map((f) => [f, block[f]])
      ),
    };
    regions[awsRegion].subnetIds = { ...(block?.subnetIds || {}) };
  }

  /*
   * The old flat shape. Folded under whichever region it was configured for,
   * and only where that region has nothing yet — a later per-region edit is
   * the more recent intent and must not be overwritten by a stale top-level
   * leftover.
   */
  const legacyRegion = raw.region;
  const hasLegacy = REGIONAL_FIELDS.some((f) => {
    const v = raw[f];
    return f === 'subnetIds' ? Object.keys(v || {}).length > 0 : !!v;
  });

  if (legacyRegion && hasLegacy) {
    const existing = regions[legacyRegion];
    const blank = !existing
      || (!existing.vpcId && !existing.securityGroupId && !existing.imageId
        && !Object.keys(existing.subnetIds || {}).length);
    if (blank) {
      regions[legacyRegion] = {
        vpcId: raw.vpcId || '',
        securityGroupId: raw.securityGroupId || '',
        imageId: raw.imageId || '',
        subnetIds: { ...(raw.subnetIds || {}) },
      };
    }
  }

  out.regions = regions;
  return out;
};

/**
 * The per-region infrastructure for one AWS region.
 *
 * Returns `{ ok: false, message }` rather than throwing, and the message names
 * the Terragrunt stack to apply — because "not configured" here means a real
 * region that was never built, and the fix is an `apply`, not a form field.
 */
const infraFor = (settings, awsRegion) => {
  const norm = normalize(settings);
  const block = norm.regions?.[awsRegion];

  const missing = [];
  if (!block?.vpcId) missing.push('VPC');
  if (!block?.securityGroupId) missing.push('security group');
  if (!block?.imageId) missing.push('machine image');
  if (!Object.keys(block?.subnetIds || {}).length) missing.push('subnets');

  if (missing.length) {
    return {
      ok: false,
      code: 'REGION_NOT_CONFIGURED',
      message: `AWS is not set up in ${awsRegion} — no ${missing.join(', ')}. `
        + `Apply infra/aws/live/<env>/${awsRegion} and paste the ids into `
        + 'Admin → Cloud → AWS. A VPC, security group, subnet and AMI are all regional on AWS, '
        + 'so each region needs its own.',
      missing,
    };
  }

  return {
    ok: true,
    awsRegion,
    vpcId: block.vpcId,
    securityGroupId: block.securityGroupId,
    imageId: block.imageId,
    subnetIds: { ...block.subnetIds },
    // Global, so it comes from the top level — see the table in the header.
    instanceProfile: norm.instanceProfile || '',
  };
};

/** Which AWS regions are configured well enough to actually build in. */
const configuredRegions = (settings) => {
  const norm = normalize(settings);
  return Object.keys(norm.regions || {}).filter((r) => infraFor(norm, r).ok).sort();
};

/**
 * Validate one region's block, for the settings controller.
 *
 * Every id is checked against its AWS prefix. A `sg-` typed into the VPC field
 * is the kind of mistake that is invisible until a launch fails, and AWS's own
 * error for it names neither field.
 */
const validateRegion = (awsRegion, block = {}) => {
  const errors = [];

  if (!regionMap.supportedAwsRegions().includes(awsRegion)) {
    errors.push(
      `"${awsRegion}" is not a region this platform sells. Add it to awsRegionMap (and to the `
      + 'Google side too — a region only one cloud can serve breaks every tier using it).'
    );
  }

  for (const field of ['vpcId', 'securityGroupId', 'imageId']) {
    const value = block[field];
    if (value && !ID_PATTERNS[field].test(String(value).trim())) {
      errors.push(
        `${FIELD_LABELS[field]} looks wrong: got "${value}", expected something like `
        + `"${ID_EXAMPLES[field]}". ${field === 'imageId'
          ? 'An AMI id is specific to one region — the id from another region will not work here.'
          : 'Check you have not pasted a different kind of id into this field.'}`
      );
    }
  }

  const azs = regionMap.REGIONS
    ? Object.values(regionMap.REGIONS).find((r) => r.awsRegion === awsRegion)?.azs || []
    : [];

  for (const [az, subnetId] of Object.entries(block.subnetIds || {})) {
    if (azs.length && !azs.includes(az)) {
      errors.push(`"${az}" is not an availability zone this platform uses in ${awsRegion} (${azs.join(', ')}).`);
    }
    if (subnetId && !ID_PATTERNS.subnetId.test(String(subnetId).trim())) {
      errors.push(
        `The subnet for ${az} looks wrong: got "${subnetId}", expected something like `
        + `"${ID_EXAMPLES.subnetId}".`
      );
    }
  }

  return { ok: errors.length === 0, errors };
};

module.exports = {
  GLOBAL_FIELDS,
  REGIONAL_FIELDS,
  ID_PATTERNS,
  ID_EXAMPLES,
  emptyRegion,
  normalize,
  infraFor,
  configuredRegions,
  validateRegion,
};
