/**
 * Resolve an admin-authored DeploymentJourney into something the customer
 * frontend can render step by step.
 *
 * Two things this deliberately does NOT do:
 *
 *   - Fail when no journey exists. `journey: null` is a valid answer, and the
 *     frontend falls back to a plain question list. A platform that can't take
 *     a deployment order because nobody configured a flow would be worse than
 *     one with an unstyled form.
 *   - Fail when a step references a missing question. Questions get
 *     deactivated, renamed out of scope, or written after the step that uses
 *     them; the step is dropped and the reason recorded in `meta.warnings` for
 *     the admin, rather than breaking the customer's screen.
 */
const deploymentJourneyService = require('./deploymentJourneyService');
const questionTemplateService = require('../admin/questionTemplateService');
const catalogService = require('../catalog/catalogService');

/**
 * The customer-facing shape of a question.
 *
 * Single source of truth: both GET /questionnaire and the journey endpoint use
 * this, so the two can never drift into disagreeing about what a question is.
 *
 * Note what is absent — `signals` and `signalRules` encode internal sizing and
 * pricing policy and must never cross to the client. `affectsSizing` is the
 * only derived hint that does, because the UI needs it to know when to
 * recompute live sizing.
 */
const serializeQuestion = (q) => ({
  key: q.key,
  question: q.question,
  helpText: q.helpText,
  placeholder: q.placeholder,
  type: q.type,
  // Strip signals from each option; the customer sees only label and value.
  options: (q.options || []).map((o) => ({ label: o.label, value: o.value })),
  required: q.required,
  defaultValue: q.defaultValue,
  dependsOn: q.dependsOn?.questionKey ? q.dependsOn : null,
  affectsSizing: !!q.affectsSizing,
});

/**
 * Resolve the active journey for a mode, hydrating question references.
 *
 * Steps whose only purpose is to help the customer decide something they have
 * already decided are dropped, rather than shown with nothing to do.
 *
 * @param {Object} opts
 * @param {Object}  opts.model          A lean AIModel, or null for requirements-first
 * @param {String}  opts.mode           'model_first' | 'requirements_first'
 * @param {Boolean} opts.machineChosen  the customer arrived having already picked
 *   the hardware (from the machine catalogue), so the recommendation step has
 *   nothing left to recommend
 */
const resolveJourney = async ({ model = null, mode = 'model_first', machineChosen = false } = {}) => {
  const journey = await deploymentJourneyService.getActive(mode);

  // No journey configured — the caller falls back to a flat question list.
  if (!journey) {
    return { journey: null, steps: [], meta: { warnings: [], questionCount: 0 } };
  }

  const available = await questionTemplateService.getForModel(model);
  const byKey = available.reduce((acc, q) => ({ ...acc, [q.key]: q }), {});

  const warnings = [];
  const steps = [];

  const ordered = (journey.steps || [])
    .filter((s) => s.isActive !== false)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

  for (const step of ordered) {
    // The customer already chose a model, so there is nothing to match.
    if (step.type === 'model_match' && mode === 'model_first') continue;

    /*
     * …and someone who came in from the machine catalogue chose the hardware
     * too. Recommending it back to them is a screen with nothing to decide on
     * it. The questions still get asked — they are what the admin fulfilling
     * the order reads, not just scorer input — only the suggestion goes.
     *
     * Safe for the required-answer gate in createDeployment, which re-resolves
     * the journey to work out which questions were actually asked: a
     * `recommendation` step never carries any (`questions` is only populated
     * for question/question_group below), so dropping it cannot change that
     * set.
     */
    if (step.type === 'recommendation' && machineChosen) continue;

    const resolved = {
      id: String(step.id),
      key: step.key,
      type: step.type,
      title: step.title,
      subtitle: step.subtitle,
      body: step.body,
      ctaLabel: step.ctaLabel,
      icon: step.icon,
      image: step.image,
      dependsOn: step.dependsOn?.questionKey ? step.dependsOn : null,
      settings: step.settings || {},
      skippable: !!step.skippable,
      questions: [],
    };

    if (step.type === 'question' || step.type === 'question_group') {
      for (const key of step.questionKeys || []) {
        const question = byKey[key];
        if (!question) {
          warnings.push({
            stepKey: step.key,
            questionKey: key,
            message: `Question "${key}" is inactive, deleted, or out of scope for this model.`,
          });
          continue;
        }
        resolved.questions.push(serializeQuestion(question));
      }

      // A question step with nothing left to ask is an empty screen.
      if (!resolved.questions.length) {
        warnings.push({
          stepKey: step.key,
          questionKey: null,
          message: `Step "${step.key}" was skipped because none of its questions resolved.`,
        });
        continue;
      }
    }

    steps.push(resolved);
  }

  return {
    journey: {
      key: journey.key,
      name: journey.name,
      description: journey.description,
      mode: journey.mode,
      settings: journey.settings || {},
    },
    steps,
    meta: {
      warnings,
      questionCount: steps.reduce((sum, s) => sum + s.questions.length, 0),
    },
  };
};

/**
 * Every question the journey will ask, flattened. Used by the frontend to seed
 * defaults and by validation to know what was in scope.
 */
const journeyQuestions = (steps) =>
  steps.reduce((acc, step) => acc.concat(step.questions || []), []);

/** Load a model by slug or id, whichever the caller has. */
const findModel = (identifier) => catalogService.findModelByIdentifier(identifier);

module.exports = { resolveJourney, serializeQuestion, journeyQuestions, findModel };
