/**
 * Resolve the policy the engine should run under, right now.
 *
 * The active `RecommendationPolicy` document is deep-merged over
 * `DEFAULT_POLICY`, so:
 *
 *   - no policy configured at all  → the shipped defaults, unchanged
 *   - a policy that sets one field → that field wins, everything else inherits
 *   - a database read that fails   → the shipped defaults, and we log it
 *
 * That last case matters more than it looks. Sizing advice is not worth
 * failing a customer's deployment over: if the database is unreachable the engine
 * must still produce an answer, so this never throws.
 */
const catalogCache = require('./catalogCache');
const { DEFAULT_POLICY, deepMerge } = require('./policyDefaults');

/**
 * @returns {Promise<Object>} a complete policy — every field present.
 */
const resolvePolicy = async () => {
  let doc = null;

  try {
    doc = await catalogCache.getActivePolicyDoc();
  } catch (err) {
    console.error('[Recommendation] Policy load failed, using defaults:', err.message);
    return DEFAULT_POLICY;
  }

  if (!doc) return DEFAULT_POLICY;

  const policy = deepMerge(DEFAULT_POLICY, doc);

  // Feed the admin's TTL back into the cache that just served us. One tick
  // behind on the very first read, which is the correct trade: the
  // alternative is an uncached read of the policy on every recompute.
  catalogCache.setTtlSeconds(policy.cacheTtlSeconds);

  return policy;
};

module.exports = { resolvePolicy };
