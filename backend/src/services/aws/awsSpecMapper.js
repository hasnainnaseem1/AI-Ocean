/**
 * A tier's specs -> a real AWS instance type.
 *
 * The AWS twin of `gcpSpecMapper.js`, and it keeps the same promise:
 *
 *   **Never silently give a customer less than they bought.**
 *
 * Where AWS cannot match a tier exactly, the customer gets MORE and the
 * platform pays for the difference. Where AWS cannot build it at all, this
 * refuses and names what is wrong, rather than approximating.
 *
 * ── Why refusals are more common here than on GCP ──
 *
 * GCP has custom machine types, so almost any CPU shape can be built exactly.
 * AWS has a fixed menu, so "16 vCPU and 32 GB" becomes `m6i.4xlarge` with 64 GB
 * — overshoot is routine. And A100/H100 on AWS come only in eights, so a tier
 * selling one A100 genuinely cannot be built: billing a customer for one card
 * while paying for eight is not a rounding error, it is the business upside
 * down.
 *
 * Pure: no database, no network, no clock.
 */
const catalog = require('./awsMachineCatalog');

const refuse = (code, message, detail = {}) => ({ ok: false, code, message, detail });

/**
 * Pull the machine specs off a deployment row.
 *
 * Identical in shape to the GCP mapper's, reading the same frozen tier
 * snapshot — so the two clouds are always answering a question about the same
 * numbers.
 *
 * `tierVramGb` is **per accelerator**, not the total. A tier with 4 cards of
 * 80 GB stores 80. Reading it as a total would match the wrong GPU entirely.
 */
const readSpecs = (deployment = {}) => ({
  name: deployment.tierName || deployment.tier?.name || 'this tier',
  vcpu: Number(deployment.tierVcpu ?? deployment.tier?.vcpu) || 0,
  ramGb: Number(deployment.tierRamGb ?? deployment.tier?.ramGb) || 0,
  gpuModel: String(deployment.tierGpuModel ?? deployment.tier?.gpuModel ?? '').trim(),
  gpuCount: Number(deployment.tierGpuCount ?? deployment.tier?.gpuCount) || 0,
  vramGb: Number(deployment.tierVramGb ?? deployment.tier?.vramGb) || 0,
  storageGb: Number(deployment.tierStorageGb ?? deployment.tier?.storageGb) || 0,
  storageType: String(deployment.tierStorageType ?? deployment.tier?.storageType ?? '').trim(),
  networkGbps: Number(deployment.tierNetworkGbps ?? deployment.tier?.networkGbps) || 0,
});

/** A GPU tier: the card decides the shape, and the shape brings its own CPU. */
const planGpuInstance = (specs) => {
  const gpu = catalog.lookupGpu(specs.gpuModel, specs.vramGb);

  if (!gpu) {
    return refuse(
      'GPU_NOT_ON_AWS',
      `"${specs.gpuModel}" with ${specs.vramGb} GB per card is not a GPU AWS offers. `
        + 'Change the tier to a card AWS sells (A100 40/80 GB, H100 80 GB, L4, T4, V100), '
        + 'or do not run this tier on AWS.',
      { gpuModel: specs.gpuModel, vramGb: specs.vramGb }
    );
  }

  const withEnough = gpu.shapes.filter((s) => s.gpuCount >= specs.gpuCount);
  if (!withEnough.length) {
    const most = Math.max(...gpu.shapes.map((s) => s.gpuCount));
    return refuse(
      'GPU_COUNT_TOO_HIGH',
      `${gpu.label} x${specs.gpuCount} is more than AWS sells in one instance — the largest is `
        + `${most}. Split the tier or use a different card.`,
      { asked: specs.gpuCount, most }
    );
  }

  /*
   * AWS sells these in fixed card counts. Asking for 2 A100s means taking a
   * shape with 8, and that is not an overshoot anybody should absorb silently:
   * the customer pays for 2 and the platform pays for 8.
   */
  const sameCount = gpu.shapes.filter((s) => s.gpuCount === specs.gpuCount);
  if (!sameCount.length) {
    const offered = gpu.shapes.map((s) => s.gpuCount).join(', ');
    return refuse(
      'GPU_COUNT_NOT_SOLD',
      `AWS sells ${gpu.label} in counts of ${offered}; this tier asks for ${specs.gpuCount}. `
        + 'Taking the next size up would mean paying for '
        + `${withEnough[0].gpuCount} cards while charging for ${specs.gpuCount}.`,
      { asked: specs.gpuCount, offered: gpu.shapes.map((s) => s.gpuCount) }
    );
  }

  /*
   * ── Among the shapes with the right card count, the smallest that fits ──
   *
   * Several families sell the same card count at different CPU and RAM sizes:
   * g6.xlarge and g6.4xlarge are both one L4, with 4 and 16 vCPU. Taking the
   * first one with the right card count would refuse a 16 vCPU single-L4 tier
   * that AWS can build perfectly well — so the choice is the tightest fit
   * among those that are not short, exactly as the CPU path does.
   */
  const fits = sameCount.filter((s) => s.vcpu >= specs.vcpu && s.ramGb >= specs.ramGb);

  if (!fits.length) {
    /*
     * The card count is sold, but no shape carrying it has enough CPU or RAM.
     * There is nothing larger to reach for, so the tier cannot be honoured —
     * the biggest one is named so the tier can be re-spec'd to what exists.
     */
    const biggest = sameCount.slice().sort((a, b) => b.vcpu - a.vcpu)[0];
    const short = [];
    if (biggest.vcpu < specs.vcpu) short.push(`${specs.vcpu} vCPU (the largest has ${biggest.vcpu})`);
    if (biggest.ramGb < specs.ramGb) short.push(`${specs.ramGb} GB RAM (the largest has ${biggest.ramGb})`);

    return refuse(
      'GPU_SHAPE_TOO_SMALL',
      `${gpu.label} x${specs.gpuCount} on AWS tops out at "${biggest.name}", which cannot meet `
        + `${short.join(' and ')}. Re-spec the tier to what the shape actually provides.`,
      { instanceType: biggest.name, vcpu: biggest.vcpu, ramGb: biggest.ramGb }
    );
  }

  // Same tie-break as the CPU path: least given away, RAM weighed against
  // cores so the two clouds agree about what "closest" means.
  const waste = (s) =>
    Math.max(0, s.vcpu - specs.vcpu) + Math.max(0, s.ramGb - specs.ramGb) / 4;
  const exact = fits.slice().sort((a, b) => waste(a) - waste(b) || a.vcpu - b.vcpu)[0];

  const notes = [];
  if (exact.vcpu > specs.vcpu) {
    notes.push(`${exact.vcpu} vCPU instead of ${specs.vcpu} — AWS ties the CPU count to the GPU shape.`);
  }
  if (exact.ramGb > specs.ramGb) {
    notes.push(`${exact.ramGb} GB RAM instead of ${specs.ramGb} — same reason.`);
  }

  return {
    ok: true,
    instanceType: exact.name,
    vcpu: exact.vcpu,
    ramGb: exact.ramGb,
    acceleratorLabel: gpu.label,
    acceleratorCount: exact.gpuCount,
    notes,
  };
};

/** A CPU tier: the smallest listed shape that is not short of anything. */
const planCpuInstance = (specs) => {
  const shape = catalog.smallestCpuShape(specs);

  if (!shape) {
    return refuse(
      'NO_SHAPE_FITS',
      `AWS has no instance type with at least ${specs.vcpu} vCPU and ${specs.ramGb} GB RAM `
        + 'in the families this platform uses (m6i, c6i, r6i). The tier is larger than anything '
        + 'on the menu.',
      { vcpu: specs.vcpu, ramGb: specs.ramGb }
    );
  }

  /*
   * The overshoot, stated rather than buried. On AWS this is the normal case,
   * not the exception — there are no custom shapes — and the cost model is fed
   * what is BUILT, so the platform is paying for every line here.
   */
  const notes = [];
  if (shape.vcpu > specs.vcpu) {
    notes.push(`${shape.vcpu} vCPU instead of ${specs.vcpu} — AWS has no custom shapes, so this is `
      + 'the smallest listed type that is not short.');
  }
  if (shape.ramGb > specs.ramGb) {
    notes.push(`${shape.ramGb} GB RAM instead of ${specs.ramGb} — same reason.`);
  }

  return {
    ok: true,
    instanceType: shape.name,
    vcpu: shape.vcpu,
    ramGb: shape.ramGb,
    acceleratorLabel: null,
    acceleratorCount: 0,
    notes,
  };
};

/** The root volume. */
const planVolume = (specs) => {
  const resolved = catalog.resolveVolumeType(specs.storageType);
  const asked = Math.ceil(specs.storageGb);

  /*
   * `st1` (throughput HDD) has a 125 GB floor, which is larger than most root
   * volumes want. Rather than silently giving a 20 GB tier 125 GB of HDD, the
   * volume falls back to gp3 — the customer gets at least what they bought,
   * on a better disk, and the note says so.
   */
  let type = resolved.type;
  const notes = [];

  if (type === 'st1' && asked < catalog.ST1_MIN_GB) {
    type = catalog.DEFAULT_VOLUME_TYPE;
    notes.push(`${asked} GB is below AWS's ${catalog.ST1_MIN_GB} GB minimum for throughput HDD, `
      + 'so this uses a gp3 SSD instead — better storage, not worse.');
  }

  const sizeGb = Math.max(asked, catalog.MIN_ROOT_VOLUME_GB);
  if (sizeGb > asked && asked > 0) {
    notes.push(`${sizeGb} GB volume instead of ${asked} — AWS's minimum root volume is `
      + `${catalog.MIN_ROOT_VOLUME_GB} GB.`);
  }

  if (!resolved.matched && specs.storageType) {
    notes.push(`Storage type "${specs.storageType}" is not one this mapper recognises; using ${type}.`);
  }

  return { sizeGb, type, notes };
};

/**
 * The whole decision.
 *
 * @param {object} deployment a deployment row or wrapped doc
 * @param {object} [options]
 * @param {string} [options.az] the availability zone this will launch in
 * @returns {{ok: true, plan: object} | {ok: false, code: string, message: string, detail: object}}
 */
const planInstance = (deployment, options = {}) => {
  const specs = readSpecs(deployment);

  if (specs.vcpu <= 0 && specs.ramGb <= 0 && specs.gpuCount <= 0) {
    return refuse(
      'TIER_HAS_NO_SPECS',
      `"${specs.name}" has no CPU, memory or accelerator recorded, so there is nothing to build.`,
      { specs }
    );
  }

  const machine = specs.gpuCount > 0 ? planGpuInstance(specs) : planCpuInstance(specs);
  if (!machine.ok) return machine;

  const volume = planVolume(specs);

  const notes = [...machine.notes, ...volume.notes];

  /*
   * Bandwidth is sold by the tier and cannot be asked for on AWS — network
   * performance is a property of the instance type. Carried through as a note
   * rather than silently dropped, same as the GCP mapper does.
   */
  if (specs.networkGbps > 0) {
    notes.push(`Tier advertises ${specs.networkGbps} Gbps; AWS derives network performance from the `
      + 'instance type and cannot be asked for a figure.');
  }

  return {
    ok: true,
    plan: {
      // Named `machineType` as well as `instanceType` so callers written
      // against the GCP plan — capGuard, the cost model, the admin screens —
      // read the same field without knowing which cloud produced it.
      machineType: machine.instanceType,
      instanceType: machine.instanceType,
      az: options.az || null,

      vcpu: machine.vcpu,
      ramGb: machine.ramGb,

      accelerator: machine.acceleratorLabel,
      acceleratorLabel: machine.acceleratorLabel,
      acceleratorCount: machine.acceleratorCount,

      bootDisk: { sizeGb: volume.sizeGb, type: volume.type },

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
  planGpuInstance,
  planCpuInstance,
  planVolume,
};
