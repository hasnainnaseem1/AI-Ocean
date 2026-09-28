/**
 * Scenario 2 — the customer described a workload but has not picked a model.
 * Rank the whole catalogue against their requirements.
 *
 * The weights say what the business believes matters: by default what the
 * model is *for* dominates, then whether it technically can do the job, then
 * whether they can afford it, with availability and the featured flag as
 * tiebreakers. All of that is policy, editable from the admin center — this
 * file only knows how to combine the terms, not how much each is worth.
 *
 * With no use-case signals at all, every model scores the neutral value on the
 * dominant term and the ranking collapses to availability plus the catalogue's
 * own display order — i.e. exactly what the customer would have seen browsing
 * manually. Same graceful-degradation principle as the tier scorer.
 */
const { clamp } = require('./signalRegistry');
const { buildFacts, scoreTiers, pickAlternatives } = require('./tierScorer');
const { assessModel } = require('./modelSuitability');
const { buildMatchReasons } = require('./reasonBuilder');

const rankModels = (models, tiers, profile, options = {}) => {
  const { discountPercent = 0, useCaseLabels = {}, limit = 5, policy } = options;

  const cfg = policy.modelRanking;
  const w = cfg.weights;

  // Normalise by the weights' own sum so an admin can enter 45/20/20/10/5 or
  // 9/4/4/2/1 and get the same ranking — and so a set that does not add to 1
  // cannot quietly push every score off the top or bottom of the scale.
  const weightTotal = Object.values(w).reduce((sum, v) => sum + (v || 0), 0) || 1;

  const ranked = (models || []).map((model) => {
    const facts = buildFacts(model, tiers, discountPercent, policy);
    const scored = scoreTiers(model, facts, profile, policy);
    const { primary } = pickAlternatives(scored, policy);
    const suitability = assessModel(model, profile, scored, policy);

    // ── 1. Use-case match: weighted overlap between what they want and what
    //       this model claims to be good at. Neutral when we know nothing. ──
    const wanted = Object.entries(profile.useCaseWeights || {});
    const totalWeight = wanted.reduce((sum, [, weight]) => sum + weight, 0);

    const useCaseMatch = totalWeight === 0
      ? cfg.neutralUseCaseMatch
      : wanted.reduce((sum, [key, weight]) => {
        const claim = (model.useCases || []).find((u) => u.key === key);
        return sum + weight * (claim ? (policy.fitWeights[claim.fit] || 0) : 0);
      }, 0) / totalWeight;

    // ── 2. Can it technically do the job? ──
    const needed = profile.requiresModalities || [];
    const modalityFit = needed.length === 0
      ? 1
      : needed.filter((m) => (model.modalities || []).includes(m)).length / needed.length;

    const needContext = profile.floors.minContextLength;
    const contextFit = !needContext || !model.contextLength
      ? 1
      : clamp(model.contextLength / needContext, 0, 1);

    const capabilityFit = cfg.capabilitySplit.modality * modalityFit
      + cfg.capabilitySplit.context * contextFit;

    // ── 3. Can they afford it? Linear falloff to zero at the configured
    //       multiple of their stated budget. ──
    const budget = profile.ceilings.maxMonthlyBudget;
    const zeroAt = cfg.budgetZeroAtMultiple;
    const budgetFit = !budget || !primary
      ? 1
      : clamp((zeroAt - primary.monthly / budget) / (zeroAt - 1 || 1), 0, 1);

    // ── 4 & 5. Tiebreakers ──
    const statusFit = cfg.statusFit[model.status] === undefined
      ? cfg.unknownStatusFit
      : cfg.statusFit[model.status];
    const availability = statusFit
      * (primary && primary.bookable ? 1 : cfg.unbookableMultiplier);
    const popularity = model.isFeatured ? cfg.featuredPopularity : cfg.defaultPopularity;

    const score = Math.round(100 * (
      w.useCase * useCaseMatch
      + w.capability * capabilityFit
      + w.budget * budgetFit
      + w.availability * availability
      + w.popularity * popularity
    ) / weightTotal);

    return {
      model,
      score,
      verdict: suitability.verdict,
      issues: suitability.issues,
      recommendedTier: primary,
      estimatedMonthlyCost: primary ? primary.monthly : null,
      matchReasons: buildMatchReasons(model, profile, primary, useCaseLabels, policy),
      breakdown: { useCaseMatch, capabilityFit, budgetFit, availability, popularity },
    };
  });

  return ranked
    .sort((a, b) => (
      b.score - a.score
      || (a.model.displayOrder || 0) - (b.model.displayOrder || 0)
    ))
    .slice(0, limit);
};

module.exports = { rankModels };
