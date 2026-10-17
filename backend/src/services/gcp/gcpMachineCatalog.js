/**
 * What shapes GCP actually sells.
 *
 * The platform's Tiers were designed as a product — "A100 80GB, 16 vCPU, 256 GB
 * RAM" — without reference to any cloud. GCP sells a fixed menu. This file is
 * that menu, written down, so `gcpSpecMapper` can decide whether a tier fits
 * and refuse clearly when it does not.
 *
 * ── This table is a point in time ──
 *
 * Google adds machine families and retires them, and availability differs by
 * zone — `a3-highgpu-8g` exists in the API everywhere and is obtainable in
 * very few places. Nothing here is a promise that a shape can be created
 * today; it is a promise about the *rules*: how many vCPUs a shape has, which
 * GPU it is welded to, what a custom type is allowed to be. The live check
 * against GCP (`validateOnly` in gcpClient) is what proves a shape is really
 * available in a zone, and it is the thing that catches this table going
 * stale.
 *
 * Pure data and pure functions — no SDK, no clock, no database.
 */

/* ── GPUs ────────────────────────────────────────────────────────────────── */

/**
 * The platform stores a GPU as a display string (`tierGpuModel`, e.g.
 * "NVIDIA A100") plus per-card VRAM (`tierVramGb`, 40 or 80). Neither is an
 * enum, so both are normalised before matching. Two different products share
 * the name "A100" and are told apart only by VRAM — which is exactly why the
 * key here is the pair, not the name.
 *
 * `families` lists the machine families this accelerator is available on, in
 * preference order. GPUs on GCP are not free-floating: an A100 exists only as
 * part of an `a2-*` shape and cannot be attached to anything else, while a T4
 * is attached to an otherwise ordinary `n1-*`. That distinction drives the
 * whole mapper, so it is recorded as `attachable`.
 */
const GPUS = {
  'a100|40': {
    acceleratorType: 'nvidia-tesla-a100',
    label: 'NVIDIA A100 40GB',
    attachable: false, // comes only as part of an a2-highgpu shape
    families: ['a2-highgpu'],
  },
  'a100|80': {
    acceleratorType: 'nvidia-a100-80gb',
    label: 'NVIDIA A100 80GB',
    attachable: false,
    families: ['a2-ultragpu'],
  },
  'h100|80': {
    acceleratorType: 'nvidia-h100-80gb',
    label: 'NVIDIA H100 80GB',
    attachable: false,
    families: ['a3-highgpu'],
  },
  'l4|24': {
    acceleratorType: 'nvidia-l4',
    label: 'NVIDIA L4',
    attachable: false, // g2 shapes include it
    families: ['g2-standard'],
  },
  't4|16': {
    acceleratorType: 'nvidia-tesla-t4',
    label: 'NVIDIA T4',
    attachable: true, // bolted onto an n1-* of our choosing
    families: ['n1'],
  },
  'v100|16': {
    acceleratorType: 'nvidia-tesla-v100',
    label: 'NVIDIA V100',
    attachable: true,
    families: ['n1'],
  },
};

/**
 * Turn "NVIDIA A100" + 40 into the key above.
 *
 * Deliberately forgiving about spelling and spacing — "NVIDIA A100",
 * "nvidia-a100", "A100 80GB" all land in the same place — because the value is
 * typed by an admin into a catalogue form, not chosen from a list. It is NOT
 * forgiving about which chip: an unrecognised model returns null and the
 * mapper refuses, because the alternative is provisioning the wrong silicon
 * and billing the customer for what they asked for.
 */
const gpuKey = (model, vramGb) => {
  const m = String(model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const vram = Math.round(Number(vramGb) || 0);

  const chips = [
    ['h100', 'h100'],
    ['a100', 'a100'],
    ['l4', 'l4'],
    ['t4', 't4'],
    ['v100', 'v100'],
  ];
  const found = chips.find(([needle]) => m.includes(needle));
  if (!found) return null;
  return `${found[1]}|${vram}`;
};

const lookupGpu = (model, vramGb) => {
  const key = gpuKey(model, vramGb);
  return key ? (GPUS[key] || null) : null;
};

/* ── GPU machine shapes ──────────────────────────────────────────────────── */

/**
 * The welded shapes, with the vCPU and memory GCP gives you whether you wanted
 * them or not. A tier asking for 1 A100 80GB and 16 vCPU cannot be satisfied:
 * `a2-ultragpu-1g` is 12 vCPU, and the next size up is 2 GPUs. The mapper
 * reports that rather than quietly shipping 12.
 */
const GPU_SHAPES = {
  'a2-highgpu': [
    { name: 'a2-highgpu-1g', vcpu: 12, ramGb: 85, gpuCount: 1 },
    { name: 'a2-highgpu-2g', vcpu: 24, ramGb: 170, gpuCount: 2 },
    { name: 'a2-highgpu-4g', vcpu: 48, ramGb: 340, gpuCount: 4 },
    { name: 'a2-highgpu-8g', vcpu: 96, ramGb: 680, gpuCount: 8 },
  ],
  'a2-ultragpu': [
    { name: 'a2-ultragpu-1g', vcpu: 12, ramGb: 170, gpuCount: 1 },
    { name: 'a2-ultragpu-2g', vcpu: 24, ramGb: 340, gpuCount: 2 },
    { name: 'a2-ultragpu-4g', vcpu: 48, ramGb: 680, gpuCount: 4 },
    { name: 'a2-ultragpu-8g', vcpu: 96, ramGb: 1360, gpuCount: 8 },
  ],
  'a3-highgpu': [
    { name: 'a3-highgpu-1g', vcpu: 26, ramGb: 234, gpuCount: 1 },
    { name: 'a3-highgpu-2g', vcpu: 52, ramGb: 468, gpuCount: 2 },
    { name: 'a3-highgpu-4g', vcpu: 104, ramGb: 936, gpuCount: 4 },
    { name: 'a3-highgpu-8g', vcpu: 208, ramGb: 1872, gpuCount: 8 },
  ],
  'g2-standard': [
    { name: 'g2-standard-4', vcpu: 4, ramGb: 16, gpuCount: 1 },
    { name: 'g2-standard-8', vcpu: 8, ramGb: 32, gpuCount: 1 },
    { name: 'g2-standard-12', vcpu: 12, ramGb: 48, gpuCount: 1 },
    { name: 'g2-standard-16', vcpu: 16, ramGb: 64, gpuCount: 1 },
    { name: 'g2-standard-24', vcpu: 24, ramGb: 96, gpuCount: 2 },
    { name: 'g2-standard-32', vcpu: 32, ramGb: 128, gpuCount: 1 },
    { name: 'g2-standard-48', vcpu: 48, ramGb: 192, gpuCount: 4 },
    { name: 'g2-standard-96', vcpu: 96, ramGb: 384, gpuCount: 8 },
  ],
};

/* ── CPU-only shapes ─────────────────────────────────────────────────────── */

/**
 * Predefined CPU shapes, smallest first.
 *
 * `baselineVcpu` is the honest number for the shared-core e2 types. GCP
 * advertises `e2-micro` as "2 vCPU", but it is entitled to 0.25 of a core
 * sustained and may burst above it when the host is idle. Selling that as a
 * machine with 1 vCPU would be selling something the customer does not reliably
 * get, so the mapper compares against the baseline, not the marketing figure.
 */
const CPU_SHAPES = [
  { name: 'e2-micro', vcpu: 2, baselineVcpu: 0.25, ramGb: 1 },
  { name: 'e2-small', vcpu: 2, baselineVcpu: 0.5, ramGb: 2 },
  { name: 'e2-medium', vcpu: 2, baselineVcpu: 1, ramGb: 4 },
  { name: 'e2-standard-2', vcpu: 2, baselineVcpu: 2, ramGb: 8 },
  { name: 'e2-standard-4', vcpu: 4, baselineVcpu: 4, ramGb: 16 },
  { name: 'e2-standard-8', vcpu: 8, baselineVcpu: 8, ramGb: 32 },
  { name: 'e2-standard-16', vcpu: 16, baselineVcpu: 16, ramGb: 64 },
  { name: 'e2-standard-32', vcpu: 32, baselineVcpu: 32, ramGb: 128 },
  { name: 'e2-highmem-2', vcpu: 2, baselineVcpu: 2, ramGb: 16 },
  { name: 'e2-highmem-4', vcpu: 4, baselineVcpu: 4, ramGb: 32 },
  { name: 'e2-highmem-8', vcpu: 8, baselineVcpu: 8, ramGb: 64 },
  { name: 'e2-highmem-16', vcpu: 16, baselineVcpu: 16, ramGb: 128 },
  { name: 'n2-standard-32', vcpu: 32, baselineVcpu: 32, ramGb: 128 },
  { name: 'n2-standard-48', vcpu: 48, baselineVcpu: 48, ramGb: 192 },
  { name: 'n2-standard-64', vcpu: 64, baselineVcpu: 64, ramGb: 256 },
  { name: 'n2-standard-80', vcpu: 80, baselineVcpu: 80, ramGb: 320 },
  { name: 'n2-highmem-32', vcpu: 32, baselineVcpu: 32, ramGb: 256 },
  { name: 'n2-highmem-64', vcpu: 64, baselineVcpu: 64, ramGb: 512 },
  { name: 'n2-highmem-80', vcpu: 80, baselineVcpu: 80, ramGb: 640 },
];

/**
 * Custom machine types — the escape hatch when no predefined shape fits
 * without overshooting badly.
 *
 * Each family has its own arithmetic and GCP rejects anything outside it, so
 * the constraints are written down rather than discovered from an API error on
 * a customer's deployment.
 */
const CUSTOM_FAMILIES = {
  e2: {
    prefix: 'e2-custom',
    minVcpu: 2,
    maxVcpu: 32,
    vcpuStep: 2, // even only
    minRamPerVcpuGb: 0.5,
    maxRamPerVcpuGb: 8,
    ramStepMb: 256,
  },
  n2: {
    prefix: 'n2-custom',
    minVcpu: 2,
    maxVcpu: 80,
    vcpuStep: 2,
    minRamPerVcpuGb: 0.5,
    maxRamPerVcpuGb: 8,
    ramStepMb: 256,
  },
};

/**
 * Build a custom machine type name, or explain why this shape is not legal.
 *
 * Rounds vCPU up to the next allowed step and memory up to the next 256 MB —
 * always up, never down, because rounding down is handing the customer less
 * than they are paying for.
 */
const buildCustomMachineType = ({ family = 'e2', vcpu, ramGb }) => {
  const spec = CUSTOM_FAMILIES[family];
  if (!spec) return { ok: false, code: 'UNKNOWN_FAMILY', message: `No custom machine family "${family}".` };

  const wantVcpu = Math.max(spec.minVcpu, Math.ceil(Number(vcpu) || 0));
  const roundedVcpu = Math.ceil(wantVcpu / spec.vcpuStep) * spec.vcpuStep;

  if (roundedVcpu > spec.maxVcpu) {
    return {
      ok: false,
      code: 'VCPU_TOO_HIGH',
      message: `${family}-custom allows at most ${spec.maxVcpu} vCPU; ${roundedVcpu} were needed.`,
    };
  }

  const ramMb = Math.ceil((Number(ramGb) || 0) * 1024);
  const roundedRamMb = Math.ceil(ramMb / spec.ramStepMb) * spec.ramStepMb;

  const minRamMb = Math.ceil(roundedVcpu * spec.minRamPerVcpuGb * 1024 / spec.ramStepMb) * spec.ramStepMb;
  const maxRamMb = Math.floor(roundedVcpu * spec.maxRamPerVcpuGb * 1024);

  // Too little memory for the core count is legal to fix: GCP has a floor per
  // vCPU, and giving the customer MORE memory than they asked for is safe.
  const finalRamMb = Math.max(roundedRamMb, minRamMb);

  if (finalRamMb > maxRamMb) {
    return {
      ok: false,
      code: 'RAM_PER_VCPU_TOO_HIGH',
      message: `${family}-custom allows at most ${spec.maxRamPerVcpuGb} GB per vCPU `
        + `(${maxRamMb / 1024} GB at ${roundedVcpu} vCPU); ${(finalRamMb / 1024).toFixed(2)} GB were needed.`,
    };
  }

  return {
    ok: true,
    machineType: `${spec.prefix}-${roundedVcpu}-${finalRamMb}`,
    vcpu: roundedVcpu,
    ramGb: finalRamMb / 1024,
  };
};

/* ── Disks ───────────────────────────────────────────────────────────────── */

/**
 * The platform's storage names are display strings taken from a component's
 * `name` field ("NVMe SSD", "SSD", "HDD") — not the `specs.mediaType` enum,
 * which `tierPricing.rollupComponents` does not read. So this match is on
 * prose, and it is deliberately ordered: "NVMe SSD" contains "SSD", so NVMe has
 * to be tested first or every NVMe tier silently becomes a balanced disk.
 *
 * Everything here is a PERSISTENT disk. Local SSD would be faster and is the
 * obvious thing to reach for on a GPU box — and it is wrong here, because its
 * contents are destroyed when the instance stops. This platform charges a
 * storage rate to keep a stopped deployment's disk alive, so the disk has to
 * actually survive. A customer who paused for a week and came back to an empty
 * disk would have been charged for nothing.
 */
const DISK_TYPES = [
  { match: /nvme/i, type: 'pd-ssd', label: 'NVMe SSD' },
  { match: /ssd/i, type: 'pd-balanced', label: 'SSD' },
  { match: /hdd|standard/i, type: 'pd-standard', label: 'HDD' },
];

const DEFAULT_DISK_TYPE = 'pd-balanced';

/** GCP's floor. A 20 GB tier is fine; a 5 GB one would be rejected by the API. */
const MIN_BOOT_DISK_GB = 10;

const resolveDiskType = (storageTypeLabel) => {
  const label = String(storageTypeLabel || '');
  const hit = DISK_TYPES.find((d) => d.match.test(label));
  return {
    type: hit ? hit.type : DEFAULT_DISK_TYPE,
    // False when we fell back, so the mapper can say so rather than implying
    // the customer's choice was honoured.
    matched: !!hit,
  };
};

module.exports = {
  GPUS,
  GPU_SHAPES,
  CPU_SHAPES,
  CUSTOM_FAMILIES,
  DISK_TYPES,
  DEFAULT_DISK_TYPE,
  MIN_BOOT_DISK_GB,
  gpuKey,
  lookupGpu,
  buildCustomMachineType,
  resolveDiskType,
};
