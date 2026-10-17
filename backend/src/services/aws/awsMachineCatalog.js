/**
 * What AWS actually sells, in the shapes it sells it.
 *
 * ── The one difference from GCP that changes everything above it ──
 *
 * **AWS has no custom machine types.** GCP lets you ask for
 * `e2-custom-16-32768` and get exactly 16 vCPU and 32 GB. AWS sells a fixed
 * menu: `m6i.4xlarge` is 16 vCPU and 64 GB, and if you wanted 32 GB you take
 * `m6i.2xlarge` (8 vCPU / 32 GB) or you take the 64.
 *
 * So the mapper's job here is not "build the shape" but "find the smallest
 * listed shape that is not short of anything", and a customer buying 16 vCPU
 * and 32 GB will be GIVEN 16 vCPU and 64 GB, with the platform paying for the
 * extra. That is the right way round — never give a customer less than they
 * bought — but it means the gap between sold and built is routine on AWS where
 * it is rare on GCP, and the cost model has to be fed what is BUILT.
 *
 * ── GPUs come welded to a shape, same as GCP ──
 *
 * There is no "attach two A100s to this instance". A100s mean `p4d`/`p4de`,
 * H100s mean `p5`, L4 means `g6`, T4 means `g4dn`, V100 means `p3` — and the
 * vCPU and RAM come with them whether they suit the tier or not.
 *
 * The expensive thing to know: **A100 and H100 on AWS come only in eights.**
 * `p4d.24xlarge` is 8×A100 40GB; there is no 1× or 2× variant. A tier selling
 * a single A100 cannot be built on AWS at all, and refusing is the only honest
 * answer — the alternative is billing a customer for one card and paying for
 * eight.
 *
 * Pure: no network, no clock, no SDK.
 */

/**
 * GPU shapes, keyed the same way `gcpMachineCatalog` keys them —
 * `<chip>|<vram per card>` — so the two catalogues answer the same question
 * from the same input.
 *
 * `counts` lists the card counts AWS actually sells. A tier asking for a count
 * that is not in the list is refused rather than rounded up.
 */
const GPU_SHAPES = {
  'a100|40': {
    label: 'NVIDIA A100 40GB',
    // One shape only. 8 cards or nothing.
    shapes: [
      { name: 'p4d.24xlarge', gpuCount: 8, vcpu: 96, ramGb: 1152 },
    ],
  },
  'a100|80': {
    label: 'NVIDIA A100 80GB',
    shapes: [
      { name: 'p4de.24xlarge', gpuCount: 8, vcpu: 96, ramGb: 1152 },
    ],
  },
  'h100|80': {
    label: 'NVIDIA H100 80GB',
    shapes: [
      { name: 'p5.48xlarge', gpuCount: 8, vcpu: 192, ramGb: 2048 },
    ],
  },
  'l4|24': {
    label: 'NVIDIA L4',
    shapes: [
      { name: 'g6.xlarge', gpuCount: 1, vcpu: 4, ramGb: 16 },
      { name: 'g6.2xlarge', gpuCount: 1, vcpu: 8, ramGb: 32 },
      { name: 'g6.4xlarge', gpuCount: 1, vcpu: 16, ramGb: 64 },
      { name: 'g6.8xlarge', gpuCount: 1, vcpu: 32, ramGb: 128 },
      { name: 'g6.12xlarge', gpuCount: 4, vcpu: 48, ramGb: 192 },
      { name: 'g6.48xlarge', gpuCount: 8, vcpu: 192, ramGb: 768 },
    ],
  },
  't4|16': {
    label: 'NVIDIA T4',
    shapes: [
      { name: 'g4dn.xlarge', gpuCount: 1, vcpu: 4, ramGb: 16 },
      { name: 'g4dn.2xlarge', gpuCount: 1, vcpu: 8, ramGb: 32 },
      { name: 'g4dn.4xlarge', gpuCount: 1, vcpu: 16, ramGb: 64 },
      { name: 'g4dn.8xlarge', gpuCount: 1, vcpu: 32, ramGb: 128 },
      { name: 'g4dn.12xlarge', gpuCount: 4, vcpu: 48, ramGb: 192 },
      { name: 'g4dn.metal', gpuCount: 8, vcpu: 96, ramGb: 384 },
    ],
  },
  'v100|16': {
    label: 'NVIDIA V100',
    shapes: [
      { name: 'p3.2xlarge', gpuCount: 1, vcpu: 8, ramGb: 61 },
      { name: 'p3.8xlarge', gpuCount: 4, vcpu: 32, ramGb: 244 },
      { name: 'p3.16xlarge', gpuCount: 8, vcpu: 64, ramGb: 488 },
    ],
  },
};

/**
 * CPU-only shapes, cheapest family first within each size.
 *
 * Three families because they are genuinely different products: `m` is
 * balanced, `c` is compute-heavy with half the RAM per core, `r` is
 * memory-heavy with double. Listing all three and letting the mapper pick the
 * tightest fit is what keeps a 16 vCPU / 256 GB tier from being quoted an `m`
 * shape with 1 TB of RAM nobody asked for.
 *
 * `t3` is listed for the very small end, with its burstable nature recorded
 * honestly — see `BURSTABLE` below.
 */
const CPU_SHAPES = [
  // Burstable. Cheap, and not what you want under sustained inference.
  { name: 't3.micro', vcpu: 2, ramGb: 1, burstable: true, baselineVcpu: 0.2 },
  { name: 't3.small', vcpu: 2, ramGb: 2, burstable: true, baselineVcpu: 0.4 },
  { name: 't3.medium', vcpu: 2, ramGb: 4, burstable: true, baselineVcpu: 0.4 },
  { name: 't3.large', vcpu: 2, ramGb: 8, burstable: true, baselineVcpu: 0.6 },

  // General purpose.
  { name: 'm6i.large', vcpu: 2, ramGb: 8 },
  { name: 'm6i.xlarge', vcpu: 4, ramGb: 16 },
  { name: 'm6i.2xlarge', vcpu: 8, ramGb: 32 },
  { name: 'm6i.4xlarge', vcpu: 16, ramGb: 64 },
  { name: 'm6i.8xlarge', vcpu: 32, ramGb: 128 },
  { name: 'm6i.12xlarge', vcpu: 48, ramGb: 192 },
  { name: 'm6i.16xlarge', vcpu: 64, ramGb: 256 },
  { name: 'm6i.24xlarge', vcpu: 96, ramGb: 384 },
  { name: 'm6i.32xlarge', vcpu: 128, ramGb: 512 },

  // Compute optimised — half the RAM per core.
  { name: 'c6i.large', vcpu: 2, ramGb: 4 },
  { name: 'c6i.xlarge', vcpu: 4, ramGb: 8 },
  { name: 'c6i.2xlarge', vcpu: 8, ramGb: 16 },
  { name: 'c6i.4xlarge', vcpu: 16, ramGb: 32 },
  { name: 'c6i.8xlarge', vcpu: 32, ramGb: 64 },
  { name: 'c6i.12xlarge', vcpu: 48, ramGb: 96 },
  { name: 'c6i.16xlarge', vcpu: 64, ramGb: 128 },
  { name: 'c6i.24xlarge', vcpu: 96, ramGb: 192 },
  { name: 'c6i.32xlarge', vcpu: 128, ramGb: 256 },

  // Memory optimised — double the RAM per core.
  { name: 'r6i.large', vcpu: 2, ramGb: 16 },
  { name: 'r6i.xlarge', vcpu: 4, ramGb: 32 },
  { name: 'r6i.2xlarge', vcpu: 8, ramGb: 64 },
  { name: 'r6i.4xlarge', vcpu: 16, ramGb: 128 },
  { name: 'r6i.8xlarge', vcpu: 32, ramGb: 256 },
  { name: 'r6i.12xlarge', vcpu: 48, ramGb: 384 },
  { name: 'r6i.16xlarge', vcpu: 64, ramGb: 512 },
  { name: 'r6i.24xlarge', vcpu: 96, ramGb: 768 },
  { name: 'r6i.32xlarge', vcpu: 128, ramGb: 1024 },
];

/**
 * EBS volume types, mapped from the platform's own storage names.
 *
 * Ordered so the more specific name is tested first: "NVMe SSD" contains
 * "SSD", so NVMe has to be checked before the plain SSD pattern or every NVMe
 * tier silently becomes a gp3.
 *
 * Everything here is EBS — network-attached and persistent. Instance store
 * (the physical NVMe on the host) would be faster and is the obvious thing to
 * reach for on a GPU box, and it is wrong here for exactly the reason it is
 * wrong on GCP: its contents are destroyed when the instance stops, and this
 * platform charges a storage rate to keep a stopped deployment's disk alive.
 * A customer who paused for a week and came back to an empty disk would have
 * been charged for nothing.
 */
const VOLUME_TYPES = [
  { match: /nvme/i, type: 'io2', label: 'NVMe SSD' },
  { match: /ssd/i, type: 'gp3', label: 'SSD' },
  { match: /hdd|standard|magnetic/i, type: 'st1', label: 'HDD' },
];

const DEFAULT_VOLUME_TYPE = 'gp3';

/**
 * AWS's floor for a root volume, in GB.
 *
 * Smaller is accepted by the API and then fails at boot, because the AMI will
 * not fit — which is a far worse failure than being told no.
 */
const MIN_ROOT_VOLUME_GB = 8;

/** `st1` has a 125 GB minimum, which is bigger than most root volumes want. */
const ST1_MIN_GB = 125;

/** Turn "NVIDIA A100" + 40 into the key `GPU_SHAPES` uses. */
const gpuKey = (model, vramGb) => {
  const chip = String(model || '')
    .toLowerCase()
    .replace(/nvidia|tesla|sxm\d*|pcie|gpu/g, '')
    .replace(/[^a-z0-9]/g, '');
  return `${chip}|${Math.round(Number(vramGb) || 0)}`;
};

const lookupGpu = (model, vramGb) => GPU_SHAPES[gpuKey(model, vramGb)] || null;

/**
 * The smallest listed shape that is not short of anything.
 *
 * "Not short" is the whole rule: a customer who bought 16 vCPU gets at least
 * 16. Where AWS has no exact match they get more, and the platform pays for
 * the difference.
 *
 * @param {object} want  { vcpu, ramGb }
 * @param {object} [opts]
 * @param {boolean} [opts.allowBurstable] include t3. Off by default — a
 *   burstable instance throttles to a fraction of its vCPU once its credits
 *   run out, which under sustained inference means a customer paying for 2
 *   vCPU and getting 0.4.
 */
const smallestCpuShape = (want, opts = {}) => {
  const vcpu = Number(want?.vcpu) || 0;
  const ramGb = Number(want?.ramGb) || 0;
  const allowBurstable = opts.allowBurstable === true;

  const fits = CPU_SHAPES.filter((s) => {
    if (s.burstable && !allowBurstable) return false;
    return s.vcpu >= vcpu && s.ramGb >= ramGb;
  });

  if (!fits.length) return null;

  /*
   * Tightest fit wins, measured as how much is being given away. RAM is
   * divided by 4 so a gigabyte and a core are weighed roughly by what they
   * cost — without it, a 4 GB overshoot would always beat a 1 vCPU one, and
   * the mapper would reach for compute-optimised shapes for everything.
   *
   * Same formula as the GCP mapper's `excessOver`, deliberately: the two
   * clouds should not disagree about what "closest" means.
   */
  const waste = (s) => Math.max(0, s.vcpu - vcpu) + Math.max(0, s.ramGb - ramGb) / 4;

  return fits.slice().sort((a, b) => {
    const d = waste(a) - waste(b);
    if (d !== 0) return d;
    // A genuine tie: prefer the smaller core count, then alphabetical so the
    // answer is stable across runs rather than depending on array order.
    if (a.vcpu !== b.vcpu) return a.vcpu - b.vcpu;
    return a.name < b.name ? -1 : 1;
  })[0];
};

/** The EBS type for a platform storage name, and whether it was recognised. */
const resolveVolumeType = (storageTypeLabel) => {
  const label = String(storageTypeLabel || '');
  const hit = VOLUME_TYPES.find((v) => v.match.test(label));
  return {
    type: hit ? hit.type : DEFAULT_VOLUME_TYPE,
    // False when we fell back, so the mapper can say so rather than implying
    // the customer's choice was honoured.
    matched: !!hit,
  };
};

module.exports = {
  GPU_SHAPES,
  CPU_SHAPES,
  VOLUME_TYPES,
  DEFAULT_VOLUME_TYPE,
  MIN_ROOT_VOLUME_GB,
  ST1_MIN_GB,
  gpuKey,
  lookupGpu,
  smallestCpuShape,
  resolveVolumeType,
};
