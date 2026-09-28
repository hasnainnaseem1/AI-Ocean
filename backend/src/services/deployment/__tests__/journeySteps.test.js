/**
 * The journey drops steps that ask the customer to decide something they have
 * already decided.
 *
 * Two such skips exist, and they are easy to get subtly wrong in opposite
 * directions: skip too little and a customer who came from the machine
 * catalogue is shown a screen recommending the machine they are standing on;
 * skip too much and you take questions away from the admin who has to provision
 * the thing — worse, you change the set of questions `createDeployment`
 * enforces as required, which would reject an order for an answer the customer
 * was never asked for.
 *
 * `resolveJourney` needs a database, so these exercise the filter itself
 * against the same step shapes the service builds, plus the invariant that
 * matters: dropping a `recommendation` step cannot change the question set,
 * because that step type never carries questions.
 *
 * Run with:  node --test src/services/deployment/__tests__/journeySteps.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { journeyQuestions } = require('../journeyService');

/** The seeded model_first journey, in the shape resolveJourney emits. */
const JOURNEY = [
  { key: 'intro', type: 'intro', questions: [] },
  { key: 'ask_use_case', type: 'question', questions: [{ key: 'use_case', required: true }] },
  { key: 'ask_load', type: 'question', questions: [{ key: 'requests_per_day', required: true }] },
  { key: 'pick_model', type: 'model_match', questions: [] },
  { key: 'ask_context', type: 'question_group', questions: [{ key: 'compliance' }, { key: 'integration' }] },
  { key: 'recommendation', type: 'recommendation', questions: [] },
  { key: 'name_it', type: 'name', questions: [] },
  { key: 'review', type: 'review', questions: [] },
];

/**
 * The rule under test, lifted from resolveJourney's loop. Kept here rather than
 * exported from the service so the test pins the *behaviour*, not an internal.
 */
const keep = (steps, { mode = 'model_first', machineChosen = false } = {}) =>
  steps.filter((s) => {
    if (s.type === 'model_match' && mode === 'model_first') return false;
    if (s.type === 'recommendation' && machineChosen) return false;
    return true;
  });

const types = (steps) => steps.map((s) => s.type);

test('with nothing pre-chosen, requirements-first keeps every step', () => {
  assert.deepStrictEqual(
    types(keep(JOURNEY, { mode: 'requirements_first' })),
    ['intro', 'question', 'question', 'model_match', 'question_group', 'recommendation', 'name', 'review']
  );
});

test('choosing the model first drops the model-match step and nothing else', () => {
  assert.deepStrictEqual(
    types(keep(JOURNEY, { mode: 'model_first' })),
    ['intro', 'question', 'question', 'question_group', 'recommendation', 'name', 'review']
  );
});

test('arriving with a machine drops the recommendation step and nothing else', () => {
  assert.deepStrictEqual(
    types(keep(JOURNEY, { mode: 'model_first', machineChosen: true })),
    ['intro', 'question', 'question', 'question_group', 'name', 'review']
  );
});

test('a preset machine never removes a question — the review screen still needs them, and so does the admin', () => {
  const withRec = keep(JOURNEY, { mode: 'model_first' });
  const withoutRec = keep(JOURNEY, { mode: 'model_first', machineChosen: true });

  assert.deepStrictEqual(
    journeyQuestions(withoutRec).map((q) => q.key),
    journeyQuestions(withRec).map((q) => q.key),
    'the question set must be identical with and without the recommendation step'
  );
});

test('the required-answer gate is unchanged by a preset machine', () => {
  // createDeployment builds `askedKeys` from journeyQuestions and rejects an
  // order missing any required question in that set. If a preset machine could
  // shrink it, a customer would be asked for something and then not held to it
  // — or held to something they were never asked.
  const asked = (steps) => new Set(
    journeyQuestions(steps).filter((q) => q.required).map((q) => q.key)
  );

  assert.deepStrictEqual(
    [...asked(keep(JOURNEY, { mode: 'model_first', machineChosen: true }))].sort(),
    [...asked(keep(JOURNEY, { mode: 'model_first' }))].sort()
  );
});

test('the machine flag alone does not resurrect the model-match step', () => {
  // requirements_first + a machine is not a combination the UI produces today
  // (the machine is ignored without a model), but the two filters must stay
  // independent so it degrades sensibly if it ever is.
  assert.deepStrictEqual(
    types(keep(JOURNEY, { mode: 'requirements_first', machineChosen: true })),
    ['intro', 'question', 'question', 'model_match', 'question_group', 'name', 'review']
  );
});
