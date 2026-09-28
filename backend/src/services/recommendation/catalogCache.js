/**
 * A deliberately dumb short-lived cache over the reads the engine needs.
 *
 * The deploy journey recomputes sizing as the customer answers, so this path
 * runs many times per session for data that changes maybe weekly (≈14
 * questions, 6 tiers, 9 models). Without a cache that is several round trips
 * per keystroke; with one it is essentially free.
 *
 * No Redis, no invalidation hooks, no dependency — a short stale window after
 * an admin edits the catalogue is acceptable and self-heals. Anything cleverer
 * would be more machinery than the problem deserves, and this codebase has no
 * cache layer to be consistent with.
 *
 * The window itself is `cacheTtlSeconds` on the active RecommendationPolicy;
 * the resolver pushes it in here after each load. It starts at the policy
 * default so the very first read has a sane value rather than no cache at all.
 */
const catalogService = require('../catalog/catalogService');
const questionTemplateService = require('../admin/questionTemplateService');
const recommendationPolicyService = require('../admin/recommendationPolicyService');
const { DEFAULT_POLICY } = require('./policyDefaults');

let ttlMs = DEFAULT_POLICY.cacheTtlSeconds * 1000;

/** Called by the policy resolver once it knows what the admin configured. */
const setTtlSeconds = (seconds) => {
  const n = Number(seconds);
  if (Number.isFinite(n) && n >= 0) ttlMs = n * 1000;
};

const store = new Map();

/** Read through the cache, or refresh if the entry is missing or stale. */
const cached = async (key, loader) => {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const value = await loader();
  store.set(key, { value, at: Date.now() });
  return value;
};

const getActiveTiers = () => cached('tiers', () => catalogService.listActiveTiers({ orderByPrice: true }));

const getActiveModels = () => cached('models', () => catalogService.listActiveModels());

const getActiveQuestions = () => cached('questions', () => questionTemplateService.listActive());

const getUseCaseLabels = () => cached('useCaseLabels', async () => {
  const tags = await catalogService.listActiveUseCaseTags();
  return tags.reduce((acc, tag) => ({ ...acc, [tag.key]: tag.label }), {});
});

const getActivePolicyDoc = () => cached('policy', () => recommendationPolicyService.getActive());

/** Drop everything — used by tests and after a bulk seed. */
const clear = () => store.clear();

module.exports = {
  getActiveTiers,
  getActiveModels,
  getActiveQuestions,
  getUseCaseLabels,
  getActivePolicyDoc,
  setTtlSeconds,
  clear,
};
