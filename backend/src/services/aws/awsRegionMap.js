/**
 * Platform regions -> real AWS regions and availability zones.
 *
 * The AWS twin of `gcpRegionMap.js`, and deliberately the same shape: the
 * catalogue speaks in names a customer chose to see — `eu-central`, `us-east`,
 * `ap-south` — and AWS has never heard of any of them. This is the only place
 * the two vocabularies meet.
 *
 * ── Where this differs from the GCP one, and why it matters ──
 *
 * On GCP a zone is where an instance is *placed*, and the platform picks one.
 * On AWS the same is true, but the subnet comes first: an EC2 instance is
 * launched into a **subnet**, and the subnet is what fixes the availability
 * zone. So this module's job ends at "which AZs may we use"; the actual
 * placement reads the subnet ids that `infra/aws` created, which live in
 * settings because they are facts about a particular account's infrastructure
 * rather than facts about AWS.
 *
 * Two AZs per region rather than GCP's three. Capacity errors on AWS
 * (`InsufficientInstanceCapacity`) are real but less routine than GCP's
 * `ZONE_RESOURCE_POOL_EXHAUSTED`, and each AZ costs a NAT gateway per hour —
 * so a third is a real monthly bill for a smaller gain.
 *
 * Pure by construction: no database, no clock, no SDK.
 */

/**
 * The mapping. AZs are listed in the order they will be tried.
 *
 * These must stay in step with `infra/aws/live/<env>/env.hcl`: a region named
 * here with no subnet there has nowhere to put the instance.
 * `assertConsistentWith()` below exists so a test can prove that rather than
 * leaving it to memory.
 */
const REGIONS = {
  'eu-central': {
    awsRegion: 'eu-west-1',
    azs: ['eu-west-1a', 'eu-west-1b'],
  },
  'us-east': {
    awsRegion: 'us-east-1',
    azs: ['us-east-1a', 'us-east-1b'],
  },
  'ap-south': {
    awsRegion: 'ap-south-1',
    azs: ['ap-south-1a', 'ap-south-1b'],
  },
};

/**
 * What a customer gets when they expressed no preference.
 *
 * Europe rather than the cheapest, for the same reason as the GCP side: most
 * of this platform's customers are closer to it, and a default chosen on price
 * alone puts people's inference the wrong side of the planet.
 */
const DEFAULT_PLATFORM_REGION = 'eu-central';

const supportedPlatformRegions = () => Object.keys(REGIONS);
const supportedAwsRegions = () => Object.values(REGIONS).map((r) => r.awsRegion);

/**
 * Turn a platform region into an AWS one.
 *
 * An unmapped region is REFUSED rather than quietly defaulted. A tier that
 * says `ap-south` and silently lands in Ireland is a customer told one thing
 * and sold another — and the latency makes it obvious to them long before it
 * is obvious to us.
 */
const resolveRegion = (region) => {
  const asked = String(region || '').trim() || 'default';
  const key = asked === 'default' ? DEFAULT_PLATFORM_REGION : asked;
  const entry = REGIONS[key];

  if (!entry) {
    return {
      ok: false,
      code: 'REGION_NOT_MAPPED',
      message: `No AWS region is mapped for "${asked}". Add it to awsRegionMap.js and to the `
        + 'regions block in infra/aws/live/<env>/env.hcl.',
    };
  }

  return {
    ok: true,
    platformRegion: key,
    awsRegion: entry.awsRegion,
    azs: [...entry.azs],
    // True when the customer expressed no preference, so a caller can tell
    // "they wanted Europe" from "we had to pick something".
    defaulted: asked === 'default',
  };
};

/**
 * Which AWS region an availability zone belongs to.
 *
 * ── Why this is a lookup and not a regex ──
 *
 * `eu-west-1a` → `eu-west-1` looks like stripping a trailing letter, and that
 * is how it is usually written. It is wrong for AWS Local Zones and Wavelength
 * zones (`us-east-1-bos-1a`, `eu-west-1-wl1-lon-wlz-1`), where the suffix is
 * not one character and the region is not the prefix minus one letter. A regex
 * that guesses would produce a plausible-looking region that does not exist,
 * and the call signed for it would fail with an opaque credential error.
 *
 * So the answer comes from the map, and an AZ that is not in it is refused.
 *
 * This matters because it is how `terminate` finds its region. A destroy sent
 * to the wrong region gets `InvalidInstanceID.NotFound` — which reads as "it
 * is already gone" — while the real instance keeps running and keeps billing,
 * with the platform believing it was destroyed. That is the single most
 * expensive mistake this file can prevent.
 */
const regionOfAz = (az) => {
  const asked = String(az || '').trim();

  for (const entry of Object.values(REGIONS)) {
    if (entry.azs.includes(asked)) return { ok: true, awsRegion: entry.awsRegion, az: asked };
  }

  return {
    ok: false,
    code: 'AZ_NOT_MAPPED',
    message: `"${asked}" is not an availability zone this platform uses. It cannot be matched to a `
      + 'region, so no call can safely be sent for it. If this is a zone we have started using, '
      + 'add it to awsRegionMap.js.',
  };
};

/**
 * Which AZ to try for this deployment, on this attempt.
 *
 * Deterministic from the deployment id, so the same deployment retried lands
 * somewhere predictable, and two deployments created in the same second do not
 * pile into the same AZ. `attempt` rotates, which is what turns a capacity
 * error into "try the other AZ" rather than "try the same AZ again, slower".
 */
const pickAz = ({ azs, deploymentId, attempt = 0 }) => {
  if (!Array.isArray(azs) || azs.length === 0) return null;

  // A small, stable string hash. Not a security primitive — it only has to
  // spread evenly and give the same answer every time.
  const id = String(deploymentId || '');
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }

  const start = Math.abs(hash) % azs.length;
  return azs[(start + Math.max(0, Number(attempt) || 0)) % azs.length];
};

/**
 * Have we run out of AZs to try?
 *
 * Retrying forever against a region that is genuinely full burns quota and
 * hides the problem; after one full lap the honest answer is "this region
 * cannot place your machine right now", which an admin can act on.
 */
const exhaustedAzs = ({ azs, attempt }) =>
  Array.isArray(azs) && Number(attempt) >= azs.length;

/**
 * Prove this file and `infra/aws/live/<env>/env.hcl` agree.
 *
 * Called by a test rather than at runtime. A region mapped here with no subnet
 * there is a deployment that will be accepted and then fail at launch, which
 * is the worst moment to discover it.
 *
 * @param {object} subnetsByAz  the subnet ids from settings, keyed by AZ
 */
const assertConsistentWith = (subnetsByAz = {}) => {
  const known = Object.keys(subnetsByAz || {});
  const missing = [];

  for (const entry of Object.values(REGIONS)) {
    for (const az of entry.azs) {
      if (!known.includes(az)) missing.push(az);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    message: missing.length
      ? `These availability zones are mapped but have no subnet: ${missing.join(', ')}. `
        + 'Add them to infra/aws/live/<env>/env.hcl, or remove the region from awsRegionMap.js.'
      : '',
  };
};

module.exports = {
  REGIONS,
  DEFAULT_PLATFORM_REGION,
  supportedPlatformRegions,
  supportedAwsRegions,
  resolveRegion,
  regionOfAz,
  pickAz,
  exhaustedAzs,
  assertConsistentWith,
};
