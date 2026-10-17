/**
 * Tests for the tier -> AWS instance type decision.
 *
 * Every tier in the live catalogue is asserted by name below, because the thing
 * worth knowing is not that this compiles — it is **which of the products the
 * platform already sells can actually be built on AWS, and which cannot**. That
 * answer is checked in here so it cannot drift quietly when the catalogue or
 * this mapper changes.
 *
 * The rule under test throughout: never silently give a customer less than they
 * bought. Where AWS cannot match exactly the customer gets more; where AWS
 * cannot build it at all, this refuses and says why.
 *
 * Pure: no database, no network, no clock.
 *
 * Run with:  node --test src/services/aws/__tests__/awsSpecMapper.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { planInstance, planVolume, readSpecs } = require('../awsSpecMapper');
const catalog = require('../awsMachineCatalog');

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
  ...over,
});

/* ── Never less than was sold ───────────────────────────────────────────── */

test('a CPU tier gets at least what it asked for', () => {
  const r = planInstance(deployment({ tierVcpu: 16, tierRamGb: 32 }));
  assert.strictEqual(r.ok, true, r.message);
  assert.ok(r.plan.vcpu >= 16, `${r.plan.vcpu} vCPU is short of 16`);
  assert.ok(r.plan.ramGb >= 32, `${r.plan.ramGb} GB is short of 32`);
});

test('the overshoot AWS forces is stated, not buried', () => {
  // 16 vCPU / 32 GB is exactly c6i.4xlarge, so ask for something that is not
  // on the menu and check the gap is reported.
  const r = planInstance(deployment({ tierVcpu: 5, tierRamGb: 9 }));
  assert.strictEqual(r.ok, true, r.message);
  assert.ok(r.plan.vcpu > 5 || r.plan.ramGb > 9);
  assert.ok(r.plan.notes.some((n) => /instead of/.test(n)), r.plan.notes.join(' | '));
});

test('the tightest fit wins, so a memory tier does not get a compute shape', () => {
  // 16 vCPU / 128 GB is r6i.4xlarge exactly. An m6i would need 16xlarge
  // (64 vCPU) to reach 256 GB — far more than asked.
  const r = planInstance(deployment({ tierVcpu: 16, tierRamGb: 128 }));
  assert.strictEqual(r.plan.instanceType, 'r6i.4xlarge', r.plan.instanceType);
});

test('a compute-shaped tier gets a compute shape', () => {
  // 16 vCPU / 32 GB is c6i.4xlarge exactly; m6i.4xlarge would give 64 GB.
  const r = planInstance(deployment({ tierVcpu: 16, tierRamGb: 32 }));
  assert.strictEqual(r.plan.instanceType, 'c6i.4xlarge', r.plan.instanceType);
});

test('burstable shapes are never chosen, however well they fit', () => {
  /*
   * t3 would be the "tightest fit" for a tiny tier and is the wrong answer:
   * once its CPU credits run out it throttles to a fraction of its vCPU, so a
   * customer paying for 2 vCPU gets 0.4 under sustained inference.
   */
  const r = planInstance(deployment({ tierVcpu: 2, tierRamGb: 4 }));
  assert.strictEqual(r.ok, true, r.message);
  assert.ok(!r.plan.instanceType.startsWith('t3.'), r.plan.instanceType);
});

/* ── The live catalogue, tier by tier ────────────────────────────────────── */

test('Micro 1GB builds on AWS', () => {
  const r = planInstance(deployment({
    tierName: 'Micro 1GB', tierVcpu: 1, tierRamGb: 1, tierStorageGb: 20, tierStorageType: 'SSD',
  }));
  assert.strictEqual(r.ok, true, r.message);
  assert.ok(r.plan.vcpu >= 1 && r.plan.ramGb >= 1);
  assert.strictEqual(r.plan.bootDisk.type, 'gp3');
});

test('CPU Compute 16 and Memory Optimized 256GB both build', () => {
  const cpu = planInstance(deployment({ tierName: 'CPU Compute 16', tierVcpu: 16, tierRamGb: 32 }));
  assert.strictEqual(cpu.ok, true, cpu.message);

  const mem = planInstance(deployment({ tierName: 'Memory Optimized', tierVcpu: 16, tierRamGb: 256 }));
  assert.strictEqual(mem.ok, true, mem.message);
  assert.ok(mem.plan.ramGb >= 256);
});

test('a single A100 cannot be built on AWS, and the refusal says why', () => {
  /*
   * The finding that matters most for pricing: AWS sells A100 only as
   * p4d.24xlarge with EIGHT cards. Taking it for a one-card tier would mean
   * charging for one and paying for eight.
   */
  const r = planInstance(deployment({
    tierName: 'A100 40GB', tierVcpu: 12, tierRamGb: 128,
    tierGpuModel: 'NVIDIA A100', tierGpuCount: 1, tierVramGb: 40,
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'GPU_COUNT_NOT_SOLD');
  assert.match(r.message, /paying for 8 cards while charging for 1/);
});

test('a single H100 cannot be built on AWS either', () => {
  const r = planInstance(deployment({
    tierName: 'H100 80GB', tierVcpu: 20, tierRamGb: 256,
    tierGpuModel: 'NVIDIA H100', tierGpuCount: 1, tierVramGb: 80,
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'GPU_COUNT_NOT_SOLD');
});

test('an eight-card H100 tier DOES build — p5.48xlarge', () => {
  const r = planInstance(deployment({
    tierVcpu: 192, tierRamGb: 2048,
    tierGpuModel: 'NVIDIA H100', tierGpuCount: 8, tierVramGb: 80,
  }));
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(r.plan.instanceType, 'p5.48xlarge');
  assert.strictEqual(r.plan.acceleratorCount, 8);
});

test('a single L4 and a single T4 build fine — those are sold in ones', () => {
  const l4 = planInstance(deployment({
    tierVcpu: 4, tierRamGb: 16, tierGpuModel: 'NVIDIA L4', tierGpuCount: 1, tierVramGb: 24,
  }));
  assert.strictEqual(l4.ok, true, l4.message);
  assert.strictEqual(l4.plan.instanceType, 'g6.xlarge');

  const t4 = planInstance(deployment({
    tierVcpu: 4, tierRamGb: 16, tierGpuModel: 'NVIDIA T4', tierGpuCount: 1, tierVramGb: 16,
  }));
  assert.strictEqual(t4.ok, true, t4.message);
  assert.strictEqual(t4.plan.instanceType, 'g4dn.xlarge');
});

test('RTX 4090 is refused — AWS does not sell it, same as GCP', () => {
  const r = planInstance(deployment({
    tierVcpu: 8, tierRamGb: 32, tierGpuModel: 'NVIDIA RTX 4090', tierGpuCount: 1, tierVramGb: 24,
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'GPU_NOT_ON_AWS');
  assert.match(r.message, /A100|H100|L4|T4|V100/);
});

/* ── GPU shapes bring their own CPU ──────────────────────────────────────── */

test('a bigger single-card shape is used when the tier needs more CPU', () => {
  /*
   * g6.xlarge and g6.4xlarge are both ONE L4, at 4 and 16 vCPU. Taking the
   * first shape with the right card count would refuse this tier even though
   * AWS can build it — so the choice has to be the smallest one that is not
   * short, not the first one found.
   */
  const r = planInstance(deployment({
    tierVcpu: 16, tierRamGb: 16, tierGpuModel: 'NVIDIA L4', tierGpuCount: 1, tierVramGb: 24,
  }));
  assert.strictEqual(r.ok, true, r.message);
  assert.strictEqual(r.plan.instanceType, 'g6.4xlarge');
  assert.strictEqual(r.plan.acceleratorCount, 1);
});

test('…but when no shape with that card count is big enough, it refuses', () => {
  // One L4 tops out at g6.8xlarge (32 vCPU). Asking for 64 cannot be honoured.
  const r = planInstance(deployment({
    tierVcpu: 64, tierRamGb: 16, tierGpuModel: 'NVIDIA L4', tierGpuCount: 1, tierVramGb: 24,
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'GPU_SHAPE_TOO_SMALL');
  assert.match(r.message, /tops out at "g6\.8xlarge"/);
});

test('a GPU count AWS does not sell at all is refused with the counts it does', () => {
  const r = planInstance(deployment({
    tierVcpu: 8, tierRamGb: 32, tierGpuModel: 'NVIDIA L4', tierGpuCount: 3, tierVramGb: 24,
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'GPU_COUNT_NOT_SOLD');
  assert.match(r.message, /counts of 1, 1, 1, 1, 4, 8/);
});

test('asking for more cards than any single instance has is refused', () => {
  const r = planInstance(deployment({
    tierVcpu: 8, tierRamGb: 32, tierGpuModel: 'NVIDIA T4', tierGpuCount: 16, tierVramGb: 16,
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'GPU_COUNT_TOO_HIGH');
});

/* ── Volumes ────────────────────────────────────────────────────────────── */

test('storage names map to EBS types, with NVMe tested before plain SSD', () => {
  // "NVMe SSD" contains "SSD" — order matters or every NVMe tier becomes gp3.
  assert.strictEqual(catalog.resolveVolumeType('NVMe SSD').type, 'io2');
  assert.strictEqual(catalog.resolveVolumeType('SSD').type, 'gp3');
  assert.strictEqual(catalog.resolveVolumeType('HDD').type, 'st1');
});

test('an unrecognised storage name falls back and says so', () => {
  const r = planVolume({ storageGb: 50, storageType: 'Optane' });
  assert.strictEqual(r.type, catalog.DEFAULT_VOLUME_TYPE);
  assert.ok(r.notes.some((n) => /not one this mapper recognises/.test(n)));
});

test('a small HDD tier gets gp3 rather than 125 GB of HDD nobody asked for', () => {
  // st1's floor is 125 GB. Rounding a 20 GB tier up to that would be charging
  // the platform for six times the disk; gp3 is better storage, not worse.
  const r = planVolume({ storageGb: 20, storageType: 'HDD' });
  assert.strictEqual(r.type, 'gp3');
  assert.strictEqual(r.sizeGb, 20);
  assert.ok(r.notes.some((n) => /minimum for throughput HDD/.test(n)));
});

test('a large HDD tier keeps st1', () => {
  const r = planVolume({ storageGb: 500, storageType: 'HDD' });
  assert.strictEqual(r.type, 'st1');
  assert.strictEqual(r.sizeGb, 500);
});

test("a volume below AWS's root minimum is raised, and the note explains it", () => {
  const r = planVolume({ storageGb: 4, storageType: 'SSD' });
  assert.strictEqual(r.sizeGb, catalog.MIN_ROOT_VOLUME_GB);
  assert.ok(r.notes.some((n) => /minimum root volume/.test(n)));
});

/* ── Reading the snapshot ────────────────────────────────────────────────── */

test('VRAM is read per card, not as a total', () => {
  // A tier with 4 cards of 80 GB stores 80. Reading 320 would match no card
  // at all, and the tier would be refused for the wrong reason.
  const s = readSpecs(deployment({ tierGpuCount: 4, tierVramGb: 80 }));
  assert.strictEqual(s.vramGb, 80);
});

test('a tier with nothing recorded is refused rather than built as something', () => {
  const r = planInstance(deployment({ tierVcpu: 0, tierRamGb: 0, tierGpuCount: 0 }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'TIER_HAS_NO_SPECS');
});

test('the plan exposes machineType as well as instanceType', () => {
  // capGuard, the cost model and the admin screens were written against the
  // GCP plan's field name; both clouds answer to it.
  const r = planInstance(deployment({ tierVcpu: 4, tierRamGb: 16 }));
  assert.strictEqual(r.plan.machineType, r.plan.instanceType);
});

test('what was sold is carried beside what will be built', () => {
  const r = planInstance(deployment({ tierVcpu: 5, tierRamGb: 9, tierStorageGb: 100 }));
  assert.strictEqual(r.plan.requested.vcpu, 5);
  assert.strictEqual(r.plan.requested.ramGb, 9);
  assert.strictEqual(r.plan.requested.storageGb, 100);
});
