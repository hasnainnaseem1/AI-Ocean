/**
 * Seed the tier categories and the priced resource components tiers are built
 * from.
 *
 * Run this BEFORE seedCatalog.js — the tiers it seeds reference these
 * components by name.
 *
 * Idempotent: entries are matched by slug and updated rather than duplicated.
 * Anything an admin has edited in the Admin Center is left alone unless you
 * pass --force, because `updatedBy` is only ever set by the admin routes and so
 * marks exactly the documents a human has touched.
 *
 * Run with:  node src/scripts/seed/seedResourceComponents.js
 */
require('dotenv').config();
const { connect, prisma, finish, fail, isForced } = require('./seedHelpers');
const catalogService = require('../../services/catalog/catalogService');

const slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const FORCE = process.argv.includes('--force');

/* ── The shelves machines sit on ── */
const CATEGORIES = [
  {
    name: 'GPU Optimized',
    description: 'Accelerated machines for running and fine-tuning models.',
    color: '#722ed1',
    displayOrder: 1,
  },
  {
    name: 'CPU Optimized',
    description: 'High core counts with no accelerator — good for small models, embeddings and pre/post-processing.',
    color: '#1677ff',
    displayOrder: 2,
  },
  {
    name: 'Memory Optimized',
    description: 'Large RAM relative to cores, for big context windows and in-memory datasets.',
    color: '#13c2c2',
    displayOrder: 3,
  },
  {
    name: 'General Purpose',
    description: 'Balanced machines with no particular bias.',
    color: '#52c41a',
    displayOrder: 4,
  },
];

/* ── The priced parts ──
 *
 * Prices below are illustrative starting points. They are meant to be edited
 * from Admin Center → Resource Pricing, which is the whole point of them being
 * data rather than constants in a file.
 *
 * Storage is the one that matters for stopped deployments: `billedWhileStopped`
 * is what keeps a customer's disk charging after they pause.
 */
const COMPONENTS = [
  // ── Storage: billed whether the machine runs or not ──
  {
    name: 'NVMe SSD',
    kind: 'storage',
    unitLabel: 'GB',
    description: 'Fast local NVMe. Charged per GB for as long as the customer holds the deployment, running or not.',
    pricePerUnit: 0.09,
    pricingPeriod: 'month',
    billedWhileStopped: true,
    minQuantity: 20,
    stepQuantity: 10,
    specs: { mediaType: 'nvme' },
    displayOrder: 1,
  },
  {
    name: 'SSD',
    kind: 'storage',
    unitLabel: 'GB',
    description: 'General-purpose SSD. Cheaper than NVMe, still charged while stopped.',
    pricePerUnit: 0.05,
    pricingPeriod: 'month',
    billedWhileStopped: true,
    minQuantity: 20,
    stepQuantity: 10,
    specs: { mediaType: 'ssd' },
    displayOrder: 2,
  },
  {
    name: 'HDD',
    kind: 'storage',
    unitLabel: 'GB',
    description: 'Spinning disk for bulk data and archives.',
    pricePerUnit: 0.02,
    pricingPeriod: 'month',
    billedWhileStopped: true,
    minQuantity: 100,
    stepQuantity: 50,
    specs: { mediaType: 'hdd' },
    displayOrder: 3,
  },

  // ── Compute: released to the pool when the deployment stops ──
  {
    name: 'Standard vCPU',
    kind: 'cpu',
    unitLabel: 'vCPU',
    description: 'General-purpose compute core.',
    pricePerUnit: 0.01,
    pricingPeriod: 'hour',
    billedWhileStopped: false,
    minQuantity: 1,
    stepQuantity: 1,
    displayOrder: 1,
  },
  {
    name: 'High-Frequency vCPU',
    kind: 'cpu',
    unitLabel: 'vCPU',
    description: 'Higher clock speed, for latency-sensitive single-threaded work.',
    pricePerUnit: 0.018,
    pricingPeriod: 'hour',
    billedWhileStopped: false,
    minQuantity: 1,
    stepQuantity: 1,
    displayOrder: 2,
  },
  {
    name: 'DDR5 RAM',
    kind: 'memory',
    unitLabel: 'GB',
    description: 'System memory.',
    pricePerUnit: 0.002,
    pricingPeriod: 'hour',
    billedWhileStopped: false,
    minQuantity: 1,
    stepQuantity: 1,
    displayOrder: 1,
  },

  // ── Accelerators ──
  {
    name: 'NVIDIA RTX 4090 24GB',
    kind: 'gpu',
    unitLabel: 'GPU',
    description: 'Entry-level inference accelerator.',
    pricePerUnit: 0.42,
    pricingPeriod: 'hour',
    billedWhileStopped: false,
    minQuantity: 1,
    stepQuantity: 1,
    specs: { model: 'NVIDIA RTX 4090', vramGb: 24 },
    displayOrder: 1,
  },
  {
    name: 'NVIDIA A100 40GB',
    kind: 'gpu',
    unitLabel: 'GPU',
    description: 'Balanced production accelerator.',
    pricePerUnit: 0.95,
    pricingPeriod: 'hour',
    billedWhileStopped: false,
    minQuantity: 1,
    stepQuantity: 1,
    specs: { model: 'NVIDIA A100', vramGb: 40 },
    displayOrder: 2,
  },
  {
    name: 'NVIDIA A100 80GB',
    kind: 'gpu',
    unitLabel: 'GPU',
    description: 'Large-memory accelerator for 70B-class models.',
    pricePerUnit: 1.45,
    pricingPeriod: 'hour',
    billedWhileStopped: false,
    minQuantity: 1,
    stepQuantity: 1,
    specs: { model: 'NVIDIA A100', vramGb: 80 },
    displayOrder: 3,
  },
  {
    name: 'NVIDIA H100 80GB',
    kind: 'gpu',
    unitLabel: 'GPU',
    description: 'Highest single-card throughput.',
    pricePerUnit: 2.89,
    pricingPeriod: 'hour',
    billedWhileStopped: false,
    minQuantity: 1,
    stepQuantity: 1,
    specs: { model: 'NVIDIA H100', vramGb: 80 },
    displayOrder: 4,
  },

  // ── Network ──
  {
    name: 'Network Bandwidth',
    kind: 'network',
    unitLabel: 'Gbps',
    description: 'Guaranteed egress bandwidth for the machine.',
    pricePerUnit: 0.002,
    pricingPeriod: 'hour',
    billedWhileStopped: false,
    minQuantity: 0,
    stepQuantity: 1,
    displayOrder: 1,
  },
];

/**
 * Both categories and components are written through catalogService rather
 * than straight to Prisma: it is what slugifies the name, mints the
 * id, and — for a component — derives `pricePerUnitPerHour` from
 * the price and its pricing period. Writing the rows directly would leave that
 * derived column at 0 and silently price every tier at nothing.
 */
const upsert = async (model, data, label, svc) => {
  const slug = slugify(data.name);
  const existing = await prisma[model].findFirst({ where: { OR: [{ slug }, { name: data.name }] } });

  if (existing) {
    if (existing.updatedById && !isForced()) {
      console.log(`  skipped ${label} ${existing.name} — edited in Admin Center (re-run with --force)`);
      return existing;
    }
    const updated = await svc.update(existing, data);
    console.log(`  updated ${label} ${updated.name}`);
    return updated;
  }

  const created = await svc.create(data);
  console.log(`  created ${label} ${created.name}`);
  return created;
};

const CATEGORY_SVC = {
  create: (data) => catalogService.createTierCategory(data),
  update: (existing, data) => catalogService.updateTierCategory(existing, data),
};

const COMPONENT_SVC = {
  create: (data) => catalogService.createResourceComponent(data),
  update: (existing, data) => catalogService.updateResourceComponent(existing, data),
};

const seed = async () => {
  await connect();

  console.log('\nTier categories:');
  for (const data of CATEGORIES) await upsert('tierCategory', data, 'category ', CATEGORY_SVC);

  console.log('\nResource components:');
  for (const data of COMPONENTS) {
    const component = await upsert('resourceComponent', data, 'component', COMPONENT_SVC);
    if (component) {
      console.log(
        `            ${component.currency} ${component.pricePerUnitPerHour}/${component.unitLabel}/hr`
        + `${component.billedWhileStopped ? '  (billed while stopped)' : ''}`
      );
    }
  }

  console.log(
    `\nSeeded ${CATEGORIES.length} categories and ${COMPONENTS.length} resource components.`
  );
  console.log('Next: npm run seed:catalog');
  await finish();
};

seed().catch((err) => fail('Resource component seed', err));
