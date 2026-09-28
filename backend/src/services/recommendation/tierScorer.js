/**
 * Score every tier a model supports against the customer's requirement profile.
 *
 * The governing rule for this whole file:
 *
 *   CONSTRAINTS RANK AND WARN. THEY NEVER REJECT.
 *
 * A tier that misses the VRAM requirement, blows the budget or is out of stock
 * is pushed down the list and given an issue to explain itself — it is never
 * removed. This is the existing `underpowered` philosophy from
 * catalogController.js applied uniformly, and it is what lets a customer
 * knowingly proceed with something we advised against.
 *
 * Not one number below is written into this file. Every penalty, bonus,
 * threshold and sentence comes from the active RecommendationPolicy, so the
 * business can retune the suggestions without a deploy.
 */
const {
  clamp, norm, round2, round4, fmt, money, rate: rateStr,
} = require('./signalRegistry');
const { render } = require('./policyDefaults');
const { isBookable, totalVram } = require('./tierFacts');

/**
 * Resolve the raw facts for each supported tier: price after multiplier and
 * discount, total VRAM, and whether it can actually be booked right now.
 */
const buildFacts = (model, tiers, discountPercent = 0, policy) => {
  const hoursPerMonth = policy.tierScoring.hoursPerMonth;

  return (model.supportedTiers || [])
    .map((link) => {
      const tier = tiers.find((t) => String(t.id) === String(link.tierId));
      if (!tier || !tier.isActive) return null;

      const multiplier = link.priceMultiplier === null || link.priceMultiplier === undefined
        ? 1
        : link.priceMultiplier;
      const listRate = round4(tier.pricePerHour * multiplier);
      const rate = round4(listRate * (1 - discountPercent / 100));
      // What holding this machine costs while paused or stopped — the disk the
      // customer still occupies. Priced the same way as the running rate, so
      // the multiplier and the plan discount both apply.
      const stoppedRate = round4(
        (tier.stoppedPricePerHour || 0) * multiplier * (1 - discountPercent / 100)
      );
      const vram = totalVram(tier);

      return {
        tier,
        link,
        listRate,
        rate,
        stoppedRate,
        stoppedMonthly: round2(stoppedRate * hoursPerMonth),
        totalVram: vram,
        monthly: round2(rate * hoursPerMonth),
        daily: round2(rate * 24),
        // Price per GB of VRAM is a decent, entirely data-driven proxy for how
        // fast the silicon is (an H100 80GB costs more than an A100 80GB
        // precisely because it is quicker). An admin can override it outright
        // with `metadata.perfIndex` when the proxy is wrong.
        perfProxy: tier.metadata && tier.metadata.perfIndex !== undefined
          ? tier.metadata.perfIndex
          : (vram > 0 ? rate / vram : 0),
        bookable: isBookable(tier),
      };
    })
    .filter(Boolean);
};

/**
 * Score each tier against the profile.
 *
 * The shape of the scoring — VRAM adequacy dominating, budget and stock
 * mattering a lot, the admin's own `recommended` flag being a real but
 * non-decisive nudge — is expressed entirely through the policy's weights.
 */
const scoreTiers = (model, facts, profile, policy) => {
  if (!facts.length) return [];

  const cfg = policy.tierScoring;
  const copy = policy.tierIssueTemplates;

  const rates = facts.map((f) => f.rate);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);

  const perfs = facts.map((f) => f.perfProxy);
  const minPerf = Math.min(...perfs);
  const maxPerf = Math.max(...perfs);

  // Whichever is stricter: what the model itself needs, or what the answers imply.
  const requiredVram = Math.max(model.minVramGb || 0, profile.floors.minVramGb || 0);

  const costWeight = profile.priorities.costPriority === null
    ? cfg.defaultCostPriority
    : profile.priorities.costPriority;
  const latencyWeight = profile.priorities.latencyPriority === null
    ? cfg.defaultLatencyPriority
    : profile.priorities.latencyPriority;

  const budget = profile.ceilings.maxMonthlyBudget;

  return facts
    .map((fact) => {
      let score = cfg.baseScore;
      const issues = [];

      /** Shared substitution context for any message about this tier. */
      const ctx = (extra = {}) => ({
        tierName: fact.tier.name,
        tierVram: fmt(fact.totalVram),
        tierGpuCount: fmt(fact.tier.gpuCount),
        tierVcpu: fmt(fact.tier.vcpu),
        tierRam: fmt(fact.tier.ramGb),
        actualMoney: money(fact.monthly),
        actualRate: rateStr(fact.rate),
        modelName: model.name,
        ...extra,
      });

      // ── 1. VRAM — the dominant term, and advisory, not a filter ──
      if (requiredVram > 0) {
        const ratio = fact.totalVram / requiredVram;

        if (ratio < 1) {
          const span = cfg.vram.fullPenaltyAtRatio;
          score -= clamp(
            cfg.vram.maxPenalty * ((1 - ratio) / (span > 0 ? span : 1)),
            0,
            cfg.vram.maxPenalty
          );
          issues.push({
            code: 'VRAM_SHORTFALL',
            severity: ratio < cfg.vram.highSeverityBelowRatio ? 'high' : 'medium',
            message: render(copy.VRAM_SHORTFALL, ctx({ requirement: fmt(requiredVram) })),
          });
        } else if (ratio > cfg.vram.overProvisionFromRatio) {
          // Paying for silicon that will sit idle.
          score -= clamp(
            cfg.vram.overProvisionPenaltyPerUnit * (ratio - cfg.vram.overProvisionFromRatio),
            0,
            cfg.vram.overProvisionMaxPenalty
          );
        }
      }

      // ── 2. Remaining floors from the profile ──
      if (profile.floors.minGpuCount && fact.tier.gpuCount < profile.floors.minGpuCount) {
        score -= cfg.floors.gpuCountPenalty;
        issues.push({
          code: 'GPU_COUNT_SHORTFALL',
          severity: 'medium',
          message: render(copy.GPU_COUNT_SHORTFALL, ctx({ requirement: fmt(profile.floors.minGpuCount) })),
        });
      }
      if (profile.floors.minVcpu && (fact.tier.vcpu || 0) < profile.floors.minVcpu) {
        score -= cfg.floors.vcpuPenalty;
        issues.push({
          code: 'VCPU_SHORTFALL',
          severity: 'low',
          message: render(copy.VCPU_SHORTFALL, ctx({ requirement: fmt(profile.floors.minVcpu) })),
        });
      }
      if (profile.floors.minRamGb && (fact.tier.ramGb || 0) < profile.floors.minRamGb) {
        score -= cfg.floors.ramPenalty;
        issues.push({
          code: 'RAM_SHORTFALL',
          severity: 'low',
          message: render(copy.RAM_SHORTFALL, ctx({ requirement: fmt(profile.floors.minRamGb) })),
        });
      }

      // ── 3. Budget ceiling ──
      if (budget) {
        const over = fact.monthly / budget;
        if (over > 1) {
          const span = cfg.budget.fullPenaltyAtMultiple - 1;
          score -= clamp(
            cfg.budget.maxPenalty * ((over - 1) / (span > 0 ? span : 1)),
            0,
            cfg.budget.maxPenalty
          );
          issues.push({
            code: 'OVER_BUDGET',
            severity: over > cfg.budget.highSeverityAboveMultiple ? 'high' : 'medium',
            message: render(copy.OVER_BUDGET, ctx({ requirementMoney: money(budget) })),
          });
        } else {
          score += cfg.budget.headroomReward * (1 - over);
        }
      }
      if (profile.ceilings.maxPricePerHour && fact.rate > profile.ceilings.maxPricePerHour) {
        score -= cfg.budget.hourlyCapPenalty;
        issues.push({
          code: 'OVER_HOURLY_CAP',
          severity: 'medium',
          message: render(copy.OVER_HOURLY_CAP, ctx({
            requirementRate: rateStr(profile.ceilings.maxPricePerHour),
          })),
        });
      }

      // ── 4. Price efficiency, normalised across this model's own tiers ──
      score += costWeight * cfg.costEfficiencyWeight * (1 - norm(fact.rate, minRate, maxRate));

      // ── 5. Faster silicon, but only if they asked for low latency ──
      score += latencyWeight * cfg.latencyWeight * norm(fact.perfProxy, minPerf, maxPerf);

      // ── 6. Stock. Heavily de-prioritised, never removed. ──
      if (!fact.bookable) {
        score -= cfg.stock.outOfStockPenalty;
        issues.push({
          code: 'OUT_OF_STOCK',
          severity: 'high',
          message: render(copy.OUT_OF_STOCK, ctx()),
        });
      } else if (fact.tier.status === 'limited') {
        score -= cfg.stock.limitedPenalty;
        issues.push({
          code: 'LIMITED_STOCK',
          severity: 'low',
          message: render(copy.LIMITED_STOCK, ctx()),
        });
      }

      // ── 7. The admin's own opinion — respected, never decisive ──
      if (fact.link.recommended) score += cfg.adminRecommendedBonus;

      return {
        ...fact,
        // Rank on the raw score and clamp only for display. Clamping before
        // sorting would saturate every unpenalised tier at the ceiling and
        // silently throw away the bonuses — the admin's `recommended` flag and
        // price efficiency would stop mattering entirely, and the tiebreak
        // would decide instead.
        rawScore: score,
        score: clamp(Math.round(score), 0, 100),
        meetsVram: requiredVram === 0 || fact.totalVram >= requiredVram,
        // Same field name and semantics as catalogController.js so the two
        // never disagree about what "underpowered" means.
        underpowered: (model.minVramGb || 0) > 0 && fact.totalVram < model.minVramGb,
        issues,
      };
    })
    .sort((a, b) => (
      b.rawScore - a.rawScore
      || a.rate - b.rate
      || (a.tier.displayOrder || 0) - (b.tier.displayOrder || 0)
    ));
};

/**
 * The primary pick plus the two alternatives worth offering.
 *
 * `cheaper` prefers something that still actually fits; only if nothing cheaper
 * is adequate does it fall back to the cheapest bookable option, and then the
 * trade-off is stated rather than hidden.
 *
 * `headroom` is the CHEAPEST step up — "the next size", not "the biggest box we
 * sell", which would read as an upsell rather than advice.
 */
const pickAlternatives = (scored, policy) => {
  const primary = scored[0] || null;
  if (!primary) return { primary: null, cheaper: null, headroom: null };

  const copy = policy.alternativeTemplates;

  const cheaperAdequate = scored.filter((t) => t.rate < primary.rate && t.meetsVram && t.bookable);
  let cheaper = cheaperAdequate[0] || null;

  if (!cheaper) {
    cheaper = scored
      .filter((t) => t.rate < primary.rate && t.bookable)
      .sort((a, b) => a.rate - b.rate)[0] || null;
  }

  let headroom = scored
    .filter((t) => t.rate > primary.rate && t.totalVram >= primary.totalVram && t.bookable)
    .sort((a, b) => a.rate - b.rate)[0] || null;

  if (cheaper) {
    cheaper = {
      ...cheaper,
      savingsPerMonth: round2(primary.monthly - cheaper.monthly),
      tradeoff: render(
        cheaper.meetsVram ? copy.CHEAPER_ADEQUATE : copy.CHEAPER_INADEQUATE,
        { tierVram: fmt(cheaper.totalVram), primaryVram: fmt(primary.totalVram) }
      ),
    };
  }

  if (headroom) {
    headroom = {
      ...headroom,
      extraPerMonth: round2(headroom.monthly - primary.monthly),
      benefit: render(copy.HEADROOM, {
        tierVram: fmt(headroom.totalVram),
        tierGpuCount: fmt(headroom.tier.gpuCount),
      }),
    };
  }

  return { primary, cheaper, headroom };
};

module.exports = { buildFacts, scoreTiers, pickAlternatives };
