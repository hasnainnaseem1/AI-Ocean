/**
 * Seed the AI model catalog and the machine tiers.
 *
 * Run seedResourceComponents.js FIRST — every tier below is assembled from
 * those priced components by name, and its hourly rate is the sum of them.
 * Nothing here types a machine price directly.
 *
 * Idempotent: existing entries are matched by slug and updated rather than
 * duplicated, so this can be re-run safely after editing the data below.
 *
 * Run with:  node src/scripts/seed/seedCatalog.js
 */
require('dotenv').config();
const { connect, prisma, finish, fail } = require('./seedHelpers');
const catalogService = require('../../services/catalog/catalogService');

const slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * ── Tiers — the machines customers deploy onto ──
 *
 * `parts` names must match components seeded by seedResourceComponents.js.
 * The tier's running rate is the sum of every part; its stopped rate is the
 * sum of only the parts flagged as billed while stopped — in practice, the
 * disk. Neither number is written here, both are computed.
 *
 * Note the last two: a tier does not have to have an accelerator. A machine
 * with no GPU part simply reports zero VRAM and is sized accordingly.
 */
const TIERS = [
  {
    name: 'RTX 4090 24GB',
    category: 'GPU Optimized',
    parts: [
      { name: 'NVIDIA RTX 4090 24GB', quantity: 1 },
      { name: 'Standard vCPU', quantity: 8 },
      { name: 'DDR5 RAM', quantity: 64 },
      { name: 'NVMe SSD', quantity: 500 },
      { name: 'Network Bandwidth', quantity: 1 },
    ],
    regions: ['eu-central', 'us-east'],
    capacity: { total: 8, allocated: 0 },
    description: 'Entry-level inference for smaller models and development work.',
    displayOrder: 1,
  },
  {
    name: 'A100 40GB',
    category: 'GPU Optimized',
    parts: [
      { name: 'NVIDIA A100 40GB', quantity: 1 },
      { name: 'Standard vCPU', quantity: 12 },
      { name: 'DDR5 RAM', quantity: 128 },
      { name: 'NVMe SSD', quantity: 1000 },
      { name: 'Network Bandwidth', quantity: 10 },
    ],
    regions: ['eu-central', 'us-east'],
    capacity: { total: 6, allocated: 0 },
    description: 'Balanced option for mid-sized models in production.',
    displayOrder: 2,
  },
  {
    name: 'A100 80GB',
    category: 'GPU Optimized',
    parts: [
      { name: 'NVIDIA A100 80GB', quantity: 1 },
      { name: 'Standard vCPU', quantity: 16 },
      { name: 'DDR5 RAM', quantity: 256 },
      { name: 'NVMe SSD', quantity: 2000 },
      { name: 'Network Bandwidth', quantity: 10 },
    ],
    regions: ['eu-central', 'us-east', 'ap-south'],
    capacity: { total: 4, allocated: 0 },
    description: 'Large context windows and 70B-class models.',
    displayOrder: 3,
  },
  {
    name: 'H100 80GB',
    category: 'GPU Optimized',
    parts: [
      { name: 'NVIDIA H100 80GB', quantity: 1 },
      { name: 'Standard vCPU', quantity: 20 },
      { name: 'DDR5 RAM', quantity: 256 },
      { name: 'NVMe SSD', quantity: 2000 },
      { name: 'Network Bandwidth', quantity: 25 },
    ],
    regions: ['eu-central', 'us-east'],
    capacity: { total: 4, allocated: 0 },
    description: 'Highest single-accelerator throughput, best for latency-sensitive production.',
    displayOrder: 4,
  },
  {
    name: 'H100 80GB x2',
    category: 'GPU Optimized',
    parts: [
      { name: 'NVIDIA H100 80GB', quantity: 2 },
      { name: 'Standard vCPU', quantity: 40 },
      { name: 'DDR5 RAM', quantity: 512 },
      { name: 'NVMe SSD', quantity: 4000 },
      { name: 'Network Bandwidth', quantity: 25 },
    ],
    regions: ['eu-central', 'us-east'],
    capacity: { total: 2, allocated: 0 },
    description: 'Multi-accelerator serving for very large models.',
    displayOrder: 5,
  },
  {
    name: 'H100 80GB x4',
    category: 'GPU Optimized',
    parts: [
      { name: 'NVIDIA H100 80GB', quantity: 4 },
      { name: 'Standard vCPU', quantity: 80 },
      { name: 'DDR5 RAM', quantity: 1024 },
      { name: 'NVMe SSD', quantity: 8000 },
      { name: 'Network Bandwidth', quantity: 50 },
    ],
    regions: ['eu-central'],
    capacity: { total: 1, allocated: 0 },
    description: 'Frontier-scale models such as DeepSeek V3 at full precision.',
    displayOrder: 6,
  },
  {
    name: 'CPU Compute 16',
    category: 'CPU Optimized',
    parts: [
      { name: 'High-Frequency vCPU', quantity: 16 },
      { name: 'DDR5 RAM', quantity: 32 },
      { name: 'SSD', quantity: 500 },
      { name: 'Network Bandwidth', quantity: 5 },
    ],
    regions: ['eu-central', 'us-east'],
    capacity: { total: 20, allocated: 0 },
    description: 'No accelerator — cores and clock speed for embeddings, retrieval and pre/post-processing.',
    displayOrder: 7,
  },
  {
    name: 'Memory Optimized 256GB',
    category: 'Memory Optimized',
    parts: [
      { name: 'Standard vCPU', quantity: 16 },
      { name: 'DDR5 RAM', quantity: 256 },
      { name: 'NVMe SSD', quantity: 1000 },
      { name: 'Network Bandwidth', quantity: 10 },
    ],
    regions: ['eu-central'],
    capacity: { total: 6, allocated: 0 },
    description: 'Large RAM with no accelerator, for in-memory datasets and vector stores.',
    displayOrder: 8,
  },
];

/* ── Models. `tiers` names must match the TIERS above. ── */
const MODELS = [
  {
    name: 'Kimi K2',
    family: 'kimi',
    version: 'K2-Instruct',
    shortDescription: 'Moonshot AI\'s flagship model with an exceptionally long context window.',
    description:
      'Kimi K2 is a mixture-of-experts model from Moonshot AI, strong at long-document reasoning ' +
      'and agentic tool use. Its very large context window makes it a good fit for workloads that ' +
      'need to read whole codebases, contracts or research archives in a single pass.',
    modalities: ['chat', 'completion', 'code'],
    parameterSize: '1T (32B active)',
    contextLength: 128000,
    minVramGb: 160,
    license: 'Modified MIT',
    huggingFaceId: 'moonshotai/Kimi-K2-Instruct',
    category: 'General Purpose',
    tags: ['long-context', 'agentic', 'moe'],
    useCases: [
      { key: 'document_analysis_rag', fit: 'excellent', note: 'Reads whole codebases or contracts in one pass.' },
      { key: 'agentic', fit: 'excellent' },
      { key: 'chat_assistant', fit: 'good' },
      { key: 'code_generation', fit: 'good' },
      { key: 'reasoning', fit: 'good' },
    ],
    strengths: [
      '128K context — whole documents in a single prompt',
      'Strong at multi-step tool use',
    ],
    limitations: [
      'Needs a multi-GPU configuration, so it is not the cheapest way to run a chatbot',
    ],
    isFeatured: true,
    displayOrder: 1,
    tiers: [
      { name: 'H100 80GB x4', recommended: true, priceMultiplier: 1 },
      { name: 'H100 80GB x2', priceMultiplier: 1.1 },
    ],
  },
  {
    name: 'DeepSeek V3',
    family: 'deepseek',
    version: 'V3',
    shortDescription: 'High-performance open MoE model that rivals closed frontier models.',
    description:
      'DeepSeek V3 is a large mixture-of-experts model with strong general reasoning and coding ' +
      'ability at a fraction of the serving cost of dense models of similar quality.',
    modalities: ['chat', 'completion', 'code'],
    parameterSize: '671B (37B active)',
    contextLength: 128000,
    minVramGb: 160,
    license: 'DeepSeek License',
    huggingFaceId: 'deepseek-ai/DeepSeek-V3',
    category: 'General Purpose',
    tags: ['reasoning', 'coding', 'moe'],
    useCases: [
      { key: 'code_generation', fit: 'excellent' },
      { key: 'reasoning', fit: 'excellent' },
      { key: 'chat_assistant', fit: 'good' },
      { key: 'agentic', fit: 'good' },
    ],
    strengths: [
      'Among the strongest open models for code',
      'Mixture-of-experts keeps inference cost down for its size',
    ],
    limitations: [
      'Large memory footprint even though only part of the model is active',
    ],
    isFeatured: true,
    displayOrder: 2,
    tiers: [
      { name: 'H100 80GB x4', recommended: true, priceMultiplier: 1 },
      { name: 'H100 80GB x2', priceMultiplier: 1.15 },
    ],
  },
  {
    name: 'DeepSeek R1',
    family: 'deepseek',
    version: 'R1',
    shortDescription: 'Reasoning-first model that thinks step by step before answering.',
    description:
      'DeepSeek R1 is trained for extended chain-of-thought reasoning. It trades latency for ' +
      'accuracy on maths, logic and multi-step problems, and is best paired with workloads that ' +
      'value correctness over response speed.',
    modalities: ['chat', 'completion', 'code'],
    parameterSize: '671B (37B active)',
    contextLength: 128000,
    minVramGb: 160,
    license: 'MIT',
    huggingFaceId: 'deepseek-ai/DeepSeek-R1',
    category: 'Reasoning',
    tags: ['reasoning', 'chain-of-thought'],
    useCases: [
      { key: 'reasoning', fit: 'excellent', note: 'Built specifically for step-by-step problem solving.' },
      { key: 'code_generation', fit: 'good' },
      { key: 'data_extraction_classification', fit: 'good' },
    ],
    strengths: [
      'Shows its working, which makes answers auditable',
    ],
    limitations: [
      'Reasoning tokens make responses slower and more expensive per answer',
      'Overkill for simple chat',
    ],
    displayOrder: 3,
    tiers: [
      { name: 'H100 80GB x4', recommended: true, priceMultiplier: 1 },
    ],
  },
  {
    name: 'Llama 3.3 70B',
    family: 'llama',
    version: '3.3-70B-Instruct',
    shortDescription: 'Meta\'s widely-supported open model — the safe default for most workloads.',
    description:
      'Llama 3.3 70B offers a strong balance of quality, cost and ecosystem support. Almost every ' +
      'inference server, fine-tuning toolkit and quantisation format supports it, which makes it ' +
      'the least risky choice for a first production deployment.',
    modalities: ['chat', 'completion', 'code'],
    parameterSize: '70B',
    contextLength: 128000,
    minVramGb: 80,
    license: 'Llama 3.3 Community License',
    huggingFaceId: 'meta-llama/Llama-3.3-70B-Instruct',
    category: 'General Purpose',
    tags: ['popular', 'well-supported'],
    useCases: [
      { key: 'chat_assistant', fit: 'excellent', note: 'The safe default for a general assistant.' },
      { key: 'document_analysis_rag', fit: 'good' },
      { key: 'code_generation', fit: 'good' },
      { key: 'data_extraction_classification', fit: 'good' },
    ],
    strengths: [
      'The best-supported open model — most tooling assumes it',
      'Runs on a single 80GB GPU',
    ],
    isFeatured: true,
    displayOrder: 4,
    tiers: [
      { name: 'H100 80GB', recommended: true, priceMultiplier: 1 },
      { name: 'A100 80GB', priceMultiplier: 1 },
      { name: 'H100 80GB x2', priceMultiplier: 1 },
    ],
  },
  {
    name: 'Qwen 2.5 72B',
    family: 'qwen',
    version: '2.5-72B-Instruct',
    shortDescription: 'Alibaba\'s multilingual model with excellent non-English performance.',
    description:
      'Qwen 2.5 72B is particularly strong across Chinese, Arabic and South-East Asian languages ' +
      'while remaining competitive in English, making it a good fit for multilingual products.',
    modalities: ['chat', 'completion', 'code'],
    parameterSize: '72B',
    contextLength: 131072,
    minVramGb: 80,
    license: 'Qwen License',
    huggingFaceId: 'Qwen/Qwen2.5-72B-Instruct',
    category: 'Multilingual',
    tags: ['multilingual', 'long-context'],
    useCases: [
      { key: 'multilingual', fit: 'excellent', note: 'Strong across 29 languages, not just English.' },
      { key: 'chat_assistant', fit: 'excellent' },
      { key: 'document_analysis_rag', fit: 'good' },
      { key: 'code_generation', fit: 'good' },
    ],
    strengths: [
      '131K context window',
      'Reliable outside English, where many models degrade',
    ],
    displayOrder: 5,
    tiers: [
      { name: 'H100 80GB', recommended: true, priceMultiplier: 1 },
      { name: 'A100 80GB', priceMultiplier: 1 },
    ],
  },
  {
    name: 'Qwen 2.5 VL 32B',
    family: 'qwen',
    version: '2.5-VL-32B',
    shortDescription: 'Vision-language model for image understanding and document parsing.',
    description:
      'Qwen 2.5 VL reads images, screenshots, charts and scanned documents alongside text. Useful ' +
      'for document extraction, UI automation and visual question answering.',
    modalities: ['chat', 'vision'],
    parameterSize: '32B',
    contextLength: 32768,
    minVramGb: 40,
    license: 'Qwen License',
    huggingFaceId: 'Qwen/Qwen2.5-VL-32B-Instruct',
    category: 'Vision',
    tags: ['vision', 'document-ai', 'ocr'],
    useCases: [
      { key: 'data_extraction_classification', fit: 'excellent', note: 'Reads scans, forms and screenshots directly.' },
      { key: 'document_analysis_rag', fit: 'excellent' },
      { key: 'chat_assistant', fit: 'possible' },
    ],
    strengths: [
      'Handles images and PDFs without a separate OCR step',
      'Fits on a single A100',
    ],
    limitations: [
      '32K context is short for very long documents',
      'Text-only work is cheaper on a non-vision model',
    ],
    displayOrder: 6,
    tiers: [
      { name: 'A100 80GB', recommended: true, priceMultiplier: 1 },
      { name: 'A100 40GB', priceMultiplier: 1 },
    ],
  },
  {
    name: 'Mistral Small 3',
    family: 'mistral',
    version: 'Small-3-24B',
    shortDescription: 'Fast, low-cost model for high-volume chat and classification.',
    description:
      'Mistral Small 3 delivers most of the quality of much larger models on everyday tasks at a ' +
      'fraction of the serving cost, which makes it well suited to high-throughput chat, routing ' +
      'and classification workloads.',
    modalities: ['chat', 'completion', 'code'],
    parameterSize: '24B',
    contextLength: 32768,
    minVramGb: 24,
    license: 'Apache 2.0',
    huggingFaceId: 'mistralai/Mistral-Small-24B-Instruct-2501',
    category: 'Fast & Efficient',
    tags: ['low-cost', 'high-throughput', 'apache'],
    useCases: [
      { key: 'chat_assistant', fit: 'excellent', note: 'Fast and cheap enough for high-volume chat.' },
      { key: 'data_extraction_classification', fit: 'good' },
      { key: 'code_generation', fit: 'possible' },
    ],
    strengths: [
      'Lowest cost per request in the catalogue',
      'Apache 2.0 — no licence restrictions',
      'Runs on a single 24GB card',
    ],
    limitations: [
      'Less capable than the 70B-class models on hard reasoning',
    ],
    displayOrder: 7,
    tiers: [
      { name: 'A100 40GB', recommended: true, priceMultiplier: 1 },
      { name: 'RTX 4090 24GB', priceMultiplier: 1 },
      { name: 'A100 80GB', priceMultiplier: 1 },
    ],
  },
  {
    name: 'FLUX.1 dev',
    family: 'custom',
    version: '1-dev',
    shortDescription: 'State-of-the-art open image generation.',
    description:
      'FLUX.1 dev generates high-quality images from text prompts, with strong prompt adherence and ' +
      'text rendering. Suited to product imagery, marketing assets and creative tooling.',
    modalities: ['image_generation'],
    parameterSize: '12B',
    contextLength: 512,
    minVramGb: 24,
    license: 'FLUX.1 dev Non-Commercial License',
    huggingFaceId: 'black-forest-labs/FLUX.1-dev',
    category: 'Image Generation',
    tags: ['image', 'diffusion', 'creative'],
    useCases: [
      { key: 'image_generation', fit: 'excellent' },
    ],
    strengths: [
      'State-of-the-art open image quality',
      'Runs on a single 40GB GPU',
    ],
    limitations: [
      'Images only — it cannot hold a conversation or read documents',
    ],
    displayOrder: 8,
    tiers: [
      { name: 'A100 40GB', recommended: true, priceMultiplier: 1 },
      { name: 'RTX 4090 24GB', priceMultiplier: 1 },
    ],
  },
  {
    name: 'BGE M3 Embeddings',
    family: 'custom',
    version: 'bge-m3',
    shortDescription: 'Multilingual embedding model for search and RAG.',
    description:
      'BGE M3 produces dense embeddings across 100+ languages, and is the usual choice for building ' +
      'semantic search and retrieval-augmented generation on private data.',
    modalities: ['embedding'],
    parameterSize: '568M',
    contextLength: 8192,
    minVramGb: 8,
    license: 'MIT',
    huggingFaceId: 'BAAI/bge-m3',
    category: 'Embeddings',
    tags: ['embeddings', 'rag', 'search', 'multilingual'],
    useCases: [
      { key: 'semantic_search_embeddings', fit: 'excellent' },
      { key: 'document_analysis_rag', fit: 'excellent', note: 'The retrieval half of a RAG stack.' },
      { key: 'multilingual', fit: 'excellent' },
    ],
    strengths: [
      'Covers 100+ languages',
      'Cheapest model to run in the catalogue',
    ],
    limitations: [
      'Produces vectors, not text — pair it with a chat model to answer questions',
    ],
    displayOrder: 9,
    tiers: [
      { name: 'RTX 4090 24GB', recommended: true, priceMultiplier: 1 },
    ],
  },
];

const FORCE = process.argv.includes('--force');

const seed = async () => {
  await connect();

  /* ── Tiers ── */

  /**
   * Resolve the names in `parts` and `category` to the rows seeded by
   * seedResourceComponents.js. Everything downstream addresses them by
   * `id`, which is what catalogService's resolvers expect.
   * Missing ones are a setup mistake worth stopping for — a tier priced from
   * parts that do not exist would come out free.
   */
  const componentBySlug = {};
  (await prisma.resourceComponent.findMany()).forEach((c) => { componentBySlug[c.slug] = c; });

  const categoryBySlug = {};
  (await prisma.tierCategory.findMany()).forEach((c) => { categoryBySlug[c.slug] = c; });

  if (!Object.keys(componentBySlug).length) {
    console.error(
      '\nNo resource components found. Run this first:\n'
      + '  npm run seed:components\n'
    );
    await finish();
    process.exit(1);
  }

  const tierBySlug = {};
  for (const { parts, category, ...data } of TIERS) {
    const slug = slugify(data.name);

    // catalogService resolves these picks itself and rolls them up into
    // pricePerHour / stoppedPricePerHour plus the flat spec fields — the work
    // is required before the row is written.
    const components = (parts || []).map((part) => {
      const component = componentBySlug[slugify(part.name)];
      if (!component) {
        console.warn(`  ! ${data.name} references unknown component "${part.name}" — skipped`);
        return null;
      }
      return { componentId: component.id, quantity: part.quantity };
    }).filter(Boolean);

    const existing = await prisma.tier.findUnique({
      where: { slug },
      include: catalogService.TIER_INCLUDE,
    });

    if (existing && existing.updatedById && !FORCE) {
      console.log(`  skipped tier  ${existing.name} — edited in Admin Center (re-run with --force)`);
      tierBySlug[slug] = catalogService.toTierJSON(existing);
      continue;
    }

    const payload = {
      ...data,
      slug,
      categoryId: categoryBySlug[slugify(category || '')]?.id || null,
      components,
      pricing: { mode: 'components', markupPercent: 0 },
      // Never clobber stock an admin has already allocated
      capacity: {
        ...(data.capacity || {}),
        allocated: existing?.capacityAllocated ?? data.capacity?.allocated ?? 0,
      },
    };

    const { tier } = existing
      ? await catalogService.updateTier(existing, payload)
      : await catalogService.createTier(payload);

    console.log(`  ${existing ? 'updated' : 'created'} tier  ${tier.name}`);
    console.log(
      `                ${tier.currency} ${tier.pricePerHour}/hr running · `
      + `${tier.currency} ${tier.stoppedPricePerHour}/hr stopped · `
      + `${tier.gpuCount || 0} GPU / ${tier.vcpu} vCPU / ${tier.ramGb}GB RAM / ${tier.storageGb}GB ${tier.storageType}`
    );

    tierBySlug[slug] = tier;
  }

  /* ── Models ── */
  for (const { tiers, ...data } of MODELS) {
    const slug = slugify(data.name);

    const supportedTiers = (tiers || [])
      .map((link) => {
        const tier = tierBySlug[slugify(link.name)];
        if (!tier) {
          console.warn(`  ! ${data.name} references unknown tier "${link.name}" — skipped`);
          return null;
        }
        return {
          tierId: tier.id,
          tierName: tier.name,
          recommended: !!link.recommended,
          priceMultiplier: link.priceMultiplier ?? 1,
          notes: link.notes || '',
        };
      })
      .filter(Boolean);

    const existing = await prisma.aIModel.findUnique({ where: { slug } });

    // Re-seeding replaces the tier links and use cases wholesale, which would
    // silently wipe anything an admin has tuned. `updatedById` is only ever set
    // by the admin PUT routes, so it marks exactly the rows a human has touched.
    if (existing && existing.updatedById && !FORCE) {
      console.log(`  skipped model ${existing.name} — edited in Admin Center (re-run with --force to overwrite)`);
      continue;
    }

    const payload = { ...data, slug, supportedTiers };
    const model = existing
      ? await catalogService.updateAIModel(existing, payload)
      : await catalogService.createAIModel(payload);

    console.log(`  ${existing ? 'updated' : 'created'} model ${model.name} (${supportedTiers.length} tier option(s))`);
  }

  console.log(`\nCatalog seeded: ${TIERS.length} tiers, ${MODELS.length} models`);
  await finish();
};

seed().catch((err) => fail('Catalog seed', err));
