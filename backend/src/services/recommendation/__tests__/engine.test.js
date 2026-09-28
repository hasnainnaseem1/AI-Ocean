/**
 * Unit tests for the recommendation engine's load-bearing invariants.
 *
 * Uses node:test and node:assert so this runs with no test dependency at all
 * (`npm run test:engine`). These are pure functions over plain objects, so
 * nothing here touches a database.
 *
 * The three profile invariants are not academic — each one corresponds to a
 * bug that would otherwise reach a customer as wrong hardware advice.
 */
const test = require('node:test');
const assert = require('node:assert');

const { buildProfile } = require('../profileBuilder');
const { buildFacts, scoreTiers, pickAlternatives } = require('../tierScorer');
const { assessModel } = require('../modelSuitability');
const { buildReasons } = require('../reasonBuilder');
const { rankModels } = require('../modelRanker');
const { DEFAULT_POLICY: POLICY } = require('../policyDefaults');

/** Every test runs under the shipped defaults unless it says otherwise. */
const buildProfileP = (questions, answers) => buildProfile(questions, answers, POLICY);

// ── Fixtures ──────────────────────────────────────────────────────────────

const QUESTIONS = [
  {
    key: 'use_case',
    question: 'What will you use this model for?',
    type: 'select',
    displayOrder: 1,
    options: [
      {
        label: 'Chat / assistant',
        value: 'chat_assistant',
        signals: { prefersUseCases: [{ useCase: 'chat_assistant', weight: 3 }] },
      },
      {
        label: 'Image generation',
        value: 'image_generation',
        signals: {
          requiresModalities: ['image_generation'],
          prefersUseCases: [{ useCase: 'image_generation', weight: 3 }],
        },
      },
    ],
  },
  {
    key: 'context_length',
    question: 'What context length do you need?',
    type: 'select',
    displayOrder: 2,
    options: [
      { label: '8K tokens', value: '8k_tokens', signals: { minContextLength: 8000 } },
      {
        label: '128K tokens',
        value: '128k_tokens',
        signals: { minContextLength: 128000, minVramGb: 80 },
      },
    ],
  },
  {
    key: 'monthly_budget',
    question: 'What monthly budget do you have in mind?',
    type: 'select',
    displayOrder: 3,
    options: [
      { label: 'Under $500', value: 'under_500', signals: { maxMonthlyBudget: 500, costPriority: 1 } },
      { label: 'More than $10,000', value: 'more_than_10_000', signals: { costPriority: 0.1 } },
    ],
  },
  {
    key: 'fine_tuning',
    question: 'Do you need fine-tuning?',
    type: 'boolean',
    displayOrder: 4,
    signalRules: [{
      when: { op: 'isTrue' },
      label: 'you need fine-tuning',
      signals: { minVramGb: 160, minGpuCount: 2, note: 'Fine-tuning needs roughly twice the memory of inference.' },
      displayOrder: 0,
    }],
  },
  {
    key: 'fine_tuning_detail',
    question: 'Describe your fine-tuning needs',
    type: 'textarea',
    displayOrder: 5,
    dependsOn: { questionKey: 'fine_tuning', equals: true },
  },
  {
    key: 'notes',
    question: 'Anything else?',
    type: 'textarea',
    displayOrder: 6,
  },
];

const tier = (id, name, vramGb, gpuCount, pricePerHour, extra = {}) => ({
  _id: id,
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  gpuModel: name.split(' ')[0],
  gpuCount,
  vramGb,
  vcpu: 16 * gpuCount,
  ramGb: 128 * gpuCount,
  pricePerHour,
  currency: 'USD',
  regions: ['default'],
  capacity: { total: 0, allocated: 0 },
  status: 'available',
  isActive: true,
  displayOrder: 0,
  metadata: {},
  ...extra,
});

const TIERS = [
  tier('t1', 'RTX 4090 24GB', 24, 1, 0.69),
  tier('t2', 'A100 40GB', 40, 1, 1.49),
  tier('t3', 'A100 80GB', 80, 1, 2.39),
  tier('t4', 'H100 80GB', 80, 1, 3.89),
  tier('t5', 'H100 80GB x2', 80, 2, 7.49),
  tier('t6', 'H100 80GB x4', 80, 4, 14.49),
];

const MODEL = {
  _id: 'm1',
  name: 'Llama 3 70B',
  slug: 'llama-3-70b',
  family: 'llama',
  modalities: ['chat', 'completion'],
  contextLength: 32000,
  minVramGb: 40,
  status: 'available',
  isActive: true,
  displayOrder: 1,
  useCases: [{ key: 'chat_assistant', fit: 'excellent', label: 'Chat / assistant' }],
  supportedTiers: TIERS.map((t) => ({
    tierId: t.id,
    tierName: t.name,
    recommended: t.id === 't3',
    priceMultiplier: 1,
  })),
};

const answer = (questionKey, value) => ({ questionKey, answer: value });

// ── Invariant 1: order independence ───────────────────────────────────────

test('profile is independent of the order answers arrive in', () => {
  const forwards = buildProfileP(QUESTIONS, [
    answer('use_case', 'chat_assistant'),
    answer('context_length', '128k_tokens'),
    answer('fine_tuning', true),
  ]);

  const backwards = buildProfileP(QUESTIONS, [
    answer('fine_tuning', true),
    answer('context_length', '128k_tokens'),
    answer('use_case', 'chat_assistant'),
  ]);

  assert.deepStrictEqual(forwards.floors, backwards.floors);
  assert.deepStrictEqual(forwards.ceilings, backwards.ceilings);
  assert.deepStrictEqual(forwards.useCaseWeights, backwards.useCaseWeights);
  assert.strictEqual(forwards.confidence, backwards.confidence);
});

// ── Invariant 2: strictest floor wins, tightest ceiling wins ──────────────

test('floors merge with max and ceilings merge with min', () => {
  const profile = buildProfileP(QUESTIONS, [
    answer('context_length', '128k_tokens'), // minVramGb 80
    answer('fine_tuning', true),             // minVramGb 160, minGpuCount 2
    answer('monthly_budget', 'under_500'),   // maxMonthlyBudget 500
  ]);

  assert.strictEqual(profile.floors.minVramGb, 160, 'strictest VRAM floor must win');
  assert.strictEqual(profile.floors.minGpuCount, 2);
  assert.strictEqual(profile.ceilings.maxMonthlyBudget, 500);
});

// ── Invariant 3: degrades to nothing ─────────────────────────────────────

test('no signal-bearing answers leaves every constraint null', () => {
  const profile = buildProfileP(QUESTIONS, [answer('notes', 'hello there')]);

  assert.strictEqual(profile.confidence, 'none');
  assert.strictEqual(profile.signalBearingCount, 0);
  assert.strictEqual(profile.floors.minVramGb, null);
  assert.strictEqual(profile.ceilings.maxMonthlyBudget, null);
});

test('with no opinion the scorer falls back to the admin pick, then price', () => {
  const profile = buildProfileP(QUESTIONS, []);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);

  // t3 is the admin's `recommended` tier and meets the model's own 40GB floor.
  assert.strictEqual(scored[0].tier.id, 't3');
  // Nothing is ever filtered out.
  assert.strictEqual(scored.length, TIERS.length);
});

// ── The dependsOn retraction bug ─────────────────────────────────────────

test('a retracted answer stops contributing once its parent is toggled off', () => {
  const withFineTuning = buildProfileP(QUESTIONS, [
    answer('fine_tuning', true),
    answer('fine_tuning_detail', 'adapt tone to our brand'),
  ]);
  assert.strictEqual(withFineTuning.floors.minVramGb, 160);

  // The customer changes their mind. The UI keeps the stale detail answer in
  // state, but it must no longer count for anything.
  const retracted = buildProfileP(QUESTIONS, [
    answer('fine_tuning', false),
    answer('fine_tuning_detail', 'adapt tone to our brand'),
  ]);

  assert.strictEqual(retracted.floors.minVramGb, null, 'retracted answer must not still size');
  assert.strictEqual(retracted.floors.minGpuCount, null);
});

// ── Constraints rank and warn, never reject ──────────────────────────────

test('a VRAM shortfall pushes a tier down but never removes it', () => {
  const profile = buildProfileP(QUESTIONS, [answer('fine_tuning', true)]); // needs 160GB
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);

  assert.strictEqual(scored.length, TIERS.length, 'no tier may be filtered out');

  const undersized = scored.find((t) => t.tier.id === 't1'); // 24GB
  assert.ok(undersized, 'the undersized tier is still present');
  assert.strictEqual(undersized.meetsVram, false);
  assert.ok(
    undersized.issues.some((i) => i.code === 'VRAM_SHORTFALL'),
    'and explains itself'
  );

  // The winner should be one that actually clears 160GB total.
  assert.ok(scored[0].totalVram >= 160, `winner ${scored[0].tier.name} should meet the floor`);
});

test('an impossible budget warns but still returns a full tier list', () => {
  const profile = buildProfileP(QUESTIONS, [
    answer('fine_tuning', true),           // 160GB floor
    answer('monthly_budget', 'under_500'), // ~$500/mo ceiling
  ]);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);
  const reasons = buildReasons(profile, scored, MODEL, POLICY);

  assert.strictEqual(scored.length, TIERS.length);
  assert.ok(
    reasons.some((r) => r.code === 'BUDGET_INFEASIBLE' && r.severity === 'warning'),
    'infeasibility is a warning, not an error'
  );
});

// ── Explainability ───────────────────────────────────────────────────────

test('reasons trace back to the question and the option label', () => {
  const profile = buildProfileP(QUESTIONS, [
    answer('context_length', '128k_tokens'),
    answer('fine_tuning', true),
  ]);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);
  const reasons = buildReasons(profile, scored, MODEL, POLICY);

  const vram = reasons.find((r) => r.code === 'VRAM_FLOOR');
  assert.ok(vram, 'a VRAM reason is produced');
  assert.strictEqual(vram.requirement, 160);
  assert.strictEqual(vram.questionKey, 'fine_tuning');
  assert.strictEqual(vram.answerLabel, 'you need fine-tuning');
  // The admin's own note wins over the generated sentence.
  assert.match(vram.text, /twice the memory/);
});

test('the admin note overrides generated text only when present', () => {
  const profile = buildProfileP(QUESTIONS, [answer('context_length', '128k_tokens')]);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);
  const reasons = buildReasons(profile, scored, MODEL, POLICY);

  const vram = reasons.find((r) => r.code === 'VRAM_FLOOR');
  assert.match(vram.text, /128K tokens/, 'falls back to quoting the option label');
});

// ── Alternatives ─────────────────────────────────────────────────────────

test('cheaper stays adequate where possible and headroom is the next size up', () => {
  const profile = buildProfileP(QUESTIONS, [answer('context_length', '128k_tokens')]); // 80GB
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);
  const { primary, cheaper, headroom } = pickAlternatives(scored, POLICY);

  assert.ok(primary);
  if (cheaper) assert.ok(cheaper.rate < primary.rate, 'cheaper is actually cheaper');
  if (headroom) {
    assert.ok(headroom.rate > primary.rate, 'headroom costs more');
    assert.ok(headroom.totalVram >= primary.totalVram, 'and is not smaller');

    // "Next size up", not "biggest box we sell".
    const dearer = scored.filter((t) => t.rate > primary.rate && t.bookable);
    const cheapestDearer = Math.min(...dearer.map((t) => t.rate));
    assert.strictEqual(headroom.rate, cheapestDearer);
  }
});

// ── Suitability ──────────────────────────────────────────────────────────

test('a modality mismatch is a poor verdict, not a rejection', () => {
  const profile = buildProfileP(QUESTIONS, [answer('use_case', 'image_generation')]);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);
  const suitability = assessModel(MODEL, profile, scored, POLICY);

  assert.strictEqual(suitability.verdict, 'poor');
  assert.ok(suitability.issues.some((i) => i.code === 'MODALITY_MISMATCH'));
  // Still fully deployable — the customer decides.
  assert.ok(scored.length > 0);
});

test('a matching use case with adequate hardware reads as good', () => {
  const profile = buildProfileP(QUESTIONS, [answer('use_case', 'chat_assistant')]);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);

  assert.strictEqual(assessModel(MODEL, profile, scored, POLICY).verdict, 'good');
});

test('context shortfall is reported against the model, not the hardware', () => {
  const profile = buildProfileP(QUESTIONS, [answer('context_length', '128k_tokens')]);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);
  const suitability = assessModel(MODEL, profile, scored, POLICY); // model does 32K, asked for 128K

  assert.ok(suitability.issues.some((i) => i.code === 'CONTEXT_SHORTFALL'));
});

// ── Scenario 2 ───────────────────────────────────────────────────────────

test('model ranking prefers the model that claims the requested use case', () => {
  const imageModel = {
    ...MODEL,
    _id: 'm2',
    name: 'FLUX.1 dev',
    slug: 'flux-1-dev',
    modalities: ['image_generation'],
    minVramGb: 24,
    contextLength: 0,
    displayOrder: 2,
    useCases: [{ key: 'image_generation', fit: 'excellent', label: 'Image generation' }],
  };

  const profile = buildProfileP(QUESTIONS, [answer('use_case', 'image_generation')]);
  const ranked = rankModels([MODEL, imageModel], TIERS, profile, { limit: 5, policy: POLICY });

  assert.strictEqual(ranked[0].model.id, 'm2', 'the image model must win');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[0].matchReasons.length > 0, 'and explain why');
});

test('with no use-case signal, ranking falls back to catalogue order', () => {
  const second = { ...MODEL, _id: 'm2', name: 'Other', displayOrder: 2, useCases: [] };
  const profile = buildProfileP(QUESTIONS, []);
  const ranked = rankModels([MODEL, second], TIERS, profile, { limit: 5, policy: POLICY });

  assert.strictEqual(ranked[0].model.id, 'm1');
});

// ── Stock ────────────────────────────────────────────────────────────────

test('an out-of-stock tier is de-prioritised but still listed', () => {
  const tiers = TIERS.map((t) => (t.id === 't3' ? { ...t, status: 'out_of_stock' } : t));
  const profile = buildProfileP(QUESTIONS, []);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, tiers, 0, POLICY), profile, POLICY);

  const dead = scored.find((t) => t.tier.id === 't3');
  assert.ok(dead, 'still present in the list');
  assert.strictEqual(dead.bookable, false);
  assert.notStrictEqual(scored[0].tier.id, 't3', 'but no longer the pick');
});

// ── Pricing ──────────────────────────────────────────────────────────────

test('price multiplier and plan discount both apply to the quoted rate', () => {
  const model = {
    ...MODEL,
    supportedTiers: [{ tierId: 't3', tierName: 'A100 80GB', recommended: true, priceMultiplier: 2 }],
  };

  const [fact] = buildFacts(model, TIERS, 10, POLICY); // 2.39 * 2 = 4.78 list, -10% = 4.302
  assert.strictEqual(fact.listRate, 4.78);
  assert.strictEqual(fact.rate, 4.302);
  assert.strictEqual(fact.totalVram, 80);
});

// ── Policy is data, not code ─────────────────────────────────────────────
//
// These are the tests that make the "nothing is hardcoded" claim checkable.
// Each one changes a policy value and asserts the engine's answer moves,
// which is only possible if the value genuinely drives the decision.

const { deepMerge, render, DEFAULT_POLICY } = require('../policyDefaults');

test('an admin override merges over defaults without blanking siblings', () => {
  // A policy that mentions exactly one field, the way a real edit would.
  const merged = deepMerge(DEFAULT_POLICY, {
    tierScoring: { stock: { outOfStockPenalty: 99 } },
  });

  assert.strictEqual(merged.tierScoring.stock.outOfStockPenalty, 99, 'override applied');
  assert.strictEqual(
    merged.tierScoring.stock.limitedPenalty,
    DEFAULT_POLICY.tierScoring.stock.limitedPenalty,
    'its sibling survived'
  );
  assert.strictEqual(
    merged.tierScoring.adminRecommendedBonus,
    DEFAULT_POLICY.tierScoring.adminRecommendedBonus,
    'unrelated branches survived'
  );
  assert.deepStrictEqual(
    merged.reasonTemplates, DEFAULT_POLICY.reasonTemplates,
    'copy the admin never touched survived'
  );
});

test('a null or missing override means inherit, never blank', () => {
  const merged = deepMerge(DEFAULT_POLICY, {
    tierScoring: { adminRecommendedBonus: null, baseScore: undefined },
  });

  assert.strictEqual(merged.tierScoring.adminRecommendedBonus, 8);
  assert.strictEqual(merged.tierScoring.baseScore, 100);
});

test('the admin-pick bonus is load-bearing, not decoration', () => {
  const profile = buildProfileP(QUESTIONS, []);

  // By default t3 (the admin's pick) edges out the cheaper t2.
  const baseline = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);
  assert.strictEqual(baseline[0].tier.id, 't3');

  // An operator who decides the flag should carry no weight at all gets a
  // different winner — proving the bonus really is what decided it.
  const ignored = deepMerge(POLICY, { tierScoring: { adminRecommendedBonus: 0 } });
  const without = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, ignored), profile, ignored);

  assert.notStrictEqual(
    without[0].tier.id, 't3',
    'with the bonus removed, price efficiency decides instead'
  );
});

test('the poor-fit threshold is policy, not a hardcoded rule', () => {
  const profile = buildProfileP(QUESTIONS, [answer('use_case', 'image_generation')]);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);

  assert.strictEqual(assessModel(MODEL, profile, scored, POLICY).verdict, 'poor');

  // An operator who decides one hard problem is only worth a caution.
  const lenient = deepMerge(POLICY, { suitability: { verdict: { poorAtHighCount: 2 } } });
  assert.strictEqual(assessModel(MODEL, profile, scored, lenient).verdict, 'caution');
});

test('reason wording comes from the policy, placeholders and all', () => {
  const profile = buildProfileP(QUESTIONS, [answer('monthly_budget', 'under_500')]);
  const scored = scoreTiers(MODEL, buildFacts(MODEL, TIERS, 0, POLICY), profile, POLICY);

  const reworded = deepMerge(POLICY, {
    reasonTemplates: { BUDGET_CEILING: 'Budget cap: {requirementMoney} per month.' },
  });

  const reasons = buildReasons(profile, scored, MODEL, reworded);
  const budgetReason = reasons.find((r) => r.code === 'BUDGET_CEILING');

  assert.ok(budgetReason, 'the reason is still produced');
  assert.strictEqual(budgetReason.text, 'Budget cap: $500 per month.');
});

test('an unknown placeholder stays visible rather than blanking the sentence', () => {
  // A typo in the admin center must be obvious, not silently swallowed.
  assert.strictEqual(
    render('You said {answerLabel} and {notAThing}.', { answerLabel: '"x"' }),
    'You said "x" and {notAThing}.'
  );
});

test('ranking weights are relative, so any scale gives the same order', () => {
  const imageModel = {
    ...MODEL,
    _id: 'm2',
    name: 'Image Model',
    modalities: ['image_generation'],
    useCases: [{ key: 'image_generation', fit: 'excellent' }],
  };

  const profile = buildProfileP(QUESTIONS, [answer('use_case', 'image_generation')]);

  const asFractions = rankModels([MODEL, imageModel], TIERS, profile, { limit: 5, policy: POLICY });
  const asIntegers = rankModels([MODEL, imageModel], TIERS, profile, {
    limit: 5,
    policy: deepMerge(POLICY, {
      modelRanking: {
        weights: { useCase: 45, capability: 20, budget: 20, availability: 10, popularity: 5 },
      },
    }),
  });

  assert.deepStrictEqual(
    asFractions.map((r) => r.model.id),
    asIntegers.map((r) => r.model.id),
    'same ranking'
  );
  assert.deepStrictEqual(
    asFractions.map((r) => r.score),
    asIntegers.map((r) => r.score),
    'and the same scores — weights are normalised by their own sum'
  );
});
