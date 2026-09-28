/**
 * The single declaration of what each sizing signal MEANS.
 *
 * What lives here is structure, not policy: which fields exist and how two
 * values of the same field combine. Merge semantics are an explicit registry
 * rather than something inferred from field-name prefixes at runtime —
 * `minVramGb` merging with max() and `maxMonthlyBudget` merging with min() is
 * a design decision, and guessing it from the string "min"/"max" would
 * silently do the wrong thing the first time someone adds `maxContextUsed`.
 *
 * Everything a business would want to TUNE — weights, penalties, thresholds,
 * and every sentence a customer reads — is deliberately NOT here. That lives
 * on the active RecommendationPolicy record so it can be changed from the
 * admin center without touching code. See policyDefaults.js.
 *
 * Adding a signal is a three-line change: the field on `signalSchema` in
 * QuestionTemplate.js, its name in the right array below, and a reason
 * template on the policy so it can explain itself to a customer.
 */

/** Merged with max() — the strictest answer wins, because a floor is a safety property. */
const FLOORS = ['minVramGb', 'minGpuCount', 'minVcpu', 'minRamGb', 'minContextLength'];

/** Merged with min() — the tightest budget wins. */
const CEILINGS = ['maxMonthlyBudget', 'maxPricePerHour'];

/** Merged with max(), 0..1 — soft nudges to the scoring function. */
const PRIORITIES = ['latencyPriority', 'throughputPriority', 'costPriority'];

/** Which reason code explains which profile field. */
const FIELD_TO_CODE = {
  minVramGb: 'VRAM_FLOOR',
  minGpuCount: 'GPU_COUNT_FLOOR',
  minVcpu: 'VCPU_FLOOR',
  minRamGb: 'RAM_FLOOR',
  minContextLength: 'CONTEXT_FLOOR',
  maxMonthlyBudget: 'BUDGET_CEILING',
  maxPricePerHour: 'HOURLY_CEILING',
};

// ── Formatting helpers, shared by every reason template ──

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n ?? ''));
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const rate = (n) => `$${Number(n || 0).toFixed(2)}`;
const quote = (s) => (s ? `"${s}"` : 'your answer');

/**
 * Modality keys are machine values. Anything a customer reads has to say
 * "image generation", never `image_generation`. Labels come from the policy;
 * the de-underscored key is the last resort for a modality nobody has named.
 */
const modalityLabel = (key, policy) => {
  const labels = (policy && policy.modalityLabels) || {};
  return labels[key] || String(key).replace(/_/g, ' ');
};

/** "a", "a and b", "a, b and c" */
const humanList = (items) => {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

// ── Small numeric helpers used across the engine ──

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Normalise to 0..1. Collapses to 0.5 when every candidate is identical. */
const norm = (value, lo, hi) => (hi - lo < 1e-9 ? 0.5 : (value - lo) / (hi - lo));

const round4 = (n) => Math.round(n * 10000) / 10000;
const round2 = (n) => Math.round(n * 100) / 100;

module.exports = {
  FLOORS,
  CEILINGS,
  PRIORITIES,
  FIELD_TO_CODE,
  fmt,
  money,
  rate,
  quote,
  modalityLabel,
  humanList,
  clamp,
  norm,
  round4,
  round2,
};
