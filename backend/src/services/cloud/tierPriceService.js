/**
 * Filling and reading the price matrix.
 *
 * The I/O half of `tierPricingMatrix.js`: this one talks to the database, the
 * spec mappers and the price providers; that one does the arithmetic and
 * decides whether a cell may be sold.
 *
 * ── What the hourly refresh is actually for ──
 *
 * It is not only to keep prices current. It is what makes the margin guard a
 * backstop rather than a daily obstruction: if the matrix tracks what the
 * clouds charge, a price can only fall below its floor in the gap between one
 * pass and the next. Without it, every provider rate rise would sit unnoticed
 * until a customer's deployment was refused at build time.
 *
 * ── Why a refresh never deletes a row ──
 *
 * A cell that stops being sellable keeps its row and changes status. Deleting
 * it would lose the recorded cost, the operator's typed-in price and the
 * reason it failed — exactly the three things needed to work out what went
 * wrong.
 */
const prisma = require('../../lib/prismaClient');
const matrix = require('./tierPricingMatrix');
const cloudRegions = require('./cloudRegions');
const regionCostService = require('./regionCostService');
const cloudPricing = require('./cloudPricing');
const { CLOUDS } = require('./cloudRouter');

/** Four places: this is a figure that appears on an invoice. */
const round4 = (n) => Number(Number(n || 0).toFixed(4));

/** Each cloud's mapper from tier specs to a machine shape. */
const MAPPERS = {
  get gcp() { return require('../gcp/gcpSpecMapper'); },
  get aws() { return require('../aws/awsSpecMapper'); },
};

/** Which clouds are switched on right now. */
const enabledCloudsFrom = (settings) =>
  CLOUDS.filter((cloud) => !!settings?.[`${cloud}Settings`]?.enabled);

/**
 * What this tier builds as on one cloud.
 *
 * The spec mappers read a *deployment*, so the tier is handed over in the
 * shape they already understand rather than teaching them a second one.
 */
const shapeOn = (cloud, tier, region) => {
  const mapper = MAPPERS[cloud];
  if (!mapper) return { ok: false, reason: `${cloud} is not a cloud this platform can build on.` };

  const resolved = cloudRegions.resolveOn(cloud, region);
  if (!resolved.ok) return { ok: false, reason: resolved.message };

  // A zone only matters for availability, not for shape or price; the first
  // one is enough to let the mapper answer.
  const zone = (resolved.azs || resolved.zones || [])[0] || null;
  const planned = mapper.planInstance({ tier }, { zone, az: zone });

  if (!planned.ok) {
    return { ok: false, reason: planned.message || planned.reason || 'This cloud has no shape for these specs.' };
  }

  return {
    ok: true,
    machineType: planned.plan?.instanceType || planned.plan?.machineType || '',
    plan: planned.plan,
    providerRegion: cloud === 'aws' ? resolved.awsRegion : resolved.gcpRegion,
  };
};

/** The components the cost model prices, from a tier. */
const componentsOf = (tier, plan = null) => ({
  /*
   * ── What is priced is the machine that will RUN, not the tier as written ──
   *
   * A cloud sells fixed shapes. "Micro 1GB" asks for 1 vCPU and 1 GB, and the
   * smallest thing Google will actually start is an `e2-medium` with 1 vCPU
   * and **4 GB** — three gigabytes nobody asked for and all of them billed.
   *
   * Pricing the tier's own numbers made the matrix quote 1 GB while the guard,
   * which prices the real placement, costed 4. The cell published $0.0373,
   * the machine cost $0.0407, and every order was held as loss-making — the
   * guard was right and the price was wrong, which is the dangerous way round
   * because the price is what a customer is shown.
   *
   * So the mapper's plan wins wherever it has an answer. The tier is the
   * fallback for a cloud whose mapper reports no shape, where refusing is
   * handled upstream.
   */
  vcpu: Number(plan?.vcpu ?? tier.vcpu) || 0,
  ramGb: Number(plan?.ramGb ?? tier.ramGb) || 0,
  gpuModel: String(plan?.acceleratorLabel || plan?.accelerator || tier.gpuModel || ''),
  gpuCount: Number(plan?.acceleratorCount ?? tier.gpuCount) || 0,
  storageGb: Number(plan?.bootDisk?.sizeGb ?? tier.storageGb) || 0,
  /*
   * The TIER's disk type, not the plan's.
   *
   * A mapper names the disk the way its cloud does — Google's plan says
   * `pd-balanced` — while the rate table is keyed by the platform's own
   * vocabulary (`SSD`, `HDD`, `NVMe SSD`). Taking the plan's name here would
   * find no rate and make every machine unpriceable, which is the failure
   * this whole change is fixing. The SIZE is safe to take from the plan,
   * because a cloud may round a disk up.
   */
  storageType: String(tier.storageType || ''),
});

/**
 * Price one tier in one place, and write the row.
 *
 * Returns the cell rather than nothing, so a caller pricing a tier for a
 * screen can use the answer without reading it back.
 */
const refreshCell = async (tier, cloud, region, { settings, policy }) => {
  const existing = await prisma.tierPrice.findUnique({
    where: { tierId_cloud_region: { tierId: tier.id, cloud, region } },
  });

  const shape = shapeOn(cloud, tier, region);

  // Only ask a provider for a price once we know there is something to price.
  const price = shape.ok
    ? await cloudPricing.costFor({
      provider: cloud,
      region: shape.providerRegion,
      machineType: shape.machineType,
      components: componentsOf(tier, shape.plan),
      settings,
    }).catch((err) => ({ ok: false, reason: err.message }))
    : { ok: false, reason: shape.reason };

  const regionShare = shape.ok
    ? await regionCostService.shareFor(cloud, region)
    : { ok: false, reason: shape.reason };

  const cell = matrix.cellFor({
    tier, cloud, region, shape, price, regionShare, policy, existing,
  });

  const { tierId, ...data } = cell;
  await prisma.tierPrice.upsert({
    where: { tierId_cloud_region: { tierId: tier.id, cloud, region } },
    create: { tierId: tier.id, ...data },
    // `sellPriceIsOverridden` is deliberately absent: it is the operator's
    // flag, and a refresh that cleared it would undo their edit on the next pass.
    update: data,
  });

  return cell;
};

/**
 * Price one tier everywhere it is sold.
 *
 * Rows for places the tier is no longer sold in are marked rather than
 * deleted, for the reason in the file header.
 */
const refreshTier = async (tier, { settings, policy } = {}) => {
  const loaded = settings || await require('../admin/adminSettingsService').getSettings();
  const pol = policy || policyFrom(loaded);

  const places = matrix.placesFor(tier, enabledCloudsFrom(loaded), cloudRegions.commonRegions());
  const cells = [];

  for (const { cloud, region } of places) {
    try {
      cells.push(await refreshCell(tier, cloud, region, { settings: loaded, policy: pol }));
    } catch (err) {
      console.error(`[TierPrice] ${tier.name} ${cloud}/${region} failed:`, err.message);
    }
  }

  /*
   * Anywhere this tier used to be sold and is not any more. Marked unpriced so
   * it leaves every customer's region picker at once, without losing what it
   * used to cost.
   */
  const keep = new Set(places.map((p) => `${p.cloud}/${p.region}`));
  const stale = await prisma.tierPrice.findMany({ where: { tierId: tier.id } });
  for (const row of stale) {
    if (keep.has(`${row.cloud}/${row.region}`)) continue;
    if (row.status === matrix.STATUS.UNPRICED) continue;
    await prisma.tierPrice.update({
      where: { id: row.id },
      data: {
        status: matrix.STATUS.UNPRICED,
        lastError: 'This tier is no longer sold here, or this cloud is switched off.',
      },
    });
  }

  return cells;
};

/** Overhead, tax and the margin to use for one tier. */
const policyFrom = (settings) => {
  const cp = settings?.cloudPricingSettings || {};
  return {
    overheadPercent: Number(cp.overheadPercent) || 0,
    overheadPerHour: Number(cp.overheadPerHour) || 0,
    taxPercent: Number(cp.taxPercent) || 0,
    targetMarginPercent: Number(cp.targetMarginPercent) || 0,
    floorTolerancePercent: Number(cp.floorTolerancePercent) || 0,
    // Off turns the refresh into a cost report: it still works out what
    // everything costs, and leaves every price alone.
    autoPriceTiers: cp.autoPriceTiers !== false,
  };
};

/**
 * Price every active tier. The hourly job.
 *
 * Sequential on purpose. Pricing is not urgent, and twenty tiers across six
 * places firing in parallel is a hundred and twenty provider calls at once —
 * which is how a platform gets itself throttled by the API it depends on for
 * knowing what anything costs.
 */
const refreshAll = async ({ tierIds = null } = {}) => {
  const adminSettingsService = require('../admin/adminSettingsService');
  const settings = await adminSettingsService.getSettings();

  const summary = {
    tiers: 0, cells: 0, sellable: 0, belowFloor: 0, unpriced: 0, unbuildable: 0, failed: 0,
  };

  const clouds = enabledCloudsFrom(settings);
  if (!clouds.length) {
    summary.skipped = 'No cloud is switched on, so there is nothing to price.';
    return summary;
  }

  const tiers = await prisma.tier.findMany({
    where: { isActive: true, ...(tierIds ? { id: { in: tierIds } } : {}) },
  });

  for (const tier of tiers) {
    summary.tiers += 1;
    try {
      const cells = await refreshTier(tier, { settings, policy: policyFrom(settings) });
      for (const cell of cells) {
        summary.cells += 1;
        if (cell.status === matrix.STATUS.SELLABLE) summary.sellable += 1;
        else if (cell.status === matrix.STATUS.BELOW_FLOOR) summary.belowFloor += 1;
        else if (cell.status === matrix.STATUS.UNBUILDABLE) summary.unbuildable += 1;
        else summary.unpriced += 1;
      }
    } catch (err) {
      summary.failed += 1;
      console.error(`[TierPrice] ${tier.name} failed:`, err.message);
    }
  }

  return summary;
};

/**
 * One tier's whole matrix, for the admin screen.
 *
 * Every place the tier could be sold, including the ones that failed — a
 * screen that showed only the cells that worked would hide exactly the rows an
 * operator needs to act on.
 */
const matrixFor = async (tierId) => {
  const rows = await prisma.tierPrice.findMany({
    where: { tierId },
    orderBy: [{ cloud: 'asc' }, { region: 'asc' }],
  });

  /*
   * Whether each region's NETWORK exists, which is a different fact from
   * whether the tier is priced there and has different timing.
   *
   * A cloud publishes what a region costs long before anything is built in
   * it, so a cell can be correctly priced and sellable while its VPC does not
   * exist yet — the case where a customer is the first to deploy somewhere.
   * Computed here rather than stored, because it changes when infrastructure
   * is applied, not when a price is worked out.
   */
  const settings = await require('../admin/adminSettingsService').getSettings();
  const awsShape = require('../aws/awsSettingsShape');
  const awsReady = awsShape.configuredRegions(settings?.awsSettings || {});
  const gcpConnected = !!(settings?.gcpSettings?.projectId);

  const isBuilt = (cloud, region) => {
    const resolved = cloudRegions.resolveOn(cloud, region);
    if (!resolved.ok) return false;
    // Google's network is global: one connected project covers every region.
    // AWS needs a VPC, security group, subnets and an image in each.
    return cloud === 'aws' ? awsReady.includes(resolved.awsRegion) : gcpConnected;
  };

  return rows.map((r) => ({
    regionBuilt: isBuilt(r.cloud, r.region),
    id: r.id,
    cloud: r.cloud,
    region: r.region,
    machineType: r.machineType,
    providerCostPerHour: Number(r.providerCostPerHour),
    regionalSharePerHour: Number(r.regionalSharePerHour),
    overheadPerHour: Number(r.overheadPerHour),
    taxPerHour: Number(r.taxPerHour),
    totalCostPerHour: Number(r.totalCostPerHour),
    floorPricePerHour: Number(r.floorPricePerHour),
    sellPricePerHour: Number(r.sellPricePerHour),
    stoppedPricePerHour: Number(r.stoppedPricePerHour),
    sellPriceIsOverridden: r.sellPriceIsOverridden,
    costSource: r.costSource,
    costAsOf: r.costAsOf,
    status: r.status,
    lastError: r.lastError,
  }));
};

/**
 * The places a tier can actually be sold on one cloud, with their prices.
 *
 * What the customer's region picker is built from. Only `sellable` — a region
 * whose price is below its floor, or which could not be priced, must not be
 * offered at all.
 */
const sellablePlacesFor = async (tierId, cloud) => {
  const rows = await prisma.tierPrice.findMany({
    where: { tierId, cloud, status: matrix.STATUS.SELLABLE },
    orderBy: { sellPricePerHour: 'asc' },
  });

  return rows.map((r) => ({
    region: r.region,
    pricePerHour: Number(r.sellPricePerHour),
    stoppedPricePerHour: Number(r.stoppedPricePerHour),
  }));
};

/**
 * Where this model on this tier can be deployed, and what each place costs.
 *
 * What the customer's region picker is built from, and what the price frozen
 * onto their deployment comes from.
 *
 * ── Why the customer never picks the cloud ──
 *
 * The cloud follows the model: an operator assigns Kimi to AWS and DeepSeek to
 * Google, and the customer sees only the regions that model can run in, at
 * that cloud's prices. So "which cloud" never becomes a question a customer
 * has to have an opinion about.
 *
 * ── The case where the cloud is not yet known ──
 *
 * A model with no assignment and no platform default goes to the fulfilment
 * queue, where a person decides. The price still has to be quoted and frozen
 * now, before anyone knows which cloud will build it — so the DEAREST cell for
 * each region is quoted. Quoting the cheapest would mean a customer who lands
 * on the other cloud is billed less than that machine costs us.
 *
 * ── The fallback ──
 *
 * A tier with no matrix rows at all — no cloud connected, or never priced —
 * falls back to `Tier.pricePerHour`, which is what the platform used before
 * prices varied by place. Without it a platform that has not connected a cloud
 * could not sell anything.
 *
 * @returns {{cloud, places: [{region, pricePerHour, stoppedPricePerHour,
 *   regionBuilt}], source: 'matrix'|'tier', reason}}
 */
const offerFor = async ({ tier, model = null, settings = null }) => {
  const loaded = settings || await require('../admin/adminSettingsService').getSettings();
  const cloudRouter = require('./cloudRouter');

  const routed = await cloudRouter.resolve({ model, settings: loaded });
  const cloud = cloudRouter.isCloud(routed.cloud) ? routed.cloud : null;

  // The model's own surcharge on this tier, which is about the model and not
  // about where it runs — so it multiplies whatever the place costs.
  const multiplier = (() => {
    const link = (model?.supportedTiers || []).find((t) => t.tierId === tier?.id);
    const m = link?.priceMultiplier;
    return m === null || m === undefined ? 1 : Number(m) || 1;
  })();

  const rows = await prisma.tierPrice.findMany({
    where: { tierId: tier.id, status: matrix.STATUS.SELLABLE },
  });

  if (!rows.length) {
    const fallback = (tier.regions || []).map((region) => ({
      region,
      pricePerHour: round4(Number(tier.pricePerHour) * multiplier),
      stoppedPricePerHour: round4(Number(tier.stoppedPricePerHour) * multiplier),
      regionBuilt: false,
    }));
    return {
      cloud,
      places: fallback,
      source: 'tier',
      reason: 'This tier has no per-region price yet, so its catalogue price is used everywhere.',
    };
  }

  const onCloud = cloud ? rows.filter((r) => r.cloud === cloud) : rows;

  /*
   * One entry per region. With the cloud known that is already true; without
   * it, several clouds can offer the same region and the dearest wins.
   */
  const byRegion = new Map();
  for (const row of onCloud) {
    const current = byRegion.get(row.region);
    if (!current || Number(row.sellPricePerHour) > Number(current.sellPricePerHour)) {
      byRegion.set(row.region, row);
    }
  }

  const awsShape = require('../aws/awsSettingsShape');
  const awsReady = awsShape.configuredRegions(loaded?.awsSettings || {});
  const gcpConnected = !!(loaded?.gcpSettings?.projectId);

  const places = [...byRegion.values()]
    .map((row) => {
      const resolved = cloudRegions.resolveOn(row.cloud, row.region);
      return {
        region: row.region,
        pricePerHour: round4(Number(row.sellPricePerHour) * multiplier),
        stoppedPricePerHour: round4(Number(row.stoppedPricePerHour) * multiplier),
        /*
         * Whether the network exists there yet. Priced and built are different
         * facts: a cloud publishes what a region costs long before anything is
         * built in it, so a customer can be the first to deploy somewhere.
         */
        regionBuilt: resolved.ok && (row.cloud === 'aws'
          ? awsReady.includes(resolved.awsRegion)
          : gcpConnected),
      };
    })
    .sort((a, b) => a.pricePerHour - b.pricePerHour);

  return {
    cloud,
    places,
    source: 'matrix',
    reason: cloud ? null : 'No cloud is assigned to this model, so the dearest price is quoted.',
  };
};

/**
 * Set one cell's price by hand, or hand it back to the refresh.
 *
 * Passing null clears the override, and the next pass re-prices the cell from
 * its own floor.
 */
const setCellPrice = async (tierId, cloud, region, sellPricePerHour) => {
  const clear = sellPricePerHour === null || sellPricePerHour === undefined || sellPricePerHour === '';

  const row = await prisma.tierPrice.update({
    where: { tierId_cloud_region: { tierId, cloud, region } },
    data: clear
      ? { sellPriceIsOverridden: false }
      : {
        sellPriceIsOverridden: true,
        sellPricePerHour: Math.max(0, Number(sellPricePerHour) || 0),
      },
  });

  // Re-priced immediately so the screen shows the new verdict rather than the
  // one from before the edit.
  const tier = await prisma.tier.findUnique({ where: { id: tierId } });
  if (tier) await refreshTier(tier);

  return row;
};

/**
 * Every (tier × region) a held order could be moved to, on one cloud.
 *
 * ── Why this is here and not in the hold service ──
 *
 * The decision of WHAT to offer is pure and lives in
 * `deployment/holdAlternative.js`, where it can be tested without a database.
 * This is the other half: gathering the candidates it chooses from, which is
 * three joins and a region-readiness check.
 *
 * ── What `regionReady` is for ──
 *
 * A cell can be `sellable` — priced, costed, above its floor — in a region
 * whose network does not exist yet. That is deliberate and it is what makes
 * the whole pricing model work: a region is costed and sold before it is
 * built, so its standing cost is in the price from the first day.
 *
 * But it makes such a cell useless as an ALTERNATIVE. Offering it would move
 * a waiting customer to an identical wait, which is worse than offering
 * nothing because it costs them a decision too. So each place carries whether
 * a machine could actually start there, and the chooser drops the ones that
 * could not.
 */
const alternativesFor = async ({ model, cloud, settings = null }) => {
  if (!model?.id || !cloud) return [];

  const links = await prisma.aIModelSupportedTier.findMany({
    where: { aiModelId: model.id },
    select: { tierId: true, priceMultiplier: true },
  });
  if (!links.length) return [];

  const tierIds = links.map((l) => l.tierId);
  const multiplierOf = new Map(
    links.map((l) => [l.tierId, l.priceMultiplier == null ? 1 : Number(l.priceMultiplier) || 1]),
  );

  const [rows, tiers] = await Promise.all([
    prisma.tierPrice.findMany({
      where: { tierId: { in: tierIds }, cloud, status: matrix.STATUS.SELLABLE },
    }),
    prisma.tier.findMany({
      where: { id: { in: tierIds }, isActive: true },
      select: {
        id: true, name: true, gpuModel: true, gpuCount: true,
        vramGb: true, vcpu: true, ramGb: true,
      },
    }),
  ]);

  const tierOf = new Map(tiers.map((t) => [t.id, t]));

  /*
   * Which regions can actually take a machine today.
   *
   * On AWS that is the regions whose ids are saved — a VPC, subnets, a
   * security group and an AMI. Google's network is global, so every region it
   * serves is ready as soon as the cloud is on.
   */
  const ready = await (async () => {
    if (cloud !== 'aws') return null; // null means "all of them"
    const loaded = settings || await require('../admin/adminSettingsService').getSettings();
    const shape = require('../aws/awsSettingsShape');
    const regionMap = require('../aws/awsRegionMap');

    // Settings hold AWS's own names; a TierPrice row holds the platform's.
    const built = new Set(shape.configuredRegions(loaded?.awsSettings || {}));
    const platform = new Set();
    for (const [name, entry] of Object.entries(regionMap.REGIONS || {})) {
      if (built.has(entry.awsRegion)) platform.add(name);
    }
    return platform;
  })();

  return rows
    .filter((r) => tierOf.has(r.tierId))
    .map((r) => ({
      tierId: r.tierId,
      tier: tierOf.get(r.tierId),
      region: r.region,
      // The model's own surcharge applies to an alternative exactly as it
      // would to the original — otherwise the quoted figure is not what the
      // customer would actually be charged.
      pricePerHour: round4(Number(r.sellPricePerHour) * (multiplierOf.get(r.tierId) || 1)),
      stoppedPricePerHour: round4(
        Number(r.stoppedPricePerHour) * (multiplierOf.get(r.tierId) || 1),
      ),
      regionReady: ready === null ? true : ready.has(r.region),
    }));
};

module.exports = {
  refreshAll,
  refreshTier,
  refreshCell,
  matrixFor,
  sellablePlacesFor,
  alternativesFor,
  offerFor,
  setCellPrice,
  // Exported for tests.
  shapeOn,
  componentsOf,
  enabledCloudsFrom,
  policyFrom,
};
