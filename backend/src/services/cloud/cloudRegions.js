/**
 * Which regions this platform sells, and which clouds can actually serve them.
 *
 * ── The question this file exists to answer ──
 *
 * A tier says where it is available — `eu-central`, `us-east` — and a customer
 * picks one at order time. That choice is carried on the deployment and is
 * what decides where the machine is physically built. The cloud is a separate
 * decision (see `cloudRouter`), and the two have to be compatible: a
 * deployment in `ap-south` routed to a cloud that has no `ap-south` is an
 * order that cannot be filled.
 *
 * So the catalogue may only offer regions **every cloud can serve**. Otherwise
 * moving a model from one cloud to the other — a routine admin action —
 * silently breaks every tier that was only available on the cloud it left.
 *
 * ── Why this is derived, not configured ──
 *
 * The answer is the intersection of the two region maps, computed here rather
 * than typed into a settings field. A list somebody maintains by hand is a
 * list that goes stale the first time a region is added to one cloud, and the
 * failure would surface as a customer's deployment failing at launch.
 *
 * `assertSymmetric()` is what a test uses to catch exactly that.
 *
 * Pure: no database, no network, no clock.
 */
const gcpRegionMap = require('../gcp/gcpRegionMap');
const awsRegionMap = require('../aws/awsRegionMap');
const { CLOUDS } = require('./cloudRouter');

/** The per-cloud maps, keyed the way `cloudRouter` names the clouds. */
const MAPS = {
  gcp: gcpRegionMap,
  aws: awsRegionMap,
};

/** Platform region names one cloud can serve. */
const supportedBy = (cloud) => {
  const map = MAPS[cloud];
  return map ? map.supportedPlatformRegions() : [];
};

/**
 * Platform regions EVERY cloud can serve.
 *
 * This is what the tier form should offer, and the only safe answer to "where
 * can we sell this?" on a platform that may route a model to either cloud.
 */
const commonRegions = () => {
  const lists = CLOUDS.map(supportedBy).filter((l) => l.length);
  if (!lists.length) return [];
  return lists.reduce((acc, list) => acc.filter((r) => list.includes(r)));
};

/**
 * Every platform region any cloud can serve, with which clouds can serve it.
 *
 * For an admin screen that needs to explain *why* a region is not offered,
 * rather than just leaving it out.
 */
const allRegions = () =>
  [...new Set(CLOUDS.flatMap(supportedBy))].sort().map((region) => ({
    region,
    clouds: CLOUDS.filter((c) => supportedBy(c).includes(region)),
    common: CLOUDS.every((c) => supportedBy(c).includes(region)),
  }));

/**
 * Resolve a platform region on one cloud.
 *
 * A thin pass-through so a caller that already knows the cloud does not have
 * to know which map belongs to it.
 */
const resolveOn = (cloud, region) => {
  const map = MAPS[cloud];
  if (!map) {
    return {
      ok: false,
      code: 'UNKNOWN_CLOUD',
      message: `"${cloud}" is not a cloud this platform can build on.`,
    };
  }
  return map.resolveRegion(region);
};

/**
 * Can this cloud serve this deployment's region?
 *
 * Asked before provisioning, so "we routed you to a cloud that cannot build
 * where you asked" is caught as a clear refusal rather than as a launch
 * failure with an opaque provider error.
 */
const canServe = (cloud, region) => {
  const resolved = resolveOn(cloud, region);
  return {
    ok: !!resolved.ok,
    reason: resolved.ok
      ? null
      : `${String(cloud).toUpperCase()} cannot build in "${region}". ${resolved.message || ''}`.trim(),
  };
};

/**
 * Prove the per-cloud region maps agree.
 *
 * Called by a test, not at runtime. A region added to one cloud and not the
 * other is not an error in itself — but it means the catalogue can offer
 * something only one cloud can serve, and whichever tier uses it breaks the
 * day its model is routed elsewhere. The test is the thing that says so at
 * the moment the map is edited rather than months later.
 */
const assertSymmetric = () => {
  const bySide = Object.fromEntries(CLOUDS.map((c) => [c, supportedBy(c)]));
  const everything = [...new Set(Object.values(bySide).flat())];

  const asymmetric = everything
    .map((region) => ({
      region,
      missingFrom: CLOUDS.filter((c) => !bySide[c].includes(region)),
    }))
    .filter((r) => r.missingFrom.length);

  return {
    ok: asymmetric.length === 0,
    asymmetric,
    common: commonRegions(),
    message: asymmetric.length
      ? asymmetric
        .map((r) => `"${r.region}" is missing from ${r.missingFrom.join(', ')}`)
        .join('; ')
        + '. Either add it to that cloud\'s region map (and its infra), or remove it from the '
        + 'other — a region only one cloud can serve breaks every tier using it the day its '
        + 'model is routed to the other cloud.'
      : '',
  };
};

module.exports = {
  MAPS,
  supportedBy,
  commonRegions,
  allRegions,
  resolveOn,
  canServe,
  assertSymmetric,
};
