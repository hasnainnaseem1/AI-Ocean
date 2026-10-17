/**
 * Tests for the spec -> GCP shape decision.
 *
 * Every tier currently in the live catalogue is asserted by name below, because
 * the thing worth knowing about this mapper is not that it compiles — it is
 * which of the products the platform already sells can actually be built on
 * GCP, and which cannot. That answer is checked in here so it cannot drift
 * quietly when the catalogue or this table changes.
 *
 * Pure throughout: no database, no network, no clock.
 *
 * Run with:  node --test src/services/gcp/__tests__/gcpSpecMapper.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  planInstance, readSpecs, planDisk, excessOver,
} = require('../gcpSpecMapper');
const catalog = require('../gcpMachineCatalog');

/** A deployment row carrying just the tier snapshot the mapper reads. */
const deployment = (over = {}) => ({
  tierName: 'test tier',
  tierVcpu: 1,
  tierRamGb: 1,
  tierGpuModel: '',
  tierGpuCount: 0,
  tierVramGb: 0,
  tierStorageGb: 20,
  tierStorageType: 'SSD',
  tierIsCustom: false,
  ...over,
});

/* ── The demo tier: the one that has to work first ───────────────────────── */

test('Micro 1GB maps to a real shape that is not short on anything', () => {
  const r = planInstance(deployment({
    tierName: 'Micro 1GB', tierVcpu: 1, tierRamGb: 1, tierStorageGb: 20, tierStorageType: 'SSD',
  }));

  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(r.plan.machineType, 'e2-medium');
  assert.ok(r.plan.vcpu >= 1, 'at least the 1 vCPU that was sold');
  assert.ok(r.plan.ramGb >= 1, 'at least the 1 GB that was sold');
  assert.deepStrictEqual(r.plan.bootDisk, { sizeGb: 20, type: 'pd-balanced' });
  assert.strictEqual(r.plan.accelerator, null);
});

test('a 1-vCPU tier never lands on e2-micro or e2-small', () => {
  // Both advertise "2 vCPU" and are entitled to 0.25 and 0.5 of a core
  // sustained. Selling either as a 1-vCPU machine would be selling something
  // the customer does not reliably get.
  const r = planInstance(deployment({ tierVcpu: 1, tierRamGb: 1 }));
  assert.ok(!['e2-micro', 'e2-small'].includes(r.plan.machineType), r.plan.machineType);
});

/* ── The rule: never less than was sold ──────────────────────────────────── */

test('whatever shape is chosen, it meets or exceeds every figure sold', () => {
  const cases = [
    { tierVcpu: 1, tierRamGb: 1 },
    { tierVcpu: 2, tierRamGb: 8 },
    { tierVcpu: 4, tierRamGb: 16 },
    { tierVcpu: 16, tierRamGb: 32 },
    { tierVcpu: 16, tierRamGb: 256 },
    { tierVcpu: 8, tierRamGb: 3 },
    { tierVcpu: 20, tierRamGb: 40 },
  ];

  for (const c of cases) {
    const r = planInstance(deployment(c));
    assert.strictEqual(r.ok, true, `${c.tierVcpu}/${c.tierRamGb}: ${r.message}`);
    assert.ok(r.plan.vcpu >= c.tierVcpu, `${c.tierVcpu} vCPU asked, ${r.plan.vcpu} planned`);
    assert.ok(r.plan.ramGb >= c.tierRamGb, `${c.tierRamGb} GB asked, ${r.plan.ramGb} planned`);
  }
});

test('the tighter of a standard and a custom shape wins', () => {
  // 16 vCPU / 32 GB fits e2-standard-16 (16 vCPU, 64 GB) exactly on CPU and
  // doubles the memory. A custom type matches both figures, so it should win.
  const r = planInstance(deployment({ tierVcpu: 16, tierRamGb: 32 }));
  assert.strictEqual(r.ok, true);
  assert.match(r.plan.machineType, /custom/, `expected a custom type, got ${r.plan.machineType}`);
  assert.strictEqual(r.plan.vcpu, 16);
  assert.strictEqual(r.plan.ramGb, 32);
});

test('a standard shape wins when it is the tighter fit', () => {
  // 1 vCPU / 1 GB: the smallest legal custom type is 2 vCPU, so e2-medium
  // (1 vCPU, 4 GB) wastes less than e2-custom-2-1024.
  const r = planInstance(deployment({ tierVcpu: 1, tierRamGb: 1 }));
  assert.strictEqual(r.plan.machineType, 'e2-medium');
});

test('excess is counted in vCPU-equivalents, 4 GB to a core', () => {
  const want = { vcpu: 4, ramGb: 16 };
  assert.strictEqual(excessOver(want, { vcpu: 4, ramGb: 16 }), 0);
  assert.strictEqual(excessOver(want, { vcpu: 8, ramGb: 16 }), 4);
  assert.strictEqual(excessOver(want, { vcpu: 4, ramGb: 32 }), 4);
  assert.strictEqual(excessOver(want, { vcpu: 2, ramGb: 8 }), 0, 'a shortfall is not negative excess');
});

/* ── GPUs: what GCP does and does not sell ───────────────────────────────── */

test('an RTX 4090 tier is refused — Google Cloud does not rent them', () => {
  const r = planInstance(deployment({
    tierName: 'RTX 4090 24GB',
    tierVcpu: 8, tierRamGb: 64, tierGpuModel: 'NVIDIA RTX 4090', tierGpuCount: 1, tierVramGb: 24,
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'GPU_NOT_AVAILABLE_ON_GCP');
  assert.match(r.message, /A100|H100|L4/, 'the refusal should name what GCP does sell');
});

test('A100 40 and A100 80 are told apart by VRAM, not by name', () => {
  const forty = catalog.lookupGpu('NVIDIA A100', 40);
  const eighty = catalog.lookupGpu('NVIDIA A100', 80);
  assert.strictEqual(forty.acceleratorType, 'nvidia-tesla-a100');
  assert.strictEqual(eighty.acceleratorType, 'nvidia-a100-80gb');
  assert.notStrictEqual(forty.families[0], eighty.families[0]);
});

test('GPU model matching survives the spellings an admin might type', () => {
  for (const name of ['NVIDIA H100', 'nvidia-h100', 'H100 80GB', 'Nvidia  H100  SXM']) {
    assert.ok(catalog.lookupGpu(name, 80), `"${name}" should resolve`);
  }
  assert.strictEqual(catalog.lookupGpu('Some New Chip', 80), null, 'an unknown chip resolves to nothing');
});

test('a GPU count GCP does not sell is refused rather than rounded', () => {
  const r = planInstance(deployment({
    tierVcpu: 12, tierRamGb: 85, tierGpuModel: 'NVIDIA A100', tierGpuCount: 3, tierVramGb: 40,
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'GPU_COUNT_NOT_AVAILABLE');
});

test('a GPU tier that fits is planned with the GPU welded to the shape', () => {
  // 12 vCPU / 85 GB / 1x A100 40GB is exactly a2-highgpu-1g.
  const r = planInstance(deployment({
    tierVcpu: 12, tierRamGb: 85, tierGpuModel: 'NVIDIA A100', tierGpuCount: 1, tierVramGb: 40,
  }));
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(r.plan.machineType, 'a2-highgpu-1g');
  assert.strictEqual(r.plan.acceleratorCount, 1);
  assert.strictEqual(
    r.plan.accelerator, null,
    'an a2 shape includes its GPUs; sending guestAccelerators as well is rejected by GCP',
  );
});

test('a T4 is attached to an instance rather than being part of it', () => {
  const t4 = catalog.lookupGpu('NVIDIA T4', 16);
  assert.strictEqual(t4.attachable, true);
  assert.strictEqual(t4.families[0], 'n1');
});

/* ── Every GPU tier in the live catalogue, as it stands today ────────────── */

test('the catalogue GPU tiers cannot be built on GCP as currently specified', () => {
  // Not a bug in the mapper — these tiers were specified before GCP was
  // chosen, and GCP welds CPU and memory to its GPU shapes. Each one asks for
  // slightly more memory than the shape carrying that many cards provides.
  // The refusal names the shortfall so the tier can be corrected.
  const live = [
    { name: 'A100 40GB', vcpu: 12, ram: 128, gpu: 'NVIDIA A100', vram: 40, count: 1 },
    { name: 'A100 80GB', vcpu: 16, ram: 256, gpu: 'NVIDIA A100', vram: 80, count: 1 },
    { name: 'H100 80GB', vcpu: 20, ram: 256, gpu: 'NVIDIA H100', vram: 80, count: 1 },
    { name: 'H100 80GB x2', vcpu: 40, ram: 512, gpu: 'NVIDIA H100', vram: 80, count: 2 },
    { name: 'H100 80GB x4', vcpu: 80, ram: 1024, gpu: 'NVIDIA H100', vram: 80, count: 4 },
  ];

  for (const t of live) {
    const r = planInstance(deployment({
      tierName: t.name,
      tierVcpu: t.vcpu, tierRamGb: t.ram,
      tierGpuModel: t.gpu, tierGpuCount: t.count, tierVramGb: t.vram,
    }));
    assert.strictEqual(r.ok, false, `${t.name} unexpectedly planned as ${r.ok ? r.plan.machineType : ''}`);
    assert.strictEqual(r.code, 'SPEC_NOT_SATISFIABLE', t.name);
    assert.match(r.message, /GB RAM|vCPU/, `${t.name}: the refusal must name the shortfall`);
  }
});

test('the catalogue CPU tiers do build', () => {
  const live = [
    { name: 'Micro 1GB', vcpu: 1, ram: 1 },
    { name: 'CPU Compute 16', vcpu: 16, ram: 32 },
    { name: 'Memory Optimized 256GB', vcpu: 16, ram: 256 },
  ];

  for (const t of live) {
    const r = planInstance(deployment({ tierName: t.name, tierVcpu: t.vcpu, tierRamGb: t.ram }));
    assert.strictEqual(r.ok, true, `${t.name}: ${r.message}`);
    assert.ok(r.plan.vcpu >= t.vcpu && r.plan.ramGb >= t.ram, t.name);
  }
});

/* ── Disks ───────────────────────────────────────────────────────────────── */

test('storage display names map to persistent disk types, NVMe before SSD', () => {
  // "NVMe SSD" contains "SSD", so order matters — tested rather than trusted.
  assert.strictEqual(planDisk({ storageGb: 100, storageType: 'NVMe SSD' }).type, 'pd-ssd');
  assert.strictEqual(planDisk({ storageGb: 100, storageType: 'SSD' }).type, 'pd-balanced');
  assert.strictEqual(planDisk({ storageGb: 100, storageType: 'HDD' }).type, 'pd-standard');
});

test('an unrecognised storage name falls back and says so', () => {
  const d = planDisk({ storageGb: 100, storageType: 'Optane XL' });
  assert.strictEqual(d.type, catalog.DEFAULT_DISK_TYPE);
  assert.ok(d.notes.some((n) => /not one this mapper recognises/.test(n)));
});

test('a disk smaller than GCP allows is raised, never lowered', () => {
  const d = planDisk({ storageGb: 5, storageType: 'SSD' });
  assert.strictEqual(d.sizeGb, catalog.MIN_BOOT_DISK_GB);
  assert.ok(d.notes.some((n) => /minimum boot disk/.test(n)));
});

/* ── Custom machine type arithmetic ──────────────────────────────────────── */

test('custom types round vCPU and memory UP to what GCP allows', () => {
  const r = catalog.buildCustomMachineType({ family: 'e2', vcpu: 3, ramGb: 5.1 });
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(r.vcpu, 4, 'custom vCPU counts are even');
  assert.ok(r.ramGb >= 5.1, 'memory is rounded up to the next 256 MB, never down');
  assert.match(r.machineType, /^e2-custom-4-\d+$/);
});

test('custom types respect the memory floor per vCPU', () => {
  // 8 vCPU with 1 GB is below e2's 0.5 GB-per-vCPU floor; GCP would reject it.
  const r = catalog.buildCustomMachineType({ family: 'e2', vcpu: 8, ramGb: 1 });
  assert.strictEqual(r.ok, true, r.message);
  assert.ok(r.ramGb >= 4, `expected the floor to lift memory to 4 GB, got ${r.ramGb}`);
});

test('custom types refuse what GCP would refuse', () => {
  const tooMuchRam = catalog.buildCustomMachineType({ family: 'e2', vcpu: 2, ramGb: 64 });
  assert.strictEqual(tooMuchRam.ok, false);
  assert.strictEqual(tooMuchRam.code, 'RAM_PER_VCPU_TOO_HIGH');

  const tooManyCores = catalog.buildCustomMachineType({ family: 'n2', vcpu: 200, ramGb: 400 });
  assert.strictEqual(tooManyCores.ok, false);
  assert.strictEqual(tooManyCores.code, 'VCPU_TOO_HIGH');
});

/* ── Reading the snapshot ────────────────────────────────────────────────── */

test('VRAM is read as per-card, not as a total', () => {
  const specs = readSpecs(deployment({ tierGpuCount: 4, tierVramGb: 80 }));
  assert.strictEqual(specs.vramPerGpuGb, 80, '4x80GB stores 80, not 320');
});

test('network bandwidth is read from a custom build when there is no column', () => {
  const specs = readSpecs(deployment({ tierIsCustom: true, tierCustomBuild: { networkGbps: 25 } }));
  assert.strictEqual(specs.networkGbps, 25);
});

test('a tier with no CPU or memory recorded is refused, not guessed at', () => {
  const r = planInstance(deployment({ tierVcpu: 0, tierRamGb: 0 }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'SPECS_MISSING');
});

test('Prisma Decimal objects are read as numbers', () => {
  const decimal = (n) => ({ toNumber: () => n });
  const specs = readSpecs(deployment({ tierVcpu: decimal(8), tierRamGb: decimal(32) }));
  assert.strictEqual(specs.vcpu, 8);
  assert.strictEqual(specs.ramGb, 32);
});

test('the plan carries what was sold beside what will be built', () => {
  const r = planInstance(deployment({ tierVcpu: 1, tierRamGb: 1, tierStorageGb: 20 }));
  assert.deepStrictEqual(r.plan.requested.vcpu, 1);
  assert.deepStrictEqual(r.plan.requested.ramGb, 1);
  assert.ok(Array.isArray(r.plan.notes));
});
