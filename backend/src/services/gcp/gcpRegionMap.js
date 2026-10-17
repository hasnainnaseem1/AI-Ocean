/**
 * Platform regions -> real GCP regions and zones.
 *
 * The catalogue speaks in names a customer chose to see — `eu-central`,
 * `us-east`, `ap-south` — which are stored on a Tier as a free-form array and
 * copied onto the Deployment verbatim. GCP has never heard of any of them.
 * This module is the only place the two vocabularies meet, so a region being
 * renamed or added is one edit here plus one edit in
 * `infra/gcp/live/<env>/env.hcl`, and nothing else in the platform has to know.
 *
 * Pure by construction: no database, no clock, no SDK. Every decision below can
 * be asserted directly, which is the same reason `collectionSchedule.js` is
 * shaped this way.
 */

/**
 * The mapping. Zones are listed in the order they will be tried.
 *
 * Three zones each, not one, because `ZONE_RESOURCE_POOL_EXHAUSTED` is a
 * routine answer from GCP rather than an exceptional one — especially for GPU
 * shapes — and a platform that gives up when its first choice is full is a
 * platform that stops provisioning on a busy afternoon.
 *
 * These must stay in step with the subnets in `infra/gcp/live/<env>/env.hcl`: a
 * region named here with no subnet there has nowhere to put the instance.
 * `assertConsistentWith()` below exists so a test can prove that rather than
 * leaving it to memory.
 */
const REGIONS = {
  'eu-central': {
    gcpRegion: 'europe-west4',
    zones: ['europe-west4-a', 'europe-west4-b', 'europe-west4-c'],
  },
  'us-east': {
    gcpRegion: 'us-east4',
    zones: ['us-east4-a', 'us-east4-b', 'us-east4-c'],
  },
  'ap-south': {
    gcpRegion: 'asia-south1',
    zones: ['asia-south1-a', 'asia-south1-b', 'asia-south1-c'],
  },
};

/**
 * What `region: 'default'` means.
 *
 * A Tier's `regions` column defaults to `['default']` in the schema, and
 * `deploymentController` copies whatever it finds straight onto the deployment
 * without validating it. So `default` reaches us for any tier nobody set a
 * region on, and it has to resolve to somewhere real rather than failing a
 * customer's deployment over a field they never saw.
 */
const DEFAULT_PLATFORM_REGION = 'eu-central';

/** Every platform region this module can place an instance in. */
const supportedPlatformRegions = () => Object.keys(REGIONS);

/** Every GCP region, for cross-checking against the Terraform subnets. */
const supportedGcpRegions = () => Object.values(REGIONS).map((r) => r.gcpRegion);

/**
 * Resolve a platform region to GCP.
 *
 * Returns `{ ok: true, platformRegion, gcpRegion, zones }`, or
 * `{ ok: false, code, message }` for a region nobody has mapped.
 *
 * It refuses rather than silently falling back to Europe: a customer who asked
 * for `ap-south` because their data has to stay in India must not quietly get
 * a machine in the Netherlands. `default` is the one exception, because that
 * value means "nobody expressed a preference", not "somewhere specific".
 */
const resolveRegion = (region) => {
  const asked = String(region || '').trim() || 'default';
  const key = asked === 'default' ? DEFAULT_PLATFORM_REGION : asked;
  const entry = REGIONS[key];

  if (!entry) {
    return {
      ok: false,
      code: 'REGION_NOT_MAPPED',
      message: `No GCP region is mapped for "${asked}". Add it to gcpRegionMap.js and to the subnets in infra/gcp/live/<env>/env.hcl.`,
    };
  }

  return {
    ok: true,
    platformRegion: key,
    gcpRegion: entry.gcpRegion,
    zones: [...entry.zones],
    // True when the customer expressed no preference, so a caller can tell the
    // difference between "they wanted Europe" and "we had to pick something".
    defaulted: asked === 'default',
  };
};

/**
 * Which zone to try, given how many attempts have already failed.
 *
 * Two properties matter and they pull against each other:
 *
 *  - **Deterministic.** The same deployment on attempt 0 always resolves to the
 *    same zone. Instance names are derived from the deployment id, and GCP's
 *    uniqueness (and therefore our `ALREADY_EXISTS` idempotency) is per-zone —
 *    so a first attempt that wandered between zones could leave two machines
 *    running for one order.
 *  - **Spread.** Hashing on the deployment id rather than always starting at
 *    index 0 keeps the whole platform from piling into `-a` and exhausting it
 *    while `-b` and `-c` sit empty.
 *
 * On a retry the caller passes `attempt + 1` and gets the next zone round, so a
 * zone that answered "pool exhausted" is not asked again immediately.
 *
 * The caller must persist the zone it was given BEFORE calling GCP, and reuse
 * that stored value on every later poll — recomputing it is how a retry ends up
 * looking in the wrong place for an instance that does exist.
 */
const pickZone = ({ zones, deploymentId, attempt = 0 }) => {
  if (!Array.isArray(zones) || zones.length === 0) return null;

  // A small, stable string hash. Not a security primitive — it only has to
  // spread evenly and give the same answer every time.
  const id = String(deploymentId || '');
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }

  const start = Math.abs(hash) % zones.length;
  const index = (start + Math.max(0, Number(attempt) || 0)) % zones.length;
  return zones[index];
};

/**
 * Have we run out of zones to try for this region?
 *
 * Retrying forever against a region that is genuinely full burns quota and
 * hides the problem; after one full lap the honest answer is "this region
 * cannot place your machine right now", which an admin can act on.
 */
const exhaustedZones = ({ zones, attempt }) =>
  Array.isArray(zones) && Number(attempt) >= zones.length;

/**
 * Prove this file agrees with the Terraform that built the subnets.
 *
 * A GCP region here with no subnet there means `instances.insert` fails with a
 * confusing "subnetwork not found" at the worst possible moment — on a real
 * customer's first deployment. The test for this module passes in the regions
 * from `infra/gcp/live/staging/env.hcl` so the two cannot drift silently.
 */
const assertConsistentWith = (gcpRegionsWithSubnets) => {
  const have = new Set(gcpRegionsWithSubnets || []);
  const missing = supportedGcpRegions().filter((r) => !have.has(r));
  return {
    ok: missing.length === 0,
    missing,
    message: missing.length
      ? `These GCP regions are mapped but have no subnet: ${missing.join(', ')}. Add them to infra/gcp/live/<env>/env.hcl.`
      : '',
  };
};

module.exports = {
  REGIONS,
  DEFAULT_PLATFORM_REGION,
  supportedPlatformRegions,
  supportedGcpRegions,
  resolveRegion,
  pickZone,
  exhaustedZones,
  assertConsistentWith,
};
