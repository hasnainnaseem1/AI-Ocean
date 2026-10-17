/**
 * A deployment's specs -> the GCP instance that satisfies them.
 *
 * ── The one rule everything here serves ──
 *
 * **The customer never silently gets less than they are paying for.**
 *
 * A deployment carries a frozen snapshot of what was sold: so many vCPU, so
 * much RAM, this GPU, this much disk. GCP sells a fixed menu that was designed
 * without reference to that snapshot. When the two line up, this module picks
 * the smallest shape that meets or exceeds every figure. When they do not, it
 * **refuses** and says exactly which figure could not be met.
 *
 * Refusing is the uncomfortable choice and it is the right one. The
 * alternatives are both worse: round the customer down and they are paying for
 * capacity that does not exist, or round them up to the next GPU shape and the
 * platform pays for silicon it never sold. A refusal surfaces in the admin
 * queue as a deployment that needs a human, which is a problem someone can
 * actually fix — by correcting the tier.
 *
 * Pure: no SDK, no database, no clock. Everything below is asserted directly in
 * `__tests__/gcpSpecMapper.test.js`, which is the only way to have confidence
 * in a table of cloud shapes without spending money to find out.
 */

const catalog = require('./gcpMachineCatalog');

/** Prisma hands numbers back as Decimal objects; everything here wants numbers. */
const num = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const refuse = (code, message, detail = {}) => ({ ok: false, code, message, detail });

/**
 * Pull the machine specs off a deployment row.
 *
 * Two things are worth knowing about this snapshot:
 *
 *  - `tierVramGb` is **per accelerator**, not the total. A tier with 4 cards of
 *    80 GB stores 80, and total VRAM is only ever derived. Reading it as a
 *    total would match the wrong GPU entirely.
 *  - `networkGbps` is NOT a column on Deployment for catalogue tiers — it only
 *    survives inside `tierCustomBuild` for custom builds. Phase 4 adds
 *    `tierNetworkGbps`; until then this falls back to the custom-build JSON and
 *    then to 0, and 0 means "unstated", never "none".
 */
const readSpecs = (deployment) => {
  const d = deployment || {};
  const custom = d.tierCustomBuild || d.tier?.customBuild || null;

  return {
    vcpu: num(d.tierVcpu ?? d.tier?.vcpu),
    ramGb: num(d.tierRamGb ?? d.tier?.ramGb),
    gpuModel: d.tierGpuModel ?? d.tier?.gpuModel ?? '',
    gpuCount: Math.round(num(d.tierGpuCount ?? d.tier?.gpuCount)),
    vramPerGpuGb: num(d.tierVramGb ?? d.tier?.vramGb),
    storageGb: num(d.tierStorageGb ?? d.tier?.storageGb),
    storageType: d.tierStorageType ?? d.tier?.storageType ?? '',
    networkGbps: num(d.tierNetworkGbps ?? custom?.networkGbps),
    isCustom: !!(d.tierIsCustom ?? d.tier?.isCustom),
    tierName: d.tierName ?? d.tier?.name ?? 'machine',
  };
};

/**
 * Choose a GPU shape.
 *
 * GPU count is matched **exactly**, never rounded. Rounding down under-delivers;
 * rounding up means the platform buys an 8-GPU box to fill a 1-GPU order, which
 * on an H100 shape is thousands of dollars a month out of our own pocket. If no
 * shape in the family carries exactly this many cards, that is a tier that
 * cannot be sold on GCP and someone should know.
 */
const planGpuMachine = (specs) => {
  const gpu = catalog.lookupGpu(specs.gpuModel, specs.vramPerGpuGb);

  if (!gpu) {
    return refuse(
      'GPU_NOT_AVAILABLE_ON_GCP',
      `"${specs.gpuModel || 'unnamed GPU'}" with ${specs.vramPerGpuGb} GB per card is not a GPU Google Cloud offers. `
      + 'Change the tier to a GPU GCP sells (A100 40/80 GB, H100 80 GB, L4, T4, V100), or do not provision this tier on GCP.',
      { gpuModel: specs.gpuModel, vramPerGpuGb: specs.vramPerGpuGb },
    );
  }

  const family = gpu.families[0];
  const shapes = catalog.GPU_SHAPES[family] || [];
  const exact = shapes.filter((s) => s.gpuCount === specs.gpuCount);

  if (!exact.length) {
    const offered = [...new Set(shapes.map((s) => s.gpuCount))].join(', ');
    return refuse(
      'GPU_COUNT_NOT_AVAILABLE',
      `${gpu.label} is sold by GCP in counts of ${offered}; this tier asks for ${specs.gpuCount}. `
      + 'Adjust the tier to one of those counts.',
      { wanted: specs.gpuCount, available: offered, family },
    );
  }

  // Among the shapes with the right card count, the smallest that also meets
  // the CPU and memory the tier promised.
  const fits = exact
    .filter((s) => s.vcpu >= specs.vcpu && s.ramGb >= specs.ramGb)
    .sort((a, b) => a.vcpu - b.vcpu || a.ramGb - b.ramGb);

  if (!fits.length) {
    const best = exact[0];
    const short = [];
    if (best.vcpu < specs.vcpu) short.push(`${specs.vcpu} vCPU (shape gives ${best.vcpu})`);
    if (best.ramGb < specs.ramGb) short.push(`${specs.ramGb} GB RAM (shape gives ${best.ramGb})`);
    return refuse(
      'SPEC_NOT_SATISFIABLE',
      `${gpu.label} x${specs.gpuCount} on GCP is "${best.name}", which cannot meet ${short.join(' and ')}. `
      + 'GCP welds CPU and memory to the GPU shape, so this tier has to be re-specified to match '
      + `"${best.name}" (${best.vcpu} vCPU, ${best.ramGb} GB) or a larger card count.`,
      { shape: best.name, shortfall: short },
    );
  }

  const shape = fits[0];
  const notes = [];
  if (shape.vcpu > specs.vcpu) {
    notes.push(`${shape.vcpu} vCPU instead of ${specs.vcpu} — GCP ties the CPU count to the GPU shape.`);
  }
  if (shape.ramGb > specs.ramGb) {
    notes.push(`${shape.ramGb} GB RAM instead of ${specs.ramGb} — same reason.`);
  }

  return {
    ok: true,
    machineType: shape.name,
    vcpu: shape.vcpu,
    ramGb: shape.ramGb,
    // The accelerator is part of the shape; GCP rejects `guestAccelerators` on
    // an a2/a3/g2 instance. `attachable` records which world we are in so the
    // client builds the right request body.
    accelerator: gpu.attachable
      ? { type: gpu.acceleratorType, count: specs.gpuCount }
      : null,
    acceleratorLabel: gpu.label,
    acceleratorCount: shape.gpuCount,
    notes,
  };
};

/**
 * How much of a shape would be bought and not sold.
 *
 * Both a predefined shape and a custom one can satisfy the same tier, and the
 * difference is what the platform pays for capacity the customer did not buy.
 * Measured in "vCPU-equivalents", with 4 GB of RAM counted as roughly one vCPU
 * — that is the ratio of GCP's own standard shapes, so it is a reasonable
 * stand-in for cost without this module pretending to hold a price list it
 * cannot keep current.
 *
 * Lower is better. Exported so a test can assert the comparison directly.
 */
const excessOver = (want, got) =>
  Math.max(0, got.vcpu - want.vcpu) + Math.max(0, got.ramGb - want.ramGb) / 4;

/**
 * Choose a CPU-only shape.
 *
 * Both routes are costed and the tighter fit wins.
 *
 * Neither "predefined first" nor "custom first" is right on its own. GCP
 * charges a premium per unit for custom types, so a predefined shape that fits
 * closely is cheaper — but predefined shapes come in big steps, and a tier
 * wanting 20 vCPU lands on a 32-vCPU shape, buying 60% more machine than it
 * sold. On a no-review flow that is a loss taken automatically, every time.
 *
 * `baselineVcpu` is what the comparison uses, so a 1-vCPU tier never lands on
 * `e2-micro` (0.25 of a core sustained) just because GCP's marketing calls it
 * a 2-vCPU machine.
 */
const planCpuMachine = (specs) => {
  const want = { vcpu: specs.vcpu, ramGb: specs.ramGb };

  const predefined = catalog.CPU_SHAPES
    .filter((s) => s.baselineVcpu >= specs.vcpu && s.ramGb >= specs.ramGb)
    .map((s) => ({
      kind: 'predefined',
      machineType: s.name,
      vcpu: s.baselineVcpu,
      ramGb: s.ramGb,
    }))
    .sort((a, b) => excessOver(want, a) - excessOver(want, b))[0] || null;

  // e2 is the cheaper custom family and covers up to 32 vCPU; n2 goes to 80.
  const custom = ['e2', 'n2']
    .map((family) => catalog.buildCustomMachineType({ family, vcpu: specs.vcpu, ramGb: specs.ramGb }))
    .filter((c) => c.ok)
    .map((c) => ({
      kind: 'custom',
      machineType: c.machineType,
      vcpu: c.vcpu,
      ramGb: c.ramGb,
    }))
    .sort((a, b) => excessOver(want, a) - excessOver(want, b))[0] || null;

  const candidates = [predefined, custom].filter(Boolean);

  if (!candidates.length) {
    // Neither route works. The custom builder's own message says why far more
    // usefully than "no shape found" would.
    const why = catalog.buildCustomMachineType({ family: 'n2', vcpu: specs.vcpu, ramGb: specs.ramGb });
    return refuse(
      'SPEC_NOT_SATISFIABLE',
      `No GCP shape provides ${specs.vcpu} vCPU with ${specs.ramGb} GB RAM. ${why.ok ? '' : why.message}`.trim(),
      { vcpu: specs.vcpu, ramGb: specs.ramGb, customError: why.ok ? null : why.code },
    );
  }

  // Ties go to the predefined shape: same waste, lower unit price.
  const chosen = candidates.sort((a, b) => {
    const d = excessOver(want, a) - excessOver(want, b);
    if (d !== 0) return d;
    return a.kind === 'predefined' ? -1 : 1;
  })[0];

  const notes = [];
  if (chosen.kind === 'custom') {
    notes.push(`Custom machine type — no standard shape fit ${specs.vcpu} vCPU / ${specs.ramGb} GB without buying noticeably more.`);
  }
  if (chosen.vcpu > specs.vcpu) {
    notes.push(`${chosen.vcpu} vCPU instead of ${specs.vcpu}.`);
  }
  if (chosen.ramGb > specs.ramGb) {
    notes.push(`${Number(chosen.ramGb.toFixed(2))} GB RAM instead of ${specs.ramGb}.`);
  }

  return {
    ok: true,
    machineType: chosen.machineType,
    vcpu: chosen.vcpu,
    ramGb: chosen.ramGb,
    accelerator: null,
    acceleratorLabel: null,
    acceleratorCount: 0,
    notes,
  };
};

/**
 * The boot disk.
 *
 * One disk, not a boot disk plus a data disk: the tier sells a single storage
 * figure and the customer's model weights have to live somewhere that survives
 * a stop. Persistent, never local SSD — see the comment in the catalogue.
 */
const planDisk = (specs) => {
  const resolved = catalog.resolveDiskType(specs.storageType);
  const asked = Math.ceil(specs.storageGb);
  const sizeGb = Math.max(asked, catalog.MIN_BOOT_DISK_GB);

  const notes = [];
  if (sizeGb > asked && asked > 0) {
    notes.push(`${sizeGb} GB disk instead of ${asked} — GCP's minimum boot disk is ${catalog.MIN_BOOT_DISK_GB} GB.`);
  }
  if (!resolved.matched && specs.storageType) {
    notes.push(`Storage type "${specs.storageType}" is not one this mapper recognises; using ${resolved.type}.`);
  }

  return { sizeGb, type: resolved.type, notes };
};

/**
 * The whole decision.
 *
 * @param {object} deployment a deployment row or wrapped doc (the tier snapshot is read off it)
 * @param {object} [options]
 * @param {string} [options.zone] the zone this will be created in, for the caller's convenience
 * @returns {{ok: true, plan: object} | {ok: false, code: string, message: string, detail: object}}
 */
const planInstance = (deployment, options = {}) => {
  const specs = readSpecs(deployment);

  if (specs.vcpu <= 0 || specs.ramGb <= 0) {
    return refuse(
      'SPECS_MISSING',
      `"${specs.tierName}" has no CPU or memory recorded (${specs.vcpu} vCPU, ${specs.ramGb} GB), so there is nothing to build. `
      + 'This usually means the tier was saved without components.',
      { vcpu: specs.vcpu, ramGb: specs.ramGb },
    );
  }

  const machine = specs.gpuCount > 0 ? planGpuMachine(specs) : planCpuMachine(specs);
  if (!machine.ok) return machine;

  const disk = planDisk(specs);

  const notes = [...machine.notes, ...disk.notes];

  // Network bandwidth is not something GCP lets us ask for — it falls out of
  // the machine shape. Saying so is more useful than inventing a number we
  // cannot honour, so the figure is carried through as "what was sold" and left
  // for the admin to judge.
  if (specs.networkGbps > 0) {
    notes.push(`Tier advertises ${specs.networkGbps} Gbps; GCP derives egress bandwidth from the machine shape and cannot be asked for a figure.`);
  }

  return {
    ok: true,
    plan: {
      machineType: machine.machineType,
      zone: options.zone || null,

      vcpu: machine.vcpu,
      ramGb: machine.ramGb,

      accelerator: machine.accelerator,
      acceleratorLabel: machine.acceleratorLabel,
      acceleratorCount: machine.acceleratorCount,

      bootDisk: { sizeGb: disk.sizeGb, type: disk.type },

      // What was sold, kept beside what will be built, so the admin screen can
      // show both and the difference is never hidden.
      requested: {
        vcpu: specs.vcpu,
        ramGb: specs.ramGb,
        gpu: specs.gpuCount > 0 ? `${specs.gpuModel} x${specs.gpuCount}` : null,
        storageGb: specs.storageGb,
        storageType: specs.storageType,
        networkGbps: specs.networkGbps,
      },

      notes,
    },
  };
};

module.exports = {
  planInstance,
  readSpecs,
  // Exported for tests; not part of the interface callers should use.
  planGpuMachine,
  excessOver,
  planCpuMachine,
  planDisk,
};
