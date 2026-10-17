/**
 * Resolve the thresholds the analytics layer should interpret numbers with,
 * right now.
 *
 * The active `AnalyticsPolicy` row is deep-merged over
 * `DEFAULT_ANALYTICS_POLICY`, so:
 *
 *   - no policy configured at all  → the shipped defaults, unchanged
 *   - a policy that sets one field → that field wins, everything else inherits
 *   - a database read that fails   → the shipped defaults, and we log it
 *
 * That last case is the reason this never throws. A dashboard that renders
 * with default thresholds during a database wobble is useful; one that returns
 * 500 because it could not read a tuning row is not — and the thresholds are
 * an opinion about the numbers, not the numbers themselves.
 *
 * Mirrors `services/recommendation/policyResolver.js` deliberately: same
 * shape, same failure posture, so there is one pattern for "policy as data" in
 * this codebase rather than two.
 */
const prisma = require('../../lib/prismaClient');
const analyticsCache = require('./analyticsCache');
const { DEFAULT_ANALYTICS_POLICY, deepMerge } = require('./analyticsPolicyDefaults');

/** The policy row itself is cached on the same clock as everything else —
 *  it is read on every analytics request and changes when an admin saves. */
const POLICY_CACHE_KEY = 'policy:active';

/** Json columns come back as `null` when unset; deepMerge skips those, so an
 *  untouched section correctly inherits the whole default subtree. */
const toPlainPolicy = (row) => ({
  key: row.key,
  windows: row.windows,
  cacheTtlSeconds: row.cacheTtlSeconds,
  heavyWindowCacheTtlSeconds: row.heavyWindowCacheTtlSeconds,
  heavyWindowDays: row.heavyWindowDays,
  capacity: row.capacity,
  engagement: row.engagement,
  customers: row.customers,
  churn: row.churn,
  retention: row.retention,
  receivables: row.receivables,
  support: row.support,
  traffic: row.traffic,
  dashboard: row.dashboard,
});

/**
 * @returns {Promise<Object>} a complete policy — every field present.
 */
const resolvePolicy = async () => {
  let row = null;

  try {
    row = await analyticsCache.cached(
      POLICY_CACHE_KEY,
      () => prisma.analyticsPolicy.findFirst({ where: { isActive: true } }),
      // Short and fixed: this must not inherit the long TTL a heavy window
      // sets, or an operator's threshold edit appears not to have worked.
      { ttlMs: 30 * 1000 },
    );
  } catch (err) {
    console.error('[Analytics] Policy load failed, using defaults:', err.message);
    return DEFAULT_ANALYTICS_POLICY;
  }

  if (!row) return DEFAULT_ANALYTICS_POLICY;

  const policy = deepMerge(DEFAULT_ANALYTICS_POLICY, toPlainPolicy(row));

  // Feed the admin's TTL back into the cache that just served us — one tick
  // behind on the very first read, which is the right trade against reading
  // the policy uncached on every request.
  analyticsCache.setTtlSeconds(policy.cacheTtlSeconds);

  return policy;
};

/**
 * The TTL to use for one window. Long windows are both far more expensive to
 * compute and far less volatile — a 1-year chart does not meaningfully move
 * between two refreshes a minute apart.
 */
const ttlForWindow = (policy, window) => {
  const heavyAfter = Number(policy?.heavyWindowDays) || DEFAULT_ANALYTICS_POLICY.heavyWindowDays;
  const heavyTtl = Number(policy?.heavyWindowCacheTtlSeconds)
    || DEFAULT_ANALYTICS_POLICY.heavyWindowCacheTtlSeconds;
  const normalTtl = Number(policy?.cacheTtlSeconds) || DEFAULT_ANALYTICS_POLICY.cacheTtlSeconds;
  return (window?.spanDays > heavyAfter ? heavyTtl : normalTtl) * 1000;
};

/** Called after any policy write so the next read is not the old thresholds. */
const invalidate = () => {
  analyticsCache.invalidate(POLICY_CACHE_KEY);
  // Every cached aggregate was computed under the old thresholds.
  analyticsCache.clear();
};

module.exports = { resolvePolicy, ttlForWindow, invalidate };
