/**
 * The recommendation engine's public surface.
 *
 * Everything below is deterministic and offline: the same answers always give
 * the same advice, and every recommendation can name the answer that drove it.
 * That was the whole reason for choosing rules over a language model here —
 * a customer about to spend thousands a month on GPUs deserves to see the
 * arithmetic, not a paragraph they have to trust.
 *
 * Two entry points, mirroring the two ways a customer arrives:
 *   sizeForModel()  — they picked a model; size the hardware.
 *   matchModels()   — they only described a workload; pick a model too.
 */
const catalogService = require('../catalog/catalogService');
const questionTemplateService = require('../admin/questionTemplateService');
const catalogCache = require('./catalogCache');
const { buildProfile, publicProfile } = require('./profileBuilder');
const { buildFacts, scoreTiers, pickAlternatives } = require('./tierScorer');
const { assessModel } = require('./modelSuitability');
const { buildReasons } = require('./reasonBuilder');
const { rankModels } = require('./modelRanker');
const { totalVram } = require('./tierFacts');
const { resolvePolicy } = require('./policyResolver');

/** Shape a scored tier for the wire. Never leaks `signals` or raw bindings. */
const serializeTier = (scored, currency = 'USD') => {
  if (!scored) return null;

  const { tier } = scored;

  return {
    tierId: tier.id,
    name: tier.name,
    slug: tier.slug,
    gpuModel: tier.gpuModel,
    gpuCount: tier.gpuCount,
    vramGb: tier.vramGb,
    totalVramGb: scored.totalVram,
    vcpu: tier.vcpu,
    ramGb: tier.ramGb,
    storageGb: tier.storageGb,
    storageType: tier.storageType || '',
    regions: tier.regions || ['default'],
    status: tier.status,
    bookable: scored.bookable,

    listPricePerHour: scored.listRate,
    pricePerHour: scored.rate,
    pricePerDay: scored.daily,
    pricePerMonth: scored.monthly,
    // What the customer keeps paying while the deployment is paused or stopped
    stoppedPricePerHour: scored.stoppedRate,
    stoppedPricePerMonth: scored.stoppedMonthly,
    currency,

    score: scored.score,
    meetsVram: scored.meetsVram,
    underpowered: scored.underpowered,
    recommended: !!scored.link.recommended,
    issues: scored.issues,

    // Only present on the alternatives
    savingsPerMonth: scored.savingsPerMonth,
    tradeoff: scored.tradeoff,
    extraPerMonth: scored.extraPerMonth,
    benefit: scored.benefit,
  };
};

/**
 * Size hardware for a model the customer has already chosen.
 *
 * @param {Object} model            A lean AIModel document
 * @param {Array}  answers          `[{ questionKey, answer }]`
 * @param {Number} discountPercent  Plan discount, already resolved by the caller
 * @param {Object} [policyOverride] A complete policy to score under instead of
 *                                  the live one. Only the admin preview passes
 *                                  this — it is how an unsaved tuning change
 *                                  can be tried without affecting anyone.
 */
const sizeForModel = async (model, answers = [], discountPercent = 0, policyOverride = null) => {
  const [allQuestions, tiers, resolved] = await Promise.all([
    catalogCache.getActiveQuestions(),
    catalogCache.getActiveTiers(),
    policyOverride ? Promise.resolve(policyOverride) : resolvePolicy(),
  ]);

  const policy = resolved;

  const questions = questionTemplateService.scopeToModel(allQuestions, model);
  const profile = buildProfile(questions, answers, policy);

  const facts = buildFacts(model, tiers, discountPercent, policy);
  const scored = scoreTiers(model, facts, profile, policy);
  const { primary, cheaper, headroom } = pickAlternatives(scored, policy);

  const suitability = assessModel(model, profile, scored, policy);
  const reasons = buildReasons(profile, scored, model, policy);

  const currency = (tiers[0] && tiers[0].currency) || 'USD';

  return {
    mode: 'size_model',
    // The one place the customer center is allowed to render engine copy it
    // did not receive per-issue: when every option shares a blocker, the UI
    // needs a sentence about the set rather than about any one item. Sent
    // from the policy so there is no second copy of this wording to drift.
    blockerTemplates: policy.blockerTemplates,
    confidence: profile.confidence,
    answeredCount: profile.answeredCount,
    signalCount: profile.signalBearingCount,
    suitability,
    recommendation: {
      primary: serializeTier(primary, currency),
      cheaper: serializeTier(cheaper, currency),
      headroom: serializeTier(headroom, currency),
      allTiers: scored.map((t) => serializeTier(t, currency)),
    },
    reasons,
    requirementProfile: publicProfile(profile),
    discountPercent,
    currency,
    // Internal — the caller (createDeployment) freezes parts of this onto the
    // deployment. Stripped before the response leaves the controller.
    _profile: profile,
  };
};

/**
 * Rank the catalogue for a customer who has only described a workload.
 */
const matchModels = async (answers = [], options = {}) => {
  const { discountPercent = 0, limit = 5 } = options;

  const [allQuestions, tiers, models, useCaseLabels, policy] = await Promise.all([
    catalogCache.getActiveQuestions(),
    catalogCache.getActiveTiers(),
    catalogCache.getActiveModels(),
    catalogCache.getUseCaseLabels(),
    resolvePolicy(),
  ]);

  // No model chosen yet, so only globally-scoped questions can have been asked.
  const questions = questionTemplateService.scopeToModel(allQuestions, null);
  const profile = buildProfile(questions, answers, policy);

  const ranked = rankModels(models, tiers, profile, {
    discountPercent,
    useCaseLabels,
    limit,
    policy,
  });

  const currency = (tiers[0] && tiers[0].currency) || 'USD';

  return {
    mode: 'match_models',
    blockerTemplates: policy.blockerTemplates,
    confidence: profile.confidence,
    answeredCount: profile.answeredCount,
    signalCount: profile.signalBearingCount,
    matches: ranked.map((entry) => ({
      model: {
        id: entry.model.id,
        name: entry.model.name,
        slug: entry.model.slug,
        family: entry.model.family,
        shortDescription: entry.model.shortDescription,
        logoUrl: entry.model.logoUrl,
        modalities: entry.model.modalities,
        parameterSize: entry.model.parameterSize,
        contextLength: entry.model.contextLength,
        status: entry.model.status,
        isFeatured: entry.model.isFeatured,
        strengths: entry.model.strengths || [],
        limitations: entry.model.limitations || [],
      },
      score: entry.score,
      verdict: entry.verdict,
      issues: entry.issues,
      matchReasons: entry.matchReasons,
      recommendedTier: serializeTier(entry.recommendedTier, currency),
      estimatedMonthlyCost: entry.estimatedMonthlyCost,
    })),
    requirementProfile: publicProfile(profile),
    total: models.length,
    currency,
    _profile: profile,
  };
};

/**
 * Compute the sizing snapshot frozen onto a Deployment at order time.
 *
 * Deliberately recomputed server-side rather than accepted from the client, so
 * it cannot be tampered with and so the fulfilment queue can trust
 * `followedRecommendation` when deciding what to look at closely.
 *
 * Never throws — a sizing failure must not be able to block a deployment.
 */
const buildSizingSnapshot = async (model, answers, chosenTierId, options = {}) => {
  try {
    const { discountPercent = 0, journeyKey = '' } = options;
    const result = await sizeForModel(model, answers, discountPercent);
    const primary = result.recommendation.primary;

    return {
      journeyKey,
      recommendedTierId: primary ? primary.tierId : null,
      recommendedTierName: primary ? primary.name : '',
      followedRecommendation: primary
        ? String(primary.tierId) === String(chosenTierId)
        : null,
      requirementProfile: result.requirementProfile,
      reasons: result.reasons,
      suitabilityVerdict: result.suitability.verdict,
      confidence: result.confidence,
      computedAt: new Date(),
    };
  } catch (err) {
    // Log and carry on — the customer's request matters more than our advice.
    console.error('Sizing snapshot failed (non-fatal):', err.message);
    return null;
  }
};

/** Load a lean model by id, or null. Small helper so controllers stay thin. */
const findModelById = async (modelId) => {
  const model = await catalogService.findModelByIdentifier(modelId);
  return model && model.isActive ? model : null;
};

module.exports = {
  sizeForModel,
  matchModels,
  buildSizingSnapshot,
  findModelById,
  serializeTier,
  totalVram,
  catalogCache,
};
