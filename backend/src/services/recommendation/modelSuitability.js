/**
 * Is this model actually a good fit for what the customer described?
 *
 * Purely advisory. A `poor` verdict renders as a warning panel with a
 * "continue anyway" button — it never blocks a deployment, and `POST
 * /deployments` keeps exactly the validation it already had. The one thing
 * this must not do is promise something the create endpoint will then reject,
 * which is why `coming_soon` defaults to `high` severity rather than a gentle
 * note.
 *
 * Every threshold, severity and sentence here comes from the active
 * RecommendationPolicy — including which model statuses count as a problem,
 * so a new status can be handled from the admin center rather than by
 * extending an if/else chain.
 */
const { clamp, fmt, money, modalityLabel, humanList } = require('./signalRegistry');
const { render } = require('./policyDefaults');

/** The first answer that contributed a given field, for "you said X" attribution. */
const firstBindingFor = (profile, field) =>
  (profile.bindings || []).find((b) => b.field === field) || null;

const assessModel = (model, profile, scoredTiers, policy) => {
  const cfg = policy.suitability;
  const copy = policy.suitabilityTemplates;

  const issues = [];
  const bookable = (scoredTiers || []).filter((t) => t.bookable);
  const cheapest = [...bookable].sort((a, b) => a.rate - b.rate)[0] || null;
  const requiredVram = Math.max(model.minVramGb || 0, profile.floors.minVramGb || 0);

  const base = { modelName: model.name };

  // ── 1. Modality mismatch — the hardest kind of "wrong model" ──
  const missing = (profile.requiresModalities || [])
    .filter((m) => !(model.modalities || []).includes(m));

  if (missing.length) {
    const binding = firstBindingFor(profile, 'requiresModalities');
    issues.push({
      code: 'MODALITY_MISMATCH',
      severity: 'high',
      message: render(copy.MODALITY_MISMATCH, {
        ...base,
        missingModalities: humanList(missing.map((m) => modalityLabel(m, policy))),
      }),
      questionKey: binding ? binding.questionKey : null,
    });
  }

  // ── 2. Context shortfall. contextLength 0 means "not recorded", never penalise. ──
  const needContext = profile.floors.minContextLength;
  if (needContext && model.contextLength > 0 && model.contextLength < needContext) {
    const ratio = model.contextLength / needContext;
    const binding = firstBindingFor(profile, 'minContextLength');
    issues.push({
      code: 'CONTEXT_SHORTFALL',
      severity: ratio >= cfg.contextMediumAtOrAboveRatio ? 'medium' : 'high',
      message: render(copy.CONTEXT_SHORTFALL, {
        ...base,
        modelContext: fmt(model.contextLength),
        requirement: fmt(needContext),
      }),
      questionKey: binding ? binding.questionKey : null,
    });
  }

  // ── 3. Budget ──
  const budget = profile.ceilings.maxMonthlyBudget;
  if (budget && cheapest) {
    const binding = firstBindingFor(profile, 'maxMonthlyBudget');
    const ctx = { ...base, actualMoney: money(cheapest.monthly), requirementMoney: money(budget) };

    if (cheapest.monthly > budget) {
      issues.push({
        code: 'BUDGET_IMPOSSIBLE',
        severity: 'high',
        message: render(copy.BUDGET_IMPOSSIBLE, ctx),
        questionKey: binding ? binding.questionKey : null,
      });
    } else if (cheapest.monthly > budget * cfg.budgetTightAboveRatio) {
      issues.push({
        code: 'BUDGET_TIGHT',
        severity: 'low',
        message: render(copy.BUDGET_TIGHT, ctx),
        questionKey: binding ? binding.questionKey : null,
      });
    }
  }

  // ── 4. Availability of the model itself ──
  // Which statuses matter, and how much, is policy — not a hardcoded chain.
  const statusSeverity = (cfg.modelStatusSeverity || {})[model.status];
  if (statusSeverity) {
    const code = `MODEL_${String(model.status).toUpperCase()}`;
    issues.push({
      code,
      severity: statusSeverity,
      message: render(copy[code] || copy.MODEL_UNAVAILABLE || '', base),
      questionKey: null,
    });
  }

  // ── 5. Can we actually put it anywhere? ──
  if (!bookable.length) {
    issues.push({
      code: 'NO_BOOKABLE_TIER',
      severity: 'high',
      message: render(copy.NO_BOOKABLE_TIER, base),
      questionKey: null,
    });
  } else if (requiredVram > 0 && !bookable.some((t) => t.meetsVram)) {
    issues.push({
      code: 'VRAM_UNSUPPORTED',
      severity: 'medium',
      message: render(copy.VRAM_UNSUPPORTED, { ...base, requirement: fmt(requiredVram) }),
      questionKey: null,
    });
  }

  const count = (severity) => issues.filter((i) => i.severity === severity).length;

  const highs = count('high');

  // A high-severity issue that does not reach the "poor" threshold still has
  // to surface as a caution. Without this clause, raising poorAtHighCount to 2
  // would make a single hard problem — a modality mismatch, an out-of-stock
  // catalogue — report as `good`, which is worse than either verdict it sits
  // between.
  const verdict = highs >= cfg.verdict.poorAtHighCount
    ? 'poor'
    : (highs > 0
      || count('medium') >= cfg.verdict.cautionAtMediumCount
      || count('low') >= cfg.verdict.cautionAtLowCount)
      ? 'caution'
      : 'good';

  const score = clamp(
    100
    - count('high') * cfg.scorePenalties.high
    - count('medium') * cfg.scorePenalties.medium
    - count('low') * cfg.scorePenalties.low,
    0,
    100
  );

  return { verdict, score, issues };
};

module.exports = { assessModel, firstBindingFor };
