/**
 * Seed the deployment-request questionnaire.
 *
 * These are only the starting set — the admin adds, edits and reorders them in
 * Admin Center → AI Infrastructure → Questionnaire. Existing questions are
 * matched by key and updated, so re-running never duplicates.
 *
 * Run with:  node src/scripts/seed/seedQuestionnaire.js
 */
require('dotenv').config();
const { connect, upsertAll, finish, fail } = require('./seedHelpers');
const questionTemplateService = require('../../services/admin/questionTemplateService');

/** Machine value derived from the label. Stable — never change this mapping. */
const slug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_');

/**
 * Option builder. Pass a plain string for an option that carries no meaning,
 * or `[label, signals]` to say what choosing it implies about hardware.
 *
 * Signals attach by derived `value`, which is also what gets stored on
 * `Deployment.requirements[].answer`, so they survive label edits.
 */
const opts = (...values) => values.map((v) => {
  if (typeof v === 'string') return { label: v, value: slug(v) };
  if (Array.isArray(v)) {
    const [label, signals] = v;
    return { label, value: slug(label), signals };
  }
  return v;
});

const QUESTIONS = [
  {
    key: 'use_case',
    question: 'What will you use this model for?',
    helpText: 'This drives how we size and configure the instance.',
    type: 'select',
    required: true,
    displayOrder: 1,
    options: opts(
      ['Chat / assistant', {
        requiresModalities: ['chat'],
        prefersUseCases: [{ useCase: 'chat_assistant', weight: 3 }],
      }],
      ['Code generation', {
        requiresModalities: ['code'],
        prefersUseCases: [{ useCase: 'code_generation', weight: 3 }],
      }],
      ['Image generation', {
        requiresModalities: ['image_generation'],
        prefersUseCases: [{ useCase: 'image_generation', weight: 3 }],
      }],
      ['Document analysis / RAG', {
        requiresModalities: ['chat'],
        minContextLength: 32000,
        prefersUseCases: [{ useCase: 'document_analysis_rag', weight: 3 }],
        note: 'Reading whole documents needs room for a long prompt.',
      }],
      ['Semantic search / embeddings', {
        requiresModalities: ['embedding'],
        prefersUseCases: [{ useCase: 'semantic_search_embeddings', weight: 3 }],
      }],
      ['Data extraction & classification', {
        prefersUseCases: [{ useCase: 'data_extraction_classification', weight: 3 }],
      }],
      ['Fine-tuning / training', {
        minVramGb: 160,
        minGpuCount: 2,
        prefersUseCases: [{ useCase: 'fine_tuning_training', weight: 3 }],
        note: 'Training holds the model, its gradients and the optimiser state at once.',
      }],
      'Other'
    ),
  },
  {
    key: 'use_case_detail',
    question: 'Tell us a bit more about the use case',
    helpText: 'A sentence or two is plenty — it helps us pick sensible defaults.',
    type: 'textarea',
    placeholder: 'e.g. an internal support assistant that answers from our product documentation',
    required: false,
    displayOrder: 2,
  },
  {
    key: 'user_base',
    question: 'How many people will use it?',
    type: 'select',
    required: true,
    displayOrder: 3,
    options: opts(
      'Just me / testing',
      ['Under 10', { throughputPriority: 0.1 }],
      ['10 – 100', { throughputPriority: 0.3 }],
      ['100 – 1,000', { throughputPriority: 0.5 }],
      ['1,000 – 10,000', {
        throughputPriority: 0.8,
        minGpuCount: 2,
        note: 'A user base this size needs more than one GPU to stay responsive.',
      }],
      ['More than 10,000', {
        throughputPriority: 1,
        minGpuCount: 2,
        minVramGb: 160,
        note: 'At this scale requests have to be served in parallel across GPUs.',
      }]
    ),
  },
  {
    key: 'requests_per_day',
    question: 'Roughly how many requests per day do you expect?',
    type: 'select',
    required: true,
    displayOrder: 4,
    options: opts(
      ['Under 1,000', { throughputPriority: 0.1 }],
      ['1,000 – 10,000', { throughputPriority: 0.4 }],
      ['10,000 – 100,000', {
        throughputPriority: 0.7,
        minGpuCount: 2,
        note: 'This volume needs at least two GPUs to keep queue times down.',
      }],
      ['More than 100,000', {
        throughputPriority: 1,
        minGpuCount: 4,
        minVramGb: 160,
        note: 'Sustained high volume needs a multi-GPU configuration.',
      }],
      'Not sure yet'
    ),
  },
  {
    key: 'context_length',
    question: 'What context length do you need?',
    helpText: 'How much text the model needs to read in a single request.',
    type: 'select',
    required: false,
    displayOrder: 5,
    options: opts(
      ['4K tokens', { minContextLength: 4000 }],
      ['8K tokens', { minContextLength: 8000 }],
      ['32K tokens', { minContextLength: 32000 }],
      ['128K tokens', {
        minContextLength: 128000,
        minVramGb: 80,
        note: 'Holding a 128K prompt in memory needs at least 80 GB of VRAM.',
      }],
      ['200K+ tokens', {
        minContextLength: 200000,
        minVramGb: 160,
        note: 'Context this long needs 160 GB or more of VRAM.',
      }],
      'Not sure'
    ),
  },
  {
    key: 'latency',
    question: 'How fast do responses need to be?',
    type: 'radio',
    required: false,
    displayOrder: 6,
    options: opts(
      'Best effort',
      ['Under 2 seconds', { latencyPriority: 0.6 }],
      ['Real-time streaming', {
        latencyPriority: 1,
        note: 'Streaming responses need the fastest silicon we offer.',
      }]
    ),
  },
  {
    key: 'uptime',
    question: 'What uptime do you need?',
    type: 'radio',
    required: true,
    displayOrder: 7,
    options: opts(
      ['Development / testing', { uptimeClass: 'dev', costPriority: 0.9 }],
      ['Business hours only', { uptimeClass: 'business_hours', costPriority: 0.6 }],
      ['24/7 production', { uptimeClass: 'always_on' }]
    ),
  },
  {
    key: 'compliance',
    question: 'Any data privacy or compliance requirements?',
    helpText: 'Select all that apply.',
    type: 'multiselect',
    required: false,
    displayOrder: 8,
    options: opts(
      'None',
      'GDPR',
      'HIPAA',
      'SOC 2',
      'Data must stay in a specific region',
      'No request logging'
    ),
  },
  {
    key: 'fine_tuning',
    question: 'Do you need fine-tuning or custom weights?',
    type: 'boolean',
    required: false,
    defaultValue: false,
    displayOrder: 9,
    // Booleans have no options to hang signals on, which is what signalRules
    // are for. Every matching rule applies, not just the first.
    signalRules: [{
      when: { op: 'isTrue' },
      label: 'you need fine-tuning',
      signals: {
        minVramGb: 160,
        minGpuCount: 2,
        prefersUseCases: [{ useCase: 'fine_tuning_training', weight: 2 }],
        note: 'Fine-tuning needs roughly twice the memory of just running the model.',
      },
      displayOrder: 0,
    }],
  },
  {
    key: 'fine_tuning_detail',
    question: 'Describe your fine-tuning needs',
    helpText: 'What data do you have, and what behaviour are you trying to change?',
    type: 'textarea',
    required: false,
    displayOrder: 10,
    dependsOn: { questionKey: 'fine_tuning', equals: true },
  },
  {
    key: 'integration',
    question: 'How will you connect to the model?',
    type: 'multiselect',
    required: false,
    displayOrder: 11,
    options: opts(
      'REST API',
      'OpenAI-compatible SDK',
      'Web playground',
      'Webhooks',
      'Not decided yet'
    ),
  },
  {
    key: 'monthly_budget',
    question: 'What monthly budget do you have in mind?',
    helpText: 'Helps us recommend a configuration you will actually be happy paying for.',
    type: 'select',
    required: false,
    displayOrder: 12,
    options: opts(
      ['Under $500', { maxMonthlyBudget: 500, costPriority: 1 }],
      ['$500 – $2,000', { maxMonthlyBudget: 2000, costPriority: 0.7 }],
      ['$2,000 – $10,000', { maxMonthlyBudget: 10000, costPriority: 0.4 }],
      // No ceiling — but still worth knowing they are not optimising for price.
      ['More than $10,000', { costPriority: 0.1 }],
      'Prefer not to say'
    ),
  },
  {
    key: 'timeline',
    question: 'When do you need this running?',
    type: 'radio',
    required: true,
    displayOrder: 13,
    options: opts('As soon as possible', 'This week', 'This month', 'Just exploring'),
  },
  {
    key: 'notes',
    question: 'Anything else we should know?',
    type: 'textarea',
    placeholder: 'Special requirements, existing infrastructure, questions for our team…',
    required: false,
    displayOrder: 14,
  },
];

const seed = async () => {
  await connect();

  /**
   * Routed through questionTemplateService rather than written directly:
   * `affectsSizing` is derived from the options and signal rules, never taken
   * from the seed data, and the service is the one place that derivation lives.
   */
  const counts = await upsertAll('questionTemplate', 'key', QUESTIONS, {
    label: (q) => `${q.key} — ${q.question}`,
    via: {
      create: (data) => questionTemplateService.create(data),
      update: (existing, data) => questionTemplateService.update(existing.id, data),
    },
  });

  console.log('Edit these any time in Admin Center → AI Infrastructure → Questionnaire.');
  await finish('Questionnaire seeded', counts);
};

seed().catch((err) => fail('Questionnaire seed', err));
