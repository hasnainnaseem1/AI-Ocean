/**
 * Seed the shared use-case vocabulary.
 *
 * These keys are the contract between two independently-edited things:
 *   - `AIModel.useCases[].key`      — what a model is good at
 *   - `QuestionTemplate.options[].signals.prefersUseCases[].useCase`
 *                                   — what an answer implies the customer wants
 *
 * The first eight keys are exactly what `opts()` in seedQuestionnaire.js
 * derives from the `use_case` option labels (`'Chat / assistant'` →
 * `chat_assistant`), so the questionnaire and the catalogue line up without
 * anyone having to remember to keep them in sync. The rest exist only for
 * tagging models and can be attached to answers later.
 *
 * MUST run before seedCatalog.js and seedQuestionnaire.js.
 *
 * Run with:  node src/scripts/seed/seedUseCaseTags.js [--force]
 */
require('dotenv').config();
const { connect, upsertAll, finish, fail } = require('./seedHelpers');

const TAGS = [
  {
    key: 'chat_assistant',
    label: 'Chat / assistant',
    description: 'Conversational assistants, support bots, internal copilots.',
    displayOrder: 1,
  },
  {
    key: 'code_generation',
    label: 'Code generation',
    description: 'Writing, completing, reviewing or explaining code.',
    displayOrder: 2,
  },
  {
    key: 'image_generation',
    label: 'Image generation',
    description: 'Creating or editing images from text prompts.',
    displayOrder: 3,
  },
  {
    key: 'document_analysis_rag',
    label: 'Document analysis / RAG',
    description: 'Answering from your own documents — long context and retrieval.',
    displayOrder: 4,
  },
  {
    key: 'semantic_search_embeddings',
    label: 'Semantic search / embeddings',
    description: 'Turning text into vectors for search, clustering or dedupe.',
    displayOrder: 5,
  },
  {
    key: 'data_extraction_classification',
    label: 'Data extraction & classification',
    description: 'Pulling structured fields out of messy text, tagging and routing.',
    displayOrder: 6,
  },
  {
    key: 'fine_tuning_training',
    label: 'Fine-tuning / training',
    description: 'Adapting a model to your own data rather than only running it.',
    displayOrder: 7,
  },
  {
    key: 'reasoning',
    label: 'Complex reasoning',
    description: 'Multi-step problems, planning, maths and analysis.',
    displayOrder: 8,
  },
  {
    key: 'agentic',
    label: 'Agents & tool use',
    description: 'Calling tools, following multi-step workflows autonomously.',
    displayOrder: 9,
  },
  {
    key: 'multilingual',
    label: 'Multilingual',
    description: 'Working reliably across many languages.',
    displayOrder: 10,
  },
];

const seed = async () => {
  await connect();

  const counts = await upsertAll('useCaseTag', 'key', TAGS, {
    label: (t) => `${t.key} — ${t.label}`,
  });

  console.log('Run seedCatalog.js and seedQuestionnaire.js next — both reference these keys.');
  await finish('Use case tags seeded', counts);
};

seed().catch((err) => fail('Use case tag seed', err));
