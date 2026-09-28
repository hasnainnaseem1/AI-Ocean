/**
 * Custom machines — a customer assembling their own hardware instead of
 * picking one of the catalogue's.
 *
 * The pricing arithmetic is not reimplemented here. `tierPricing.quote` is the
 * same function the admin's tier builder uses, and its own doc comment always
 * anticipated this second caller: a machine a customer builds has to be priced
 * by exactly the code that prices one the admin builds, or the two drift and
 * the platform quotes something it does not bill.
 *
 * What a custom machine is NOT: a `Tier`. It never enters the catalogue. Its
 * components are priced and rolled up here, the resulting specs and rates are
 * written straight onto the deployment (`tierId` is nullable for precisely
 * this), and the admin provisions it from the fulfilment queue the same way
 * they provision every other order on this platform. That keeps the catalogue
 * a curated list rather than a graveyard of one-off experiments.
 */
const prisma = require('../../lib/prismaClient');
const tierPricing = require('./tierPricing');
const billingModeService = require('../billing/billingModeService');
const { isPublicId } = require('../../utils/helpers/publicId');

const MAX_PICKS = 20;

/** Total VRAM across the machine, not per accelerator. */
const totalVramOf = (specs) => (Number(specs.vramGb) || 0) * (Number(specs.gpuCount) || 0);

/**
 * The parts a customer is allowed to build from.
 *
 * `availableForCustomBuilds` is the admin's switch for this — it has existed on
 * the component since the pricing model was built, and this is what finally
 * reads it. A component the admin excludes simply never reaches the builder.
 */
const listBuildableComponents = async () => {
  const rows = await prisma.resourceComponent.findMany({
    where: { isActive: true, availableForCustomBuilds: true },
    orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
  });

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    description: c.description,
    unitLabel: c.unitLabel,
    specs: c.specs || {},
    // The slider's shape. `maxQuantity: 0` means the admin set no ceiling, so
    // the UI picks a sane one rather than rendering an infinite track.
    minQuantity: c.minQuantity,
    maxQuantity: c.maxQuantity,
    stepQuantity: c.stepQuantity || 1,
    // Whether this part keeps costing while the machine is paused — the
    // customer should be able to see which half of their bill survives a stop.
    billedWhileStopped: c.billedWhileStopped,
  }));
};

/**
 * Price a set of picks and derive what the resulting machine actually is.
 *
 * Always server-side, and always from the component rows rather than anything
 * the client sent: a price the browser calculated is a price nobody is bound
 * to. Unknown or withdrawn components are dropped by `resolveComponents`
 * rather than throwing, and reported back so the caller can say so.
 *
 * @param {Array}  picks    `[{ componentId, quantity }]`
 * @param {Object} [options]
 * @param {Object} [options.model]  when given, the machine is checked against
 *   what this model needs to load at all
 */
const priceCustomBuild = async (picks = [], { model = null, settings = null } = {}) => {
  const billing = settings || (await billingModeService.getBillingSettings());
  const markupPercent = Number(billing.customBuild?.markupPercent) || 0;

  const clean = (Array.isArray(picks) ? picks : [])
    .slice(0, MAX_PICKS)
    .filter((p) => p && isPublicId(p.componentId) && Number(p.quantity) > 0)
    .map((p) => ({ componentId: p.componentId, quantity: Number(p.quantity) }));

  const quote = await tierPricing.quote(clean, markupPercent);
  const { specs } = tierPricing.rollupComponents(
    // `quote` strips the internal db id; rollup only reads kind/quantity/specs.
    quote.lines.map((l) => ({ ...l }))
  );

  const totalVramGb = totalVramOf(specs);
  const needsVramGb = Number(model?.minVramGb) || 0;

  /*
   * A machine with less VRAM than the model needs cannot load it at all. The
   * deployment would be provisioned, start billing, and then fail — so this is
   * reported as a hard blocker rather than a warning, and createDeployment
   * refuses on it.
   */
  const vramShortfall = needsVramGb > 0 && totalVramGb < needsVramGb
    ? { needsVramGb, totalVramGb }
    : null;

  return {
    picks: clean,
    lines: quote.lines,
    dropped: quote.dropped,
    specs: {
      gpuModel: specs.gpuModel || '',
      gpuCount: specs.gpuCount || 0,
      vramGb: specs.vramGb || 0,
      totalVramGb,
      vcpu: specs.vcpu || 0,
      ramGb: specs.ramGb || 0,
      storageGb: specs.storageGb || 0,
      storageType: specs.storageType || '',
      networkGbps: specs.networkGbps || 0,
    },
    pricePerHour: quote.pricePerHour,
    stoppedPricePerHour: quote.stoppedPricePerHour,
    markupPercent,
    vramShortfall,
    // Nothing to bill means nothing was picked — the caller refuses rather
    // than creating a machine that runs for free.
    empty: quote.pricePerHour <= 0,
  };
};

module.exports = { listBuildableComponents, priceCustomBuild, totalVramOf };
