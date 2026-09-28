/**
 * Turn a customer's questionnaire answers into a requirement profile.
 *
 * Three invariants this file must hold, each covered by a unit test:
 *
 *   1. ORDER-INDEPENDENT — max/min/union/sum are commutative and associative,
 *      so the profile never depends on the order answers arrive in.
 *   2. IDEMPOTENT — merging the same answer twice changes nothing (preference
 *      weights dedupe by question+value for exactly this reason).
 *   3. DEGRADES TO NOTHING — with no signal-bearing answers every floor and
 *      ceiling stays null, and the scorer falls back to today's behaviour.
 *      There is no "unconfigured" special case anywhere; it falls out of the
 *      arithmetic.
 */
const { FLOORS, CEILINGS, PRIORITIES } = require('./signalRegistry');

/** An empty profile — every constraint absent, meaning "no opinion". */
const emptyProfile = () => ({
  floors: FLOORS.reduce((acc, f) => ({ ...acc, [f]: null }), {}),
  ceilings: CEILINGS.reduce((acc, f) => ({ ...acc, [f]: null }), {}),
  priorities: PRIORITIES.reduce((acc, f) => ({ ...acc, [f]: null }), {}),
  requiresModalities: [],
  useCaseWeights: {},
  uptimeClass: null,

  // Every contribution recorded PRE-merge. This array is the entire basis of
  // explainability — reasons are built by finding which binding achieved each
  // merged value.
  bindings: [],

  answeredCount: 0,
  signalBearingCount: 0,
  confidence: 'none',
});

/**
 * Is a question currently on screen?
 *
 * This is not cosmetic. If a customer ticks "I need fine-tuning", answers the
 * follow-up, then toggles fine-tuning back off, the UI keeps the stale
 * follow-up answer in state. Without this filter that retracted answer keeps
 * inflating the VRAM floor, and we would show a "because you said…" reason
 * citing a question that is no longer visible. Most likely correctness bug in
 * the whole feature.
 */
const isVisible = (question, answerMap) => {
  const dep = question.dependsOn;
  if (!dep || !dep.questionKey) return true;
  return answerMap[dep.questionKey] === dep.equals;
};

/** Has the customer actually answered this? Mirrors the frontend's own check. */
const isAnswered = (value, type) => {
  if (type === 'boolean') return value !== undefined && value !== null;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
};

/** Evaluate one `signalRules[].when` clause against a raw answer. */
const matchesRule = (when, answer) => {
  if (!when || !when.op) return false;
  const num = Number(answer);

  switch (when.op) {
    case 'isTrue': return answer === true;
    case 'isFalse': return answer === false;
    case 'eq': return answer === when.value;
    case 'gte': return Number.isFinite(num) && num >= Number(when.value);
    case 'gt': return Number.isFinite(num) && num > Number(when.value);
    case 'lte': return Number.isFinite(num) && num <= Number(when.value);
    case 'lt': return Number.isFinite(num) && num < Number(when.value);
    case 'between':
      return Number.isFinite(num)
        && num >= Number(when.value)
        && num <= Number(when.value2);
    default: return false;
  }
};

/** Fallback phrase when an admin didn't write a `label` on a signal rule. */
const describeRule = (when) => {
  switch (when.op) {
    case 'isTrue': return 'you answered yes';
    case 'isFalse': return 'you answered no';
    case 'eq': return `you answered ${when.value}`;
    case 'gte': return `${when.value} or more`;
    case 'gt': return `more than ${when.value}`;
    case 'lte': return `${when.value} or fewer`;
    case 'lt': return `fewer than ${when.value}`;
    case 'between': return `between ${when.value} and ${when.value2}`;
    default: return 'your answer';
  }
};

/**
 * Every signal set a single answer produces, with the human label to cite.
 * A multiselect legitimately yields several — that needs no special handling
 * downstream, since merging is associative.
 */
const extractSignalSets = (question, answer) => {
  const sets = [];
  const options = question.options || [];

  const pushOption = (option) => {
    if (option && option.signals) {
      sets.push({
        signals: option.signals,
        answerValue: option.value,
        answerLabel: option.label,
      });
    }
  };

  switch (question.type) {
    case 'select':
    case 'radio':
      pushOption(options.find((o) => o.value === answer));
      break;

    case 'multiselect':
      (Array.isArray(answer) ? answer : [answer])
        .forEach((value) => pushOption(options.find((o) => o.value === value)));
      break;

    case 'number':
    case 'boolean':
      [...(question.signalRules || [])]
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
        .filter((rule) => matchesRule(rule.when, answer))
        .forEach((rule) => sets.push({
          signals: rule.signals,
          answerValue: answer,
          answerLabel: rule.label || describeRule(rule.when),
        }));
      break;

    // text / textarea deliberately contribute nothing — free text is not
    // interpretable without an LLM, and this engine is rule-based by design.
    default:
      break;
  }

  return sets;
};

/** Merge one signal set into the accumulating profile. */
const mergeSignals = (profile, signals, source, policy) => {
  const record = (field, value) => profile.bindings.push({
    field, value, ...source, note: signals.note || '',
  });

  for (const field of FLOORS) {
    const value = signals[field];
    if (value === null || value === undefined) continue;
    if (profile.floors[field] === null || value > profile.floors[field]) {
      profile.floors[field] = value;
    }
    record(field, value);
  }

  for (const field of CEILINGS) {
    const value = signals[field];
    if (value === null || value === undefined) continue;
    if (profile.ceilings[field] === null || value < profile.ceilings[field]) {
      profile.ceilings[field] = value;
    }
    record(field, value);
  }

  for (const field of PRIORITIES) {
    const value = signals[field];
    if (value === null || value === undefined) continue;
    profile.priorities[field] = Math.max(profile.priorities[field] || 0, value);
  }

  for (const modality of signals.requiresModalities || []) {
    if (!profile.requiresModalities.includes(modality)) {
      profile.requiresModalities.push(modality);
      record('requiresModalities', modality);
    }
  }

  for (const pref of signals.prefersUseCases || []) {
    if (!pref || !pref.useCase) continue;
    const weight = pref.weight === null || pref.weight === undefined ? 1 : pref.weight;
    profile.useCaseWeights[pref.useCase] = (profile.useCaseWeights[pref.useCase] || 0) + weight;
  }

  if (signals.uptimeClass) {
    // Rank order is policy: an admin can add an uptime class without this
    // file having to learn about it.
    const ranks = policy.uptimeRanks || {};
    const incoming = ranks[signals.uptimeClass];
    const current = profile.uptimeClass === null ? -1 : ranks[profile.uptimeClass];
    if (incoming > current) {
      profile.uptimeClass = signals.uptimeClass;
      record('uptimeClass', signals.uptimeClass);
    }
  }
};

/**
 * Build the requirement profile.
 *
 * @param {Array}  questions  Active questions already scoped to the model
 *                            (i.e. the output of QuestionTemplate.getForModel)
 * @param {Array}  answers    `[{ questionKey, answer }]` straight from the client
 */
const buildProfile = (questions, answers = [], policy) => {
  const profile = emptyProfile();

  const answerMap = {};
  for (const entry of answers) {
    if (entry && entry.questionKey !== undefined) {
      answerMap[entry.questionKey] = entry.answer;
    }
  }

  const visible = (questions || []).filter((q) => isVisible(q, answerMap));

  for (const question of visible) {
    const answer = answerMap[question.key];
    if (!isAnswered(answer, question.type)) continue;

    profile.answeredCount++;

    const sets = extractSignalSets(question, answer);
    if (sets.length) profile.signalBearingCount++;

    for (const set of sets) {
      mergeSignals(profile, set.signals, {
        questionKey: question.key,
        question: question.question,
        questionOrder: question.displayOrder || 0,
        answerValue: set.answerValue,
        answerLabel: set.answerLabel,
      }, policy);
    }
  }

  // Max-normalise preference weights so scores are scale-free: adding a third
  // weak vote must never overtake the primary use case.
  const weights = Object.values(profile.useCaseWeights);
  if (weights.length) {
    const max = Math.max(1, ...weights);
    for (const key of Object.keys(profile.useCaseWeights)) {
      profile.useCaseWeights[key] /= max;
    }
  }

  profile.confidence = deriveConfidence(profile, policy);

  return profile;
};

/**
 * How much the engine actually knows. The UI hides the reasons panel entirely
 * on 'none' rather than presenting an empty explanation as if it were one.
 */
const deriveConfidence = (profile, policy) => {
  const n = profile.signalBearingCount;
  const thresholds = policy.confidence;

  if (n === 0) return 'none';
  if (n <= thresholds.lowMaxSignals) return 'low';

  const hasHardFloor = FLOORS.some((f) => profile.floors[f] !== null);
  if (n <= thresholds.mediumMaxSignals) return 'medium';

  // Plenty of soft answers but nothing that actually sizes anything.
  return hasHardFloor ? 'high' : 'medium';
};

/** The customer-safe view — no `bindings`, which leak internal sizing policy. */
const publicProfile = (profile) => ({
  ...profile.floors,
  ...profile.ceilings,
  requiresModalities: profile.requiresModalities,
  uptimeClass: profile.uptimeClass,
  confidence: profile.confidence,
  answeredCount: profile.answeredCount,
  signalCount: profile.signalBearingCount,
});

module.exports = {
  buildProfile,
  publicProfile,
  emptyProfile,
  isVisible,
  isAnswered,
  matchesRule,
  extractSignalSets,
  mergeSignals,
  deriveConfidence,
};
