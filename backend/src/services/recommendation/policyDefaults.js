/**
 * The recommendation engine's entire policy, as data.
 *
 * Every number that decides how a suggestion is made, and every sentence a
 * customer reads about it, lives in this one object. Nothing in the engine may
 * hardcode a weight, a penalty, a threshold or a phrase — if a value would
 * otherwise be a magic number in a scoring function, it belongs here instead.
 *
 * This object is the FALLBACK, not the source of truth. The active
 * `RecommendationPolicy` document is deep-merged over it, so an admin can
 * override a single penalty without restating fifty others, and a policy
 * written before a new knob existed keeps working the day that knob ships.
 *
 * The defaults below reproduce the engine's original tuned behaviour exactly,
 * so seeding a fresh policy changes nothing until somebody deliberately edits
 * it.
 */

const DEFAULT_POLICY = {
  /* ── Scenario 2: ranking the catalogue ──────────────────────────────── */
  modelRanking: {
    // What we actually believe matters, in order. Must be read as relative
    // weights rather than percentages — they are normalised by their own sum.
    weights: {
      useCase: 0.45,
      capability: 0.20,
      budget: 0.20,
      availability: 0.10,
      popularity: 0.05,
    },
    // Within the capability term: can it do the job at all, vs. can it hold
    // enough context to do it well.
    capabilitySplit: { modality: 0.65, context: 0.35 },
    // budgetFit falls linearly to zero at this multiple of the stated budget.
    budgetZeroAtMultiple: 2,
    statusFit: {
      available: 1,
      beta: 0.7,
      coming_soon: 0.2,
      deprecated: 0,
    },
    unknownStatusFit: 0.5,
    // Applied to availability when nothing bookable can run the model.
    unbookableMultiplier: 0.3,
    featuredPopularity: 1,
    defaultPopularity: 0.5,
    // Used when no use-case signal exists at all, so ranking degrades to
    // catalogue order instead of inventing a preference.
    neutralUseCaseMatch: 0.5,
  },

  /* ── Scoring the hardware tiers a model supports ────────────────────── */
  tierScoring: {
    baseScore: 100,
    hoursPerMonth: 730,
    // Used when the customer gave no signal for these priorities.
    defaultCostPriority: 0.5,
    defaultLatencyPriority: 0,

    vram: {
      maxPenalty: 60,
      // Penalty reaches maxPenalty once VRAM is at or below this fraction of
      // what is required.
      fullPenaltyAtRatio: 0.5,
      highSeverityBelowRatio: 0.75,
      // Paying for silicon that will sit idle.
      overProvisionFromRatio: 2,
      overProvisionPenaltyPerUnit: 10,
      overProvisionMaxPenalty: 15,
    },

    floors: {
      gpuCountPenalty: 25,
      vcpuPenalty: 5,
      ramPenalty: 5,
    },

    budget: {
      maxPenalty: 40,
      fullPenaltyAtMultiple: 2,
      highSeverityAboveMultiple: 1.5,
      // Small reward for leaving comfortable headroom under the budget.
      headroomReward: 5,
      hourlyCapPenalty: 20,
    },

    costEfficiencyWeight: 15,
    latencyWeight: 10,
    stock: { outOfStockPenalty: 35, limitedPenalty: 8 },
    // The admin's own `recommended` flag: a real thumb on the scale, never
    // decisive on its own.
    adminRecommendedBonus: 8,
  },

  /* ── Is this model right for what they described? ───────────────────── */
  suitability: {
    // A context shortfall this close to the target is a note, not an alarm.
    contextMediumAtOrAboveRatio: 0.8,
    budgetTightAboveRatio: 0.8,
    verdict: {
      poorAtHighCount: 1,
      cautionAtMediumCount: 1,
      cautionAtLowCount: 2,
    },
    scorePenalties: { high: 40, medium: 18, low: 6 },
    // `coming_soon` is high because createDeployment genuinely rejects it —
    // a gentler warning would promise something the next screen refuses.
    modelStatusSeverity: {
      coming_soon: 'high',
      deprecated: 'high',
      beta: 'low',
    },
  },

  /* ── Shared vocabularies ────────────────────────────────────────────── */

  // How strongly an admin's "good for" claim counts toward a match.
  fitWeights: { excellent: 1.0, good: 0.7, possible: 0.4 },

  // Merged by rank — a 24/7 answer outranks a "just testing" one.
  uptimeRanks: { dev: 0, business_hours: 1, always_on: 2 },

  // How much the engine admits to knowing, by count of signal-bearing answers.
  confidence: { lowMaxSignals: 2, mediumMaxSignals: 4 },

  // Machine values are never shown to a customer.
  modalityLabels: {
    chat: 'chat',
    completion: 'text completion',
    vision: 'image understanding',
    image_generation: 'image generation',
    embedding: 'embeddings',
    audio: 'audio',
    code: 'code',
  },

  /* ── Customer-facing copy ───────────────────────────────────────────────
   * Placeholders in {braces} are substituted from the facts behind each
   * reason. An unknown placeholder is left visible rather than silently
   * blanked, so a typo in the admin center shows up instead of producing a
   * sentence with a hole in it.
   *
   * Available everywhere: {answerLabel} {question} {modelName}
   * Numbers come pre-formatted: {requirement} {requirementMoney}
   * {requirementRate} {requirementModality} {actual} {actualMoney} {actualRate}
   */

  // Why this hardware — the "Why this configuration" panel.
  reasonTemplates: {
    VRAM_FLOOR: 'You said {answerLabel}, which needs at least {requirement} GB of VRAM.',
    GPU_COUNT_FLOOR: '{answerLabel} needs at least {requirement} GPUs.',
    VCPU_FLOOR: '{answerLabel} wants at least {requirement} vCPUs.',
    RAM_FLOOR: '{answerLabel} wants at least {requirement} GB of system RAM.',
    CONTEXT_FLOOR: 'You need about {requirement} tokens of context.',
    BUDGET_CEILING: 'You set a budget of around {requirementMoney} a month.',
    HOURLY_CEILING: 'You capped spend at {requirementMoney} an hour.',
    MODEL_MINIMUM: '{modelName} needs at least {requirement} GB of VRAM to run at all.',
    MODALITY_REQUIRED: '{answerLabel} needs a model that supports {requirementModality}.',
    BUDGET_INFEASIBLE: 'The smallest setup that meets your requirements is about {actualMoney} a month, above the {requirementMoney} you mentioned.',
  },

  // Why this model might be wrong — the suitability panel.
  suitabilityTemplates: {
    MODALITY_MISMATCH: '{modelName} does not support {missingModalities}, which is what you described needing.',
    CONTEXT_SHORTFALL: '{modelName} handles {modelContext} tokens; you asked for around {requirement}.',
    BUDGET_IMPOSSIBLE: 'The cheapest way to run {modelName} is about {actualMoney} a month, above your {requirementMoney} budget.',
    BUDGET_TIGHT: 'This will use most of your {requirementMoney} monthly budget.',
    MODEL_COMING_SOON: '{modelName} is not available for deployment yet.',
    MODEL_DEPRECATED: '{modelName} is being retired and is not a good choice for something new.',
    MODEL_BETA: '{modelName} is in beta — behaviour may still change.',
    NO_BOOKABLE_TIER: 'Every configuration for {modelName} is currently out of stock.',
    VRAM_UNSUPPORTED: 'No available configuration reaches the {requirement} GB this workload wants.',
  },

  // Per-tier notes shown against individual configurations.
  tierIssueTemplates: {
    VRAM_SHORTFALL: '{tierName} has {tierVram} GB of VRAM; this workload wants at least {requirement} GB.',
    GPU_COUNT_SHORTFALL: 'Wants at least {requirement} GPUs; this tier has {tierGpuCount}.',
    VCPU_SHORTFALL: 'Fewer vCPUs ({tierVcpu}) than the {requirement} requested.',
    RAM_SHORTFALL: 'Less system RAM ({tierRam} GB) than the {requirement} GB requested.',
    OVER_BUDGET: 'About {actualMoney}/mo against a stated budget of {requirementMoney}.',
    OVER_HOURLY_CAP: '{actualRate}/hr is above the {requirementRate}/hr cap.',
    OUT_OF_STOCK: '{tierName} is currently unavailable.',
    LIMITED_STOCK: '{tierName} has limited availability.',
  },

  // Why this model, on the scenario-2 picker cards. An admin's own `note` on
  // a model's use-case claim still wins over the generated sentence.
  matchReasonTemplates: {
    USE_CASE_MATCH: 'Rated {fit} for {useCase}.',
    CONTEXT_HEADROOM: 'Handles {modelContext} tokens — enough for what you described.',
    WITHIN_BUDGET: 'About {actualMoney}/mo, inside your {requirementMoney} budget.',
  },

  // A wall of bullets reads as marketing rather than advice.
  matchReasonLimits: { maxUseCases: 2, maxStrengths: 2, maxTotal: 4 },

  // The cheaper / more-headroom cards.
  alternativeTemplates: {
    CHEAPER_ADEQUATE: '{tierVram} GB instead of {primaryVram} GB — still enough for what you described.',
    CHEAPER_INADEQUATE: 'Only {tierVram} GB of VRAM, below what this workload wants. Expect slower responses or failures under load.',
    HEADROOM: '{tierVram} GB and {tierGpuCount} GPUs — room to grow without migrating later.',
  },

  // Shown when one constraint rules out every option we could offer, so the
  // customer stops hunting for a model that does not exist.
  blockerTemplates: {
    BUDGET_IMPOSSIBLE: 'Every model we can run for this workload costs more than the budget you gave us — that is the hardware cost, not the model choice.',
    CONTEXT_SHORTFALL: 'No model in our catalog reaches the context length you asked for.',
    VRAM_UNSUPPORTED: 'No configuration we have reaches the memory this workload needs.',
    NO_BOOKABLE_TIER: 'Everything that could run this is currently out of stock.',
    DEFAULT: 'Every option here runs into the same limit you set.',
  },

  /* ── Operational ────────────────────────────────────────────────────── */
  cacheTtlSeconds: 30,
};

/* ── Merge + render helpers ─────────────────────────────────────────────── */

const isPlainObject = (v) => (
  v !== null
  && typeof v === 'object'
  && !Array.isArray(v)
  && !(v instanceof Date)
);

/**
 * Deep-merge an admin's overrides over the defaults.
 *
 * `undefined` and `null` mean "no opinion, inherit" rather than "set to
 * nothing" — a policy document that only sets one penalty must not blank out
 * every field it left alone, which is exactly what a shallow assign would do.
 */
const deepMerge = (base, override) => {
  if (!isPlainObject(override)) return override === undefined ? base : override;

  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || value === null) continue;
    out[key] = isPlainObject(value) && isPlainObject(base[key])
      ? deepMerge(base[key], value)
      : value;
  }
  return out;
};

/**
 * Substitute {placeholders} in an admin-authored sentence.
 *
 * An unrecognised placeholder is deliberately left as-is: a visible `{typo}`
 * is a bug report, whereas a silently blanked one produces a sentence that
 * reads fine and says something false.
 */
const render = (template, context = {}) => String(template || '').replace(
  /\{(\w+)\}/g,
  (match, key) => (
    context[key] === undefined || context[key] === null ? match : String(context[key])
  )
);

module.exports = { DEFAULT_POLICY, deepMerge, render, isPlainObject };
