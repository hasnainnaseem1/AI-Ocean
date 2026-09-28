/**
 * Seed the two deployment journeys.
 *
 * These are the starting flows — the admin reorders steps, rewrites the copy
 * and swaps questions in and out from the admin center. Nothing here is
 * hardcoded into the frontend; the customer center renders whatever these
 * documents say.
 *
 * `model_first`        — the customer picked a model in the catalogue and we
 *                        size the hardware for it.
 * `requirements_first` — no model chosen; we suggest one as well.
 *
 * Both reference questions by key, so the wording stays owned by the
 * questionnaire. Run seedQuestionnaire.js first or the steps will resolve
 * empty (which is handled gracefully, but pointlessly).
 *
 * Run with:  node src/scripts/seed/seedDeploymentJourney.js [--force]
 */
require('dotenv').config();
const { connect, prisma, finish, fail, isForced } = require('./seedHelpers');

/**
 * The complete question spine, shared verbatim by both journeys.
 *
 * Deliberately one definition rather than a copy per journey. The two flows
 * differ by exactly one step — requirements-first inserts a model_match after
 * the questions — and everything else must stay identical, or the two drift.
 * They already did once: a model_match was hand-inserted mid-spine in one
 * copy, which asked the customer to choose a model and then kept questioning
 * them afterwards.
 */
const questionSteps = (startOrder) => {
  const simple = [
    ['use_case', 'What are you building?', 'This is the single biggest factor in what we recommend.'],
    ['user_base', 'Who is going to use it?', 'Roughly how many people will hit this day to day.'],
    ['requests_per_day', 'How busy will it be?', 'A rough order of magnitude is fine.'],
    ['context_length', 'How much does it need to read at once?', 'Longer prompts need more memory.'],
    ['latency', 'How fast do replies need to come back?', ''],
    ['uptime', 'When does it need to be running?', 'You only pay while a deployment is up.'],
    ['monthly_budget', 'What are you comfortable spending?', 'We will not recommend something above this without saying so.'],
    ['fine_tuning', 'Do you need to train it on your own data?', 'Fine-tuning needs noticeably more hardware than just running a model.'],
  ].map(([key, title, subtitle]) => ({
    key: `ask_${key}`,
    type: 'question',
    title,
    subtitle,
    questionKeys: [key],
    isActive: true,
  }));

  const rest = [
    {
      key: 'ask_fine_tuning_detail',
      type: 'question',
      title: 'Tell us about the training data',
      subtitle: 'What do you have, and what behaviour are you trying to change?',
      questionKeys: ['fine_tuning_detail'],
      // Mirrors the question's own dependsOn, so the step disappears with it.
      dependsOn: { questionKey: 'fine_tuning', equals: true },
      isActive: true,
    },
    {
      key: 'ask_timeline',
      type: 'question',
      title: 'When do you need this running?',
      subtitle: 'So we know how to prioritise your request.',
      questionKeys: ['timeline'],
      isActive: true,
    },
    {
      key: 'ask_context',
      type: 'question_group',
      title: 'A couple of practical details',
      subtitle: 'These help our team set the deployment up correctly.',
      questionKeys: ['compliance', 'integration'],
      settings: { columns: 2 },
      skippable: true,
      isActive: true,
    },
  ];

  return [...simple, ...rest].map((step, index) => ({
    ...step,
    displayOrder: startOrder + index,
  }));
};

/** How many steps the spine occupies, so callers can order what follows. */
const QUESTION_STEP_COUNT = questionSteps(0).length;

/** Steps shared by both journeys after the questions are done. */
const tailSteps = (startOrder) => [
  {
    key: 'recommendation',
    type: 'recommendation',
    title: 'Here is what we recommend',
    subtitle: 'Based on what you told us — and why.',
    settings: { showAlternatives: true },
    displayOrder: startOrder,
    isActive: true,
  },
  {
    key: 'name_it',
    type: 'name',
    title: 'Give it a name',
    subtitle: 'Just for your own reference — you can change it later.',
    displayOrder: startOrder + 1,
    isActive: true,
  },
  {
    key: 'review',
    type: 'review',
    title: 'Ready to deploy',
    subtitle: 'Billing starts only once your endpoint is actually running.',
    ctaLabel: 'Deploy',
    displayOrder: startOrder + 2,
    isActive: true,
  },
];

const JOURNEYS = [
  {
    key: 'model_first_default',
    name: 'Model first — guided sizing',
    description: 'For customers who picked a model in the catalogue and need hardware sized for it.',
    mode: 'model_first',
    isDefault: true,
    isActive: true,
    displayOrder: 1,
    steps: [
      {
        key: 'intro',
        type: 'intro',
        title: 'Let\'s size this properly',
        subtitle: 'A few quick questions and we will pick the right hardware for you.',
        body: 'Nothing is charged until your deployment is actually running, and you can change hardware later.',
        ctaLabel: 'Start',
        displayOrder: 0,
        isActive: true,
      },
      ...questionSteps(1),
      ...tailSteps(1 + QUESTION_STEP_COUNT),
    ],
    settings: {
      autoAdvance: true,
      autoAdvanceDelayMs: 350,
      showLiveSizing: true,
      showProgressBar: true,
      allowBack: true,
      showEstimatedCost: true,
      allowManualTierOverride: true,
      modelMatchLimit: 5,
      requireAllRequired: true,
      completionMessage: 'We are reviewing your request and will email you the moment your endpoint is live.',
    },
  },

  {
    key: 'requirements_first_default',
    name: 'Requirements first — model and hardware',
    description: 'For customers who describe a workload and need a model recommended as well.',
    mode: 'requirements_first',
    isDefault: true,
    isActive: true,
    displayOrder: 2,
    steps: [
      {
        key: 'intro',
        type: 'intro',
        title: 'Tell us what you are building',
        subtitle: 'We will find the right model and the right hardware to run it on.',
        body: 'You do not need to know anything about GPUs — that is our job.',
        ctaLabel: 'Start',
        displayOrder: 0,
        isActive: true,
      },
      ...questionSteps(1),
      // The single step that distinguishes this journey from model-first, and
      // it sits *after* every question: suggesting a model while questions are
      // still outstanding means suggesting from an incomplete picture, and
      // then asking more once the customer has already committed.
      {
        key: 'pick_model',
        type: 'model_match',
        title: 'These look like the best fit',
        subtitle: 'Ranked against what you told us. Pick one to continue.',
        settings: { limit: 4 },
        displayOrder: 1 + QUESTION_STEP_COUNT,
        isActive: true,
      },
      ...tailSteps(2 + QUESTION_STEP_COUNT),
    ],
    settings: {
      autoAdvance: true,
      autoAdvanceDelayMs: 350,
      showLiveSizing: true,
      showProgressBar: true,
      allowBack: true,
      showEstimatedCost: true,
      allowManualTierOverride: true,
      modelMatchLimit: 4,
      requireAllRequired: true,
      completionMessage: 'We are reviewing your request and will email you the moment your endpoint is live.',
    },
  },
];

/**
 * A journey owns an ordered list of steps, which is a child table now rather
 * than an embedded array — so a refresh replaces the step rows wholesale
 * inside one transaction instead of reassigning a subdocument array.
 */
/**
 * The journey's `settings{}` block is a set of flat columns now, and a step's
 * `dependsOn{}` is two columns. Both are still authored nested here, because
 * that is the shape the rest of the app (and the admin UI) speaks.
 */
const toJourneyColumns = ({ settings = {}, ...rest }) => ({
  ...rest,
  settingsAutoAdvance: settings.autoAdvance,
  settingsAutoAdvanceDelayMs: settings.autoAdvanceDelayMs,
  settingsShowLiveSizing: settings.showLiveSizing,
  settingsShowProgressBar: settings.showProgressBar,
  settingsAllowBack: settings.allowBack,
  settingsShowEstimatedCost: settings.showEstimatedCost,
  settingsAllowManualTierOverride: settings.allowManualTierOverride,
  settingsModelMatchLimit: settings.modelMatchLimit,
  settingsRequireAllRequired: settings.requireAllRequired,
  settingsCompletionMessage: settings.completionMessage,
});

const toStepColumns = ({ dependsOn, ...step }, index) => ({
  ...step,
  // `order` drives playback; `displayOrder` is the admin list ordering
  order: step.order ?? step.displayOrder ?? index,
  dependsOnQuestionKey: dependsOn?.questionKey || '',
  dependsOnEquals: dependsOn?.equals ?? null,
});

/** Drop keys the seed data doesn't set, so column defaults apply. */
const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const upsertJourney = async (data, force) => {
  const { steps = [], ...rest } = data;
  const journey = defined(toJourneyColumns(rest));
  const existing = await prisma.deploymentJourney.findUnique({ where: { key: journey.key } });

  if (existing && existing.updatedById && !force) return 'skipped';

  const stepRows = steps.map((step, index) => defined(toStepColumns(step, index)));

  if (existing) {
    await prisma.$transaction([
      prisma.deploymentJourneyStep.deleteMany({ where: { journeyId: existing.id } }),
      prisma.deploymentJourney.update({
        where: { id: existing.id },
        data: { ...journey, steps: { create: stepRows } },
      }),
    ]);
    return 'updated';
  }

  await prisma.deploymentJourney.create({
    data: { ...journey, steps: { create: stepRows } },
  });
  return 'created';
};

const seed = async () => {
  await connect();
  const force = isForced();
  const counts = { created: 0, updated: 0, skipped: 0 };

  for (const data of JOURNEYS) {
    const outcome = await upsertJourney(data, force);
    counts[outcome] += 1;
    console.log(`  ${outcome.padEnd(8)} ${data.key} — ${data.name || ''}`);
  }

  console.log('Edit these any time in Admin Center → AI Infrastructure.');
  await finish('Deployment journeys seeded', counts);
};

seed().catch((err) => fail('Deployment journey seed', err));
