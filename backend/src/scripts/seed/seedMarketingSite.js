/**
 * Seeds the marketing site with content that describes THIS product.
 *
 * The pages previously in the database were polished copy for "Sellsera", an
 * unrelated e-commerce SEO tool — leftovers from what this codebase used to
 * be. Every headline, feature card, testimonial and FAQ answer described a
 * product that does not exist here, which is worse than empty pages: it
 * looks finished while being entirely wrong.
 *
 * Two rules were followed writing this copy:
 *
 *   1. No invented social proof. The old site claimed a large seller count
 *      and carried three named testimonials from people who do not
 *      exist. Nothing here asserts a customer count, a rating or a quote —
 *      there are no stats or testimonials blocks at all, because this platform
 *      has no such numbers yet and inventing them is how a launch turns into a
 *      credibility problem. Where the pages do quantify something (models,
 *      machines, prices) it is rendered live from the catalogue.
 *   2. No brand name in the body copy. This is a white-label platform — the
 *      name comes from AdminSettings and renders in the header and footer, so
 *      hardcoding it into a headline would break the moment it is changed.
 *
 * Idempotent: upserts by slug, so re-running updates rather than duplicates.
 *
 *   node scripts/seed/seedMarketingSite.js
 */
require('dotenv').config();
const prisma = require('../../lib/prismaClient');
const marketingPageService = require('../../services/admin/marketingPageService');
const { connect, finish, fail } = require('./seedHelpers');

/* ─── Reusable fragments ──────────────────────────────────── */

// Screenshots of the actual product, captured from the customer center and
// uploaded to /uploads/general — see the product-showcase block below. Hosted
// on the backend rather than a CDN because that is exactly what an admin
// uploading these through the Marketing Site editor would also produce: an
// absolute URL pointing at this same backend.
const SHOWCASE_HOST = process.env.BACKEND_URL || 'http://localhost:3001';

const signupCta = (title, subtitle) => ({
  type: 'cta',
  title,
  subtitle,
  buttonText: 'Deploy your first model',
  buttonLink: '/signup',
  secondaryButtonText: 'See pricing',
  secondaryButtonLink: '/pricing',
});

/**
 * The explainer.
 *
 * The first draft of this site assumed the reader already knew what an AI
 * model is, what a GPU is for, and why anyone would rent one — so it opened
 * with "deploy open-source models on dedicated GPUs" and never defined a single
 * term. Somebody evaluating this for the first time had no way in.
 *
 * These three cards answer, in order, the three questions a newcomer actually
 * has: what am I running, what is it running on, and what do I end up with.
 */
const WHAT_THIS_IS = [
  {
    icon: 'brain',
    title: 'The model — the thing that does the work',
    description:
      'An AI model is a trained program. You send it text or an image; it sends back text, code, a picture, or a numeric representation you can search over.\n\n'
      + '"Open-weight" means the model\'s files are published, so anyone is free to run it on their own hardware instead of paying for access to someone else\'s. Those are the models in our catalogue.',
  },
  {
    icon: 'server',
    title: 'The machine — what makes it fast enough to use',
    description:
      'Models are too slow to be useful on an ordinary server, so they run on GPUs. Bigger models need more GPU memory: a small one is happy on 24GB, a 70-billion-parameter model wants 40–80GB.\n\n'
      + 'Picking that correctly is the part people get wrong, so you do not have to: you answer a few questions and we size it for you.',
  },
  {
    icon: 'plug',
    title: 'What you end up with',
    description:
      'We put the model on the machine, start it, and keep it running. You get a private web address and an API key.\n\n'
      + 'Your code calls that address the same way it would call OpenAI — for most projects you change two lines. Nobody else shares the machine, and you are billed for the hours it is switched on.',
  },
];

const HOW_IT_WORKS_STEPS = [
  {
    icon: 'message-square',
    title: 'Tell us what you are building',
    description: 'Answer a few questions about your use case, expected traffic, latency needs and monthly budget. No infrastructure knowledge required.',
  },
  {
    icon: 'target',
    title: 'Get a sized recommendation',
    description: 'We match your answers against every model and machine in the catalogue and explain, in plain language, why each one fits — and what it will cost.',
  },
  {
    icon: 'rocket',
    title: 'Deploy it',
    description: 'Confirm the model and machine. Your instance is provisioned on hardware reserved for you alone — never shared with another tenant.',
  },
  {
    icon: 'terminal',
    title: 'Call your endpoint',
    description: 'You get a private URL and an API key. Point your existing OpenAI-compatible client at it and you are running.',
  },
];

/* ─── Pages ───────────────────────────────────────────────── */

const pages = [
  /* ══════════════ HOME ══════════════ */
  {
    slug: 'home',
    title: 'Home',
    isHomePage: true,
    showInNavigation: false,
    navigationOrder: 0,
    status: 'published',
    description: 'We deploy open-source AI models on dedicated GPUs for you — no infrastructure to run yourself.',
    metaTitle: 'AI model hosting — we deploy it, you just call the API',
    metaDescription:
      'We host open-weight AI models on dedicated GPUs so you never have to. Private endpoint, per-hour billing, no infrastructure to manage.',
    metaKeywords: 'AI model hosting, GPU inference, dedicated GPU, open source LLM hosting, private inference endpoint',
    blocks: [
      {
        type: 'hero',
        title: 'We deploy the model. You just call the API.',
        // Kept close in length to the rotating variants below — a much
        // longer first line made the hero taller only on that one rotation,
        // shoving the CTA buttons down (and off-screen on shorter windows)
        // every time it cycled back in.
        subtitle:
          'No GPU to buy, no driver to configure, no server to babysit. Tell us what you\'re building — we handle the rest, from hardware to endpoint.',
        buttonText: 'Deploy your first model',
        buttonLink: '/signup',
        secondaryButtonText: 'See exactly how it works',
        secondaryButtonLink: '/how-it-works',
        settings: { gridBackground: true, heroStyle: 'signature' },
        // Rotates in after the headline above — same pitch from a few
        // different angles, so a visitor who reads for ten seconds without
        // scrolling still comes away knowing what this is, what it costs,
        // and what it replaces.
        items: [
          {
            title: 'Dedicated GPUs. Zero DevOps.',
            description: 'No infrastructure team to hire, no drivers to patch, no capacity to plan for. We run the hardware; you get an endpoint.',
          },
          {
            title: 'Effortless to deploy. Impossible to share.',
            description: 'Every model runs on a machine reserved for you alone — the setup takes minutes, and no one else\'s traffic ever touches yours.',
          },
          {
            title: 'You pay only for the hours it runs.',
            description: 'No monthly floor, no seat count. Pause a deployment and the meter stops — resume it later with everything exactly as you left it.',
          },
        ],
      },
      {
        // source:'models' — names come from the catalogue, never typed here.
        // A hand-written strip is precisely what keeps advertising a model
        // months after it was pulled from the catalogue.
        type: 'logos',
        title: 'Models ready to deploy',
        settings: { source: 'models' },
      },
      {
        // Placed immediately after the hero on purpose: a visitor who does not
        // already know what this is should not have to scroll past a wall of
        // benefits before anything is defined.
        type: 'split',
        title: 'What is this, exactly?',
        subtitle: 'Three things, in plain language — no prior knowledge assumed.',
        items: WHAT_THIS_IS,
      },
      {
        // Real screens from the product, not a description of them — see
        // ShowcaseBlock.js. Screenshots were captured from the customer
        // center and uploaded to /uploads/general.
        type: 'product_showcase',
        title: 'From question to endpoint in four steps',
        subtitle: 'You should not need to know what a GPU is to run one. Here is what that actually looks like.',
        items: [
          {
            icon: 'message-square',
            title: 'Tell us what you are building',
            description: 'A few plain-language questions — no infrastructure knowledge assumed.',
            image: `${SHOWCASE_HOST}/uploads/general/showcase-1-question-1788167635.png`,
          },
          {
            icon: 'target',
            title: 'Get a sized recommendation',
            description: 'Every model ranked against what you told us, with the reasoning shown and the price attached.',
            image: `${SHOWCASE_HOST}/uploads/general/showcase-2-recommendation-1788167635.png`,
          },
          {
            icon: 'rocket',
            title: 'Review, then deploy',
            description: 'The exact machine, region and rate — confirmed before anything runs or a cent is charged.',
            image: `${SHOWCASE_HOST}/uploads/general/showcase-3-ready-1788167635.png`,
          },
          {
            icon: 'sliders',
            title: 'Control it from day one',
            description: 'Your endpoint, your API key, pause and resume — all in one place once it is live.',
            image: `${SHOWCASE_HOST}/uploads/general/showcase-4-detail-1788167635.png`,
          },
        ],
      },
      {
        type: 'use_cases',
        title: 'What you can build',
        subtitle: 'Every use case below is matched to real models in the catalogue — pick one and we will show you what runs it.',
        buttonText: 'Explore use cases',
        buttonLink: '/use-cases',
        settings: { limit: 6 },
      },
      {
        type: 'model_catalog',
        title: 'Deployable models',
        subtitle: 'Open-weight models, running on hardware you control, at the rate shown.',
        buttonText: 'See all models',
        buttonLink: '/models',
        settings: { limit: 6 },
      },
      {
        type: 'features',
        title: 'Why run it here',
        subtitle: 'The trade-offs a shared API hides, made explicit and put under your control.',
                items: [
          {
            icon: 'server',
            title: 'Hardware reserved for you',
            description: 'Your model runs on a machine allocated to your deployment alone. No queueing behind another tenant, no throughput that changes with someone else\'s traffic.',
          },
          {
            icon: 'lock',
            title: 'A private endpoint and key',
            description: 'Each deployment gets its own URL and API key. Nothing routes through a shared gateway, and revoking a key affects only that deployment.',
          },
          {
            icon: 'clock',
            title: 'Billed by the hour, while running',
            description: 'Compute is charged for the hours the machine is actually up. There is no monthly floor and no commitment to sign.',
          },
          {
            icon: 'pause',
            title: 'Pause and keep your disk',
            description: 'Pausing stops compute charges and keeps your model weights on disk at a much smaller hourly rate, so restarting does not mean downloading everything again.',
          },
          {
            icon: 'target',
            title: 'Sizing you did not have to guess',
            description: 'The questionnaire matches your workload against every machine in the catalogue and explains its reasoning, so you are not choosing a GPU from a dropdown and hoping.',
          },
          {
            icon: 'wallet',
            title: 'Billing on your terms',
            description: 'Pre-pay into a credit balance and never be surprised, or run pay-as-you-go against a saved card. You can switch a deployment between the two at any time.',
          },
        ],
      },
      {
        // The features block above sells the pitch in one line each. This one
        // exists because that undersells what actually happens after checkout —
        // real, working controls that never made it into any copy before now.
        type: 'features',
        title: "Once it's running, it's yours to operate",
        subtitle: 'Not a black box you pay into and hope. Every one of these is a real control on your deployment page today.',
        items: [
          {
            icon: 'pause',
            title: 'Pause, resume, stop — on your schedule',
            description: 'Pause a deployment and compute charges stop immediately; only the far smaller disk rate applies while your model weights stay put. Resume later and it comes back exactly as you left it — nothing to redownload, nothing to reconfigure.',
          },
          {
            icon: 'key',
            title: "A key that's revoked the moment you don't need it",
            description: 'Every deployment gets its own API key. Rotate it any time from the deployment page, and it stops working automatically the instant you pause, stop or terminate it — an old key never keeps a machine reachable by accident.',
          },
          {
            icon: 'credit-card',
            title: 'Change how a deployment is billed, mid-flight',
            description: 'Prepaid and pay-as-you-go are set per deployment, not per account. Move one from a wallet balance to a saved card, or back, from its own page — and see every hour it has ever cost in that same place.',
          },
          {
            icon: 'refresh-cw',
            title: 'Set a top-up threshold and forget about it',
            description: 'Turn on auto top-up with a trigger balance you choose, and your wallet refills itself from a saved card before a deployment ever gets paused for lack of funds.',
          },
        ],
      },
      {
        type: 'faq',
        title: 'Common questions',
        items: [
          {
            title: 'Can my balance refill itself before it runs out?',
            description: 'Yes — turn on auto top-up in your billing settings and set a threshold. When your prepaid balance drops below it, we charge your saved card automatically so a deployment never pauses for lack of funds. It is opt-in and off by default.',
          },
          {
            title: 'Do I need to know which GPU I need?',
            description: 'No. The deployment flow asks about your use case, traffic, latency target and budget, then recommends a model and machine and explains why. You can override the recommendation if you already know what you want.',
          },
          {
            title: 'Is my model shared with other customers?',
            description: 'No. Each deployment is provisioned onto a machine reserved for it. Your endpoint and API key are yours alone, and your throughput does not change because of someone else\'s load.',
          },
          {
            title: 'What happens when I pause a deployment?',
            description: 'Compute charges stop immediately. Your disk — including the model weights — is kept and billed at a much smaller hourly rate, shown as "Paused" on the pricing page. Resuming brings the same deployment back without re-downloading anything.',
          },
          {
            title: 'How am I billed?',
            description: 'Either from a prepaid credit balance you top up in advance, or pay-as-you-go against a saved card. Prepaid deployments pause when the balance runs out; pay-as-you-go ones keep running and settle against your card. You choose per deployment and can switch at any time.',
          },
          {
            title: 'Can I use my existing OpenAI client?',
            description: 'Yes for the chat and completion models, which expose an OpenAI-compatible API — usually you only change the base URL and the key.',
          },
        ],
      },
      signupCta(
        'Start with one model and one hour',
        'No commitment, no minimum spend. Deploy something, see what it costs, and pause it when you are done.'
      ),
    ],
  },

  /* ══════════════ MODELS ══════════════ */
  {
    slug: 'models',
    title: 'Models',
    showInNavigation: true,
    navigationOrder: 1,
    status: 'published',
    description: 'Every open-weight model you can deploy, with the hourly rate it runs at.',
    metaTitle: 'Deployable AI models and hourly pricing',
    metaDescription:
      'Browse every open-weight model available to deploy — chat, reasoning, code, vision, image generation and embeddings — with the machine each one runs on and what it costs per hour.',
    metaKeywords: 'open source AI models, self hosted LLM, dedicated GPU inference, embedding model hosting',
    blocks: [
      {
        type: 'hero',
        title: 'Every model, and what it costs to run',
        subtitle:
          'Open-weight models across chat, reasoning, code, vision, image generation and embeddings. Prices are the real hourly rate on the smallest machine each model fits.',
        buttonText: 'Deploy a model',
        buttonLink: '/signup',
        settings: { gridBackground: true },
      },
      {
        type: 'model_catalog',
        title: 'The catalogue',
        subtitle: 'Every model below is ready to deploy today. The price shown is the hourly rate on the smallest machine it fits.',
        buttonText: 'See machine pricing',
        buttonLink: '/pricing',
      },
      {
        type: 'use_cases',
        title: 'Not sure which one you need?',
        subtitle: 'Start from what you are building — the deployment flow narrows the catalogue to models that actually serve it.',
        buttonText: 'Start the guided flow',
        buttonLink: '/signup',
              },
      signupCta(
        'Deploy any of these in a few minutes',
        'Answer a few questions and we will size the machine for you.'
      ),
    ],
  },

  /* ══════════════ HOW IT WORKS ══════════════ */
  {
    slug: 'how-it-works',
    title: 'How it works',
    showInNavigation: true,
    navigationOrder: 2,
    status: 'published',
    description: 'From a few questions to a private inference endpoint.',
    metaTitle: 'How it works — from questionnaire to private endpoint',
    metaDescription:
      'Answer a few questions about your workload, get a sized model and machine recommendation with reasoning, deploy it, and call your own private OpenAI-compatible endpoint.',
    metaKeywords: 'deploy AI model, GPU sizing, private inference endpoint, OpenAI compatible API',
    blocks: [
      {
        type: 'hero',
        title: 'You describe the workload. We size the machine.',
        subtitle:
          'Choosing a GPU usually means guessing at VRAM, reading benchmark tables and hoping. This replaces that with a few questions and an explained recommendation.',
        buttonText: 'Try it',
        buttonLink: '/signup',
        settings: { gridBackground: true },
      },
      {
        type: 'steps',
        title: 'The whole flow',
        items: HOW_IT_WORKS_STEPS,
      },
      {
        type: 'split',
        title: 'What happens at each stage',
                items: [
          {
            icon: 'target',
            title: 'A recommendation that shows its working',
            description:
              'Every suggestion comes with the reason behind it, tied back to the answer you gave — the context length you asked for, the latency you need, the budget you set.\n\nIf your budget cannot cover what your requirements imply, we say so plainly rather than quietly recommending something that will not cope. Nothing is hidden from the list; a machine that is a poor fit is ranked lower and labelled, not removed.',
          },
          {
            icon: 'lock',
            title: 'An endpoint that belongs to your deployment',
            description:
              'Once provisioned you get a URL and an API key scoped to that one deployment. Rotating or revoking the key affects nothing else you are running.\n\nChat and completion models speak the OpenAI API, so in most cases you point your existing client at a new base URL and change the key. There is no bespoke SDK to adopt.',
          },
          {
            icon: 'gauge',
            title: 'Costs you can see before they happen',
            description:
              'The hourly rate is fixed at the moment you order and does not change underneath you if the catalogue is repriced later.\n\nWhile a deployment runs you can see the accruing cost, the current run rate and the projected month. Pausing stops compute charges immediately and keeps your disk at a much smaller rate.',
          },
        ],
      },
      {
        type: 'code_sample',
        title: 'Calling your endpoint',
        subtitle: 'Chat and completion deployments expose an OpenAI-compatible API. Swap the base URL and key, and existing code works.',
        items: [
          {
            title: 'curl',
            description: `curl https://YOUR-DEPLOYMENT.endpoint.example/v1/chat/completions \\
  -H "Authorization: Bearer $YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "YOUR_MODEL_ID",
    "messages": [
      { "role": "user", "content": "Summarise this support thread." }
    ]
  }'`,
          },
          {
            title: 'Python',
            description: `from openai import OpenAI

client = OpenAI(
    base_url="https://YOUR-DEPLOYMENT.endpoint.example/v1",
    api_key=YOUR_API_KEY,
)

response = client.chat.completions.create(
    model="YOUR_MODEL_ID",
    messages=[
        {"role": "user", "content": "Summarise this support thread."}
    ],
)

print(response.choices[0].message.content)`,
          },
          {
            title: 'Node.js',
            description: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://YOUR-DEPLOYMENT.endpoint.example/v1",
  apiKey: process.env.YOUR_API_KEY,
});

const response = await client.chat.completions.create({
  model: "YOUR_MODEL_ID",
  messages: [
    { role: "user", content: "Summarise this support thread." },
  ],
});

console.log(response.choices[0].message.content);`,
          },
        ],
      },
      {
        type: 'faq',
        title: 'Questions about the flow',
        items: [
          {
            title: 'Can I skip the questionnaire?',
            description: 'Yes. The questionnaire exists to help if you are unsure; if you already know the model and machine you want, you can pick them directly from the catalogue.',
          },
          {
            title: 'How long does provisioning take?',
            description: 'A deployment is reviewed and provisioned before it goes live. You will see its status move through the stages in your dashboard, and you are not billed for compute until it is actually running.',
          },
          {
            title: 'Can I change the machine later?',
            description: 'You can stop a deployment and create a new one on a different machine. Because pricing is fixed at order time, an existing deployment keeps the rate it was created at.',
          },
          {
            title: 'What if my key leaks?',
            description: 'Rotate it from the deployment page. The old key stops working immediately and nothing else you run is affected, because keys are scoped per deployment.',
          },
        ],
              },
      signupCta('See the flow for yourself', 'It takes a few minutes and costs nothing until you deploy.'),
    ],
  },

  /* ══════════════ USE CASES ══════════════ */
  {
    slug: 'use-cases',
    title: 'Use cases',
    showInNavigation: true,
    navigationOrder: 3,
    status: 'published',
    description: 'What teams run on dedicated GPU deployments.',
    metaTitle: 'Use cases — what you can build on dedicated GPU deployments',
    metaDescription:
      'Chat assistants, code generation, RAG and document analysis, semantic search, image generation, agents and fine-tuning — each matched to open-weight models you can deploy.',
    metaKeywords: 'LLM use cases, RAG hosting, embeddings hosting, AI agents infrastructure, self hosted chat assistant',
    blocks: [
      {
        type: 'hero',
        title: 'Start from what you are building',
        subtitle:
          'Each use case below maps to models in the catalogue that actually serve it — so the shortlist you get is real, not a marketing category.',
        buttonText: 'Find my model',
        buttonLink: '/signup',
        settings: { gridBackground: true },
      },
      {
        type: 'use_cases',
        title: 'Pick what you are building',
        subtitle: 'Each card shows how many models in the catalogue currently serve that use case.',
      },
      {
        type: 'split',
        title: 'Where a dedicated deployment earns its place',
                items: [
          {
            icon: 'shield',
            title: 'When your data cannot leave your control',
            description:
              'Document analysis, internal copilots and anything touching customer records often cannot be sent to a third-party API under someone else\'s retention policy.\n\nA dedicated deployment gives you a private endpoint on hardware reserved for you, so the data path is one you can describe precisely to a security reviewer.',
          },
          {
            icon: 'activity',
            title: 'When throughput has to be predictable',
            description:
              'Shared APIs rate-limit, queue and degrade under other people\'s load, which makes latency a moving target.\n\nBecause nothing else runs on your machine, the throughput you measure on a quiet afternoon is the throughput you get at peak.',
          },
          {
            icon: 'dollar-sign',
            title: 'When per-token pricing stops making sense',
            description:
              'Batch jobs, embedding a large corpus, or a steady high-volume workload can cost far more per token than the same work on a machine you rent by the hour.\n\nAn hourly rate makes the arithmetic simple: you pay for the time, not the volume, so heavy use gets cheaper rather than more expensive.',
          },
        ],
      },
      signupCta('Find the model for your use case', 'Answer a few questions and see what fits — and what it costs.'),
    ],
  },

  /* ══════════════ PRICING ══════════════ */
  {
    slug: 'pricing',
    title: 'Pricing',
    showInNavigation: true,
    navigationOrder: 4,
    status: 'published',
    description: 'Hourly machine pricing with no minimum commitment.',
    metaTitle: 'GPU pricing — billed by the hour, no commitment',
    metaDescription:
      'Transparent hourly pricing for every GPU and CPU machine. Pay from a prepaid credit balance or pay-as-you-go on a saved card. Pause to keep your disk at a reduced rate.',
    metaKeywords: 'GPU pricing per hour, dedicated GPU cloud, AI inference cost, hourly GPU rental',
    blocks: [
      {
        type: 'hero',
        title: 'You pay for the hours the machine is up',
        subtitle:
          'No seats, no monthly floor, no commitment. Every machine below shows what it costs running, what it costs paused, and what a full month would come to.',
        buttonText: 'Get started',
        buttonLink: '/signup',
        settings: { gridBackground: true },
      },
      {
        // Cards first — "which one should I pick" — then the full table for
        // "how exactly do they compare". Both render from the tier records, so
        // neither can drift from what we actually charge.
        type: 'machine_cards',
        title: 'Choose a machine',
        subtitle: 'What each one is suited to, what is inside it, and what it costs to run.',
              },
      {
        type: 'gpu_pricing',
        title: 'Full specifications and pricing',
        subtitle: 'Every machine side by side, with the running, monthly and paused rate for each.',
                buttonText: 'Deploy a model',
        buttonLink: '/signup',
      },
      {
        type: 'features',
        title: 'Two ways to pay',
        subtitle: 'Choose per deployment, and switch whenever you like.',
        items: [
          {
            icon: 'wallet',
            title: 'Prepaid credit',
            description: 'Top up a balance in advance and usage draws from it. When the balance runs out the deployment pauses instead of running up a bill — the safest option if you want a hard ceiling on spend.',
          },
          {
            icon: 'credit-card',
            title: 'Pay-as-you-go',
            description: 'Usage settles against a saved card, so a deployment keeps running even when your balance is empty. Best when uptime matters more than a hard spending cap.',
          },
          {
            icon: 'repeat',
            title: 'Switch at any time',
            description: 'Billing method is a per-deployment setting, not an account-wide one. Move a deployment from prepaid to pay-as-you-go — or back — from its detail page whenever you need to.',
          },
        ],
      },
      {
        type: 'comparison',
        title: 'Dedicated deployment vs a shared API',
        subtitle: 'Both have their place. This is what actually differs.',
        settings: { columns: ['', 'Dedicated deployment', 'Shared per-token API'] },
        items: [
          { title: 'Hardware', features: ['Reserved for you', 'Shared'] },
          { title: 'Throughput under load', features: ['Predictable', 'Varies with demand'] },
          { title: 'Endpoint and key', features: ['Private per deployment', 'Shared gateway'] },
          { title: 'Billing unit', features: ['Per hour', 'Per token'] },
          { title: 'Cost at high volume', features: ['Flat', 'Grows with usage'] },
          { title: 'Cost when idle', features: ['Pause to disk-only', 'None'] },
          // Kept as text rather than a tick: one lone green mark in an
          // otherwise textual table reads as a stray element, not an answer.
          { title: 'Choice of model', features: ['Any in the catalogue', 'Provider\'s list'] },
          { title: 'Best for', features: ['Steady or sensitive workloads', 'Spiky, low volume'] },
        ],
      },
      {
        type: 'faq',
        title: 'Billing questions',
        items: [
          {
            title: 'Is there a minimum commitment?',
            description: 'No. There is no monthly minimum, no seat count and no contract. You are billed for the hours a machine is up, and you can stop it whenever you like.',
          },
          {
            title: 'What does "Paused" cost cover?',
            description: 'When a deployment is paused, compute charges stop but your disk is still held — including the model weights, which can be tens of gigabytes. The paused rate is what that storage costs. If a machine has no storage component configured, pausing is free.',
          },
          {
            title: 'What happens if my credit runs out?',
            description: 'A prepaid deployment pauses at the moment the balance is exhausted, and resumes automatically once you top up. A pay-as-you-go deployment keeps running and the shortfall is charged to your saved card, or carried as an outstanding balance if the charge fails.',
          },
          {
            title: 'Do I need a card on file?',
            description: 'For pay-as-you-go, yes — that is what the usage settles against. Whether a verified card is also required for prepaid deployments is a platform setting; if it applies to your account you will be prompted before anything can run.',
          },
          {
            title: 'Does the price change after I deploy?',
            description: 'No. The hourly rate is fixed onto your deployment when you order it. If the catalogue is repriced afterwards, existing deployments keep the rate they were created at.',
          },
        ],
      },
      signupCta('See what your workload would cost', 'Deploy something for an hour and find out exactly, rather than estimating.'),
    ],
  },

  /* ══════════════ CONTACT ══════════════ */
  {
    slug: 'contact',
    title: 'Contact',
    showInNavigation: true,
    navigationOrder: 5,
    status: 'published',
    description: 'Talk to us about your workload.',
    metaTitle: 'Contact us',
    metaDescription: 'Questions about sizing, pricing, or running a specific model? Get in touch.',
    metaKeywords: 'contact, AI hosting support, GPU sizing help, model deployment support',
    blocks: [
      {
        type: 'hero',
        title: 'Talk to us about your workload',
        subtitle:
          'Questions about sizing a machine, running a model that is not in the catalogue, or what a specific workload would cost — ask and we will answer properly.',
        settings: { gridBackground: true },
      },
      {
        type: 'contact',
                title: 'Send a message',
        content:
          'We answer during business hours, Monday to Friday.\n\nIf you already have an account, the support section inside your dashboard is faster — it comes through with your deployment details attached.',
        items: [
          {
            icon: 'life-buoy',
            title: 'Existing customers',
            description: 'Open a ticket from your dashboard for the quickest route.',
          },
          {
            icon: 'target',
            title: 'Sizing help',
            description: 'Tell us your model, context length and expected requests per day.',
          },
        ],
      },
      {
        type: 'faq',
        title: 'Before you write',
                items: [
          {
            title: 'Can you host a model that is not in the catalogue?',
            description: 'Often yes, if the weights are open and it fits on a machine we offer. Tell us which model and what you need it for.',
          },
          {
            title: 'Can you help me choose a machine?',
            description: 'The deployment flow does this automatically, but if you would rather talk it through, send us your context length, expected requests per day and latency target.',
          },
          {
            title: 'Do you offer volume or committed pricing?',
            description: 'Get in touch with your expected monthly hours and we will come back to you.',
          },
        ],
      },
    ],
  },

  /* ══════════════ BLOG (nav entry only) ══════════════
     /blog is served by BlogListPage, not the block renderer — this record
     exists so the page appears in navigation and carries its own SEO. */
  {
    slug: 'blog',
    title: 'Blog',
    showInNavigation: true,
    navigationOrder: 6,
    status: 'published',
    description: 'Notes on running open-weight models in production.',
    metaTitle: 'Blog',
    metaDescription: 'Notes on running open-weight models on dedicated GPUs — sizing, cost, and deployment practice.',
    metaKeywords: 'AI infrastructure blog, GPU sizing, open weight models, inference cost',
    blocks: [],
  },

  /* ══════════════ PRIVACY ══════════════ */
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    showInNavigation: false,
    navigationOrder: 90,
    status: 'published',
    description: 'How we handle your data.',
    metaTitle: 'Privacy Policy',
    metaDescription: 'How we collect, use and protect your data.',
    metaKeywords: 'privacy policy, data protection, AI hosting privacy',
    noIndex: false,
    blocks: [
      {
        type: 'text',
        title: 'Privacy Policy',
        subtitle: 'How we collect, use and protect your information.',
        content: `PLACEHOLDER — REVIEW BEFORE LAUNCH
This text is a structural starting point, not legal advice. Have it reviewed by a qualified lawyer for your jurisdiction before you go live.

1. Information we collect
Account information you provide when registering: name, email address and, where applicable, billing details. Payment card numbers are handled by our payment processor and are never stored on our servers.

Usage information generated as you use the platform: deployments you create, the machines they run on, hours consumed, and billing records derived from them.

Technical information collected automatically: IP address, browser type and device information, and log data relating to access and errors.

2. What we do with it
To provide and operate the service, including provisioning deployments and metering usage.
To bill you accurately and to collect payment.
To communicate with you about your account, your deployments and service changes.
To detect, investigate and prevent fraud, abuse and security incidents.
To meet our legal and regulatory obligations.

3. Content you send to your deployments
Prompts and data you send to a deployment are processed by the model running on the machine allocated to you. We do not use that content to train models and we do not sell it. Operational logs necessary to run and support the service may record metadata about requests.

4. Sharing
We share personal data only with service providers who help us operate the platform — hosting, payment processing, email delivery — and only to the extent needed for those functions. We do not sell personal data. We may disclose information where required by law.

5. Retention
Account and billing records are retained for as long as your account is active and afterwards for the period required by applicable tax and accounting rules. Deployment data is removed when a deployment is terminated and its disk released.

6. Your rights
Depending on where you live, you may have the right to access, correct, export or delete your personal data, and to object to or restrict certain processing. Contact us to exercise any of these.

7. Security
We use industry-standard measures to protect your data, including encryption in transit and access controls. No system is perfectly secure, and we cannot guarantee absolute security.

8. Changes
We will post any changes to this policy on this page and update the date below. Material changes will be communicated to you directly.

9. Contact
Questions about this policy can be sent to the contact address listed on our contact page.`,
      },
    ],
  },

  /* ══════════════ TERMS ══════════════ */
  {
    slug: 'terms',
    title: 'Terms & Conditions',
    showInNavigation: false,
    navigationOrder: 91,
    status: 'published',
    description: 'The terms governing use of the platform.',
    metaTitle: 'Terms & Conditions',
    metaDescription: 'The terms and conditions governing your use of the platform.',
    metaKeywords: 'terms of service, terms and conditions, acceptable use policy',
    blocks: [
      {
        type: 'text',
        title: 'Terms & Conditions',
        subtitle: 'The agreement between you and us for use of the platform.',
        content: `PLACEHOLDER — REVIEW BEFORE LAUNCH
This text is a structural starting point, not legal advice. Have it reviewed by a qualified lawyer for your jurisdiction before you go live.

1. Agreement
By creating an account or using the service you agree to these terms. If you are agreeing on behalf of an organisation, you confirm you have authority to bind it.

2. The service
We provide compute infrastructure on which you may deploy supported open-weight AI models. Deployments are provisioned onto machines allocated to your account and reached through an endpoint issued to you.

3. Your account
You are responsible for the accuracy of your account details, for keeping your credentials and API keys confidential, and for all activity carried out under them. Tell us promptly if you believe a key has been compromised.

4. Acceptable use
You may not use the service to break the law, to infringe others' rights, to generate or distribute material that is unlawful, or to attempt to gain unauthorised access to our systems or those of other customers. You may not resell raw access in a way that circumvents metering. We may suspend a deployment that threatens the stability or security of the platform.

5. Model licences
Models available through the catalogue are supplied under their own upstream licences. You are responsible for using each model within the terms of its licence, including any restrictions on commercial use or output.

6. Fees and billing
Compute is billed at the hourly rate fixed to your deployment at the time you create it. Storage for a paused deployment is billed at the reduced rate shown on the pricing page. Charges are drawn from your prepaid balance or settled against your saved payment method according to the billing method set on each deployment. Unpaid amounts remain owed after a deployment ends.

7. Suspension and termination
We may suspend or terminate deployments for non-payment, for breach of these terms, or where required by law. You may terminate a deployment at any time; charges accrued up to that point remain payable.

8. Availability
We work to keep the service available but do not warrant uninterrupted or error-free operation. Planned maintenance will be communicated where practical.

9. Your content
You retain all rights in the data you send to and receive from your deployments. You grant us only the limited rights needed to operate the service on your behalf.

10. Disclaimers and liability
The service is provided "as is" to the fullest extent permitted by law. We are not liable for indirect or consequential loss, or for loss of profit, revenue or data. Our aggregate liability is limited to the amounts you paid in the three months preceding the claim.

11. Changes
We may update these terms. Material changes will be notified in advance and take effect on the date stated.

12. Contact
Questions about these terms can be sent to the contact address listed on our contact page.`,
      },
    ],
  },
];

/* ─── Run ─────────────────────────────────────────────────── */

const NAME = 'seedMarketingSite';

/**
 * Writes go through `marketingPageService` rather than straight to Prisma
 * because a page's `blocks` are a child table — the service owns creating,
 * replacing and ordering those rows, and the "only one homepage" rule.
 *
 * Like the other seeds, a page a human has edited in the Admin Center is left
 * alone unless `--force` is passed. The marker here is `lastEditedById`, not
 * the `updatedById` the other tables use — MarketingPage names it differently,
 * and it is set only by the admin PUT route.
 */
(async () => {
  try {
    await connect();
    console.log('');

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const force = process.argv.includes('--force');

    for (const page of pages) {
      const existing = await prisma.marketingPage.findUnique({
        where: { slug: page.slug },
        select: { id: true, lastEditedById: true },
      });

      const blocks = String(page.blocks.length).padStart(2);

      if (!existing) {
        await marketingPageService.create(page);
        created += 1;
        console.log(`created  /${page.slug.padEnd(14)} ${blocks} blocks`);
      } else if (existing.lastEditedById && !force) {
        skipped += 1;
        console.log(`skipped  /${page.slug.padEnd(14)} edited in the Admin Center (--force to overwrite)`);
      } else {
        await marketingPageService.update(existing.id, page);
        updated += 1;
        console.log(`updated  /${page.slug.padEnd(14)} ${blocks} blocks`);
      }
    }

    /*
     * /features described a product that does not exist here, and its job is now
     * split between /use-cases and /how-it-works. Archived rather than deleted so
     * an admin can still see what was there.
     */
    const features = await prisma.marketingPage.findUnique({ where: { slug: 'features' } });
    if (features && features.status !== 'archived') {
      await prisma.marketingPage.update({
        where: { id: features.id },
        data: { status: 'archived', showInNavigation: false },
      });
      console.log('\narchived /features       (replaced by /use-cases + /how-it-works)');
    }

    /*
     * The blog posts are generic SaaS filler ("Getting Started with React") with
     * hotlinked stock photos and stub bodies. Moved to draft rather than deleted,
     * so nothing is lost if any of it is worth rewriting.
     */
    const drafted = await prisma.blogPost.updateMany({
      where: { status: 'published' },
      data: { status: 'draft' },
    });
    console.log(`drafted  ${drafted.count} filler blog post(s)`);

    await finish(NAME, { created, updated, skipped });
  } catch (err) {
    await fail(NAME, err);
  }
})();
