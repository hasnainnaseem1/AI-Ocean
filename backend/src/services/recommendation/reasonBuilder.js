/**
 * Turn a requirement profile and a scored tier list into sentences a customer
 * can check against their own answers.
 *
 * The whole point of choosing a rule engine over an LLM was that every
 * recommendation can be traced to the answer that caused it. This file is
 * where that promise is kept, so nothing here may invent a justification: each
 * reason names the exact question, the exact option label the customer chose,
 * and the number that option contributed.
 */
const {
  FLOORS, CEILINGS, FIELD_TO_CODE, fmt, money, rate: rateStr, quote, modalityLabel,
} = require('./signalRegistry');
const { render } = require('./policyDefaults');

/**
 * Render one reason from the active policy's templates.
 *
 * The admin's own `note` on a signal always wins — if they took the trouble to
 * write the sentence for this specific answer, it beats anything a template
 * can produce. Failing that, the policy's template for the code is used, so
 * all wording is editable without touching this file.
 */
const renderReason = (reason, policy) => {
  if (reason.note) return reason.note;

  const template = (policy.reasonTemplates || {})[reason.code];
  if (!template) return '';

  return render(template, {
    answerLabel: quote(reason.answerLabel),
    answerLabelRaw: reason.answerLabel || '',
    question: reason.question || '',
    modelName: reason.modelName || '',
    requirement: fmt(reason.requirement),
    requirementMoney: money(reason.requirement),
    requirementRate: rateStr(reason.requirement),
    requirementModality: modalityLabel(reason.requirement, policy),
    actual: fmt(reason.actual),
    actualMoney: money(reason.actual),
    actualRate: rateStr(reason.actual),
  });
};

/**
 * Does this tier fail the given constraint?
 *
 * Used to decide which constraints were actually decisive — see `impact` below.
 */
const violates = (scoredTier, field, requirement) => {
  if (!scoredTier) return false;

  switch (field) {
    case 'minVramGb': return scoredTier.totalVram < requirement;
    case 'minGpuCount': return (scoredTier.tier.gpuCount || 1) < requirement;
    case 'minVcpu': return (scoredTier.tier.vcpu || 0) < requirement;
    case 'minRamGb': return (scoredTier.tier.ramGb || 0) < requirement;
    case 'maxMonthlyBudget': return scoredTier.monthly > requirement;
    case 'maxPricePerHour': return scoredTier.rate > requirement;
    // A model capability, not a property of the tier — never decisive here.
    case 'minContextLength': return false;
    default: return false;
  }
};

/**
 * Build the customer-facing reasons list.
 *
 * `impact: 'primary'` means "this constraint is why the winner won". It is
 * decided by the honest, cheap rule: if the runner-up tier would have failed
 * this constraint, then this constraint is what separated them. No sensitivity
 * analysis — that would be more precise, slower, and much harder to explain,
 * which defeats the purpose.
 */
const buildReasons = (profile, scored, model, policy) => {
  const runnerUp = scored[1] || null;
  const winner = scored[0] || null;
  const reasons = [];

  for (const field of [...FLOORS, ...CEILINGS]) {
    const merged = profile.floors[field] !== null && profile.floors[field] !== undefined
      ? profile.floors[field]
      : profile.ceilings[field];

    if (merged === null || merged === undefined) continue;

    // The single binding that achieved the merged value — that is the answer
    // worth citing. Ties break on question order so the earliest answer wins,
    // which reads more naturally than an arbitrary pick.
    const binding = (profile.bindings || [])
      .filter((b) => b.field === field && b.value === merged)
      .sort((a, b) => (a.questionOrder || 0) - (b.questionOrder || 0))[0];

    if (!binding) continue;

    const code = FIELD_TO_CODE[field];

    reasons.push({
      code,
      field,
      requirement: merged,
      source: 'answer',
      questionKey: binding.questionKey,
      question: binding.question,
      answerValue: binding.answerValue,
      answerLabel: binding.answerLabel,
      text: renderReason({ ...binding, code, requirement: merged }, policy),
      impact: runnerUp && violates(runnerUp, field, merged) ? 'primary' : 'supporting',
      severity: 'info',
    });
  }

  // Modality requirements come from answers too, but are a capability rather
  // than a number, so they don't fit the floors/ceilings loop.
  for (const modality of profile.requiresModalities || []) {
    const binding = (profile.bindings || [])
      .find((b) => b.field === 'requiresModalities' && b.value === modality);
    if (!binding) continue;

    reasons.push({
      code: 'MODALITY_REQUIRED',
      field: 'requiresModalities',
      requirement: modality,
      source: 'answer',
      questionKey: binding.questionKey,
      question: binding.question,
      answerValue: binding.answerValue,
      answerLabel: binding.answerLabel,
      text: renderReason({ ...binding, code: 'MODALITY_REQUIRED', requirement: modality }, policy),
      impact: 'supporting',
      severity: 'info',
    });
  }

  // The catalogue's own floor, when it is what binds rather than any answer.
  if (model && (model.minVramGb || 0) > 0 && model.minVramGb >= (profile.floors.minVramGb || 0)) {
    reasons.push({
      code: 'MODEL_MINIMUM',
      field: 'minVramGb',
      requirement: model.minVramGb,
      source: 'model',
      questionKey: null,
      question: null,
      answerValue: null,
      answerLabel: null,
      text: renderReason({
        code: 'MODEL_MINIMUM', modelName: model.name, requirement: model.minVramGb,
      }, policy),
      impact: 'supporting',
      severity: 'info',
    });
  }

  // Infeasibility is a warning, never an error — see the note in tierScorer.
  const budget = profile.ceilings.maxMonthlyBudget;
  if (budget && winner && winner.monthly > budget) {
    // Attribute it to the answer that set the ceiling, so the UI can offer to
    // go back and change that specific answer rather than just stating the
    // problem and leaving the customer to find it.
    const budgetBinding = (profile.bindings || [])
      .find((b) => b.field === 'maxMonthlyBudget' && b.value === budget);

    reasons.push({
      code: 'BUDGET_INFEASIBLE',
      field: 'maxMonthlyBudget',
      requirement: budget,
      actual: winner.monthly,
      source: 'catalog',
      questionKey: budgetBinding ? budgetBinding.questionKey : null,
      question: budgetBinding ? budgetBinding.question : null,
      answerValue: budgetBinding ? budgetBinding.answerValue : null,
      answerLabel: budgetBinding ? budgetBinding.answerLabel : null,
      text: renderReason({
        code: 'BUDGET_INFEASIBLE', requirement: budget, actual: winner.monthly,
      }, policy),
      impact: 'primary',
      severity: 'warning',
    });
  }

  // Whatever is wrong with the tier we picked rides in the same array, so the
  // UI has one list to render rather than two to reconcile.
  for (const issue of (winner && winner.issues) || []) {
    reasons.push({
      code: issue.code,
      field: null,
      requirement: null,
      source: 'catalog',
      questionKey: null,
      question: null,
      answerValue: null,
      answerLabel: null,
      text: issue.message,
      impact: 'supporting',
      severity: 'warning',
    });
  }

  return reasons.sort((a, b) =>
    (a.impact === 'primary' ? 0 : 1) - (b.impact === 'primary' ? 0 : 1));
};

/**
 * Per-model "why this one" bullets for the Scenario 2 model picker.
 * Capped, because a wall of reasons reads as marketing rather than advice.
 */
const buildMatchReasons = (model, profile, primaryTier, useCaseLabels = {}, policy) => {
  const copy = policy.matchReasonTemplates;
  const limits = policy.matchReasonLimits;
  const reasons = [];

  // Strongest use-case claims first — the customer's own words back at them.
  const wanted = Object.entries(profile.useCaseWeights || {})
    .sort((a, b) => b[1] - a[1]);

  for (const [key] of wanted.slice(0, limits.maxUseCases)) {
    const claim = (model.useCases || []).find((u) => u.key === key);
    if (!claim) continue;
    const label = claim.label || useCaseLabels[key] || key.replace(/_/g, ' ');
    reasons.push({
      code: 'USE_CASE_MATCH',
      // The admin's own sentence for this model beats the template.
      text: claim.note || render(copy.USE_CASE_MATCH, { fit: claim.fit, useCase: label }),
    });
  }

  const needContext = profile.floors.minContextLength;
  if (needContext && model.contextLength >= needContext) {
    reasons.push({
      code: 'CONTEXT_HEADROOM',
      text: render(copy.CONTEXT_HEADROOM, { modelContext: fmt(model.contextLength) }),
    });
  }

  const budget = profile.ceilings.maxMonthlyBudget;
  if (budget && primaryTier && primaryTier.monthly <= budget) {
    reasons.push({
      code: 'WITHIN_BUDGET',
      text: render(copy.WITHIN_BUDGET, {
        actualMoney: money(primaryTier.monthly),
        requirementMoney: money(budget),
      }),
    });
  }

  for (const strength of (model.strengths || []).slice(0, limits.maxStrengths)) {
    reasons.push({ code: 'STRENGTH', text: strength });
  }

  return reasons.slice(0, limits.maxTotal);
};

module.exports = { buildReasons, buildMatchReasons, violates };
