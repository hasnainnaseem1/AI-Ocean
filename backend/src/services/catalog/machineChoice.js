/**
 * "Which machine is this order for, and what does it cost?"
 *
 * There are two answers now — a machine from the catalogue, or one the
 * customer assembled themselves in the builder — and three callers that all
 * have to reach the same number: the checkout quote, the deployment that gets
 * created, and the hourly billing that follows. If the quote and the create
 * resolved the machine independently, the platform would eventually show one
 * price and charge another, which is the single worst bug this area can have.
 *
 * So both callers ask this module and nothing else. It returns either a
 * refusal with the status and message to send back verbatim, or one machine
 * shape that covers both kinds:
 *
 *   { isCustom, tierId, name, categoryName, specs, listRate, listStoppedRate,
 *     currency, regions, bookable, customBuild }
 *
 * `listRate` is always the pre-discount, per-hour list price for this exact
 * model+machine pair. The plan discount is applied by the caller, once, the
 * same way it always was.
 */
const catalogService = require('./catalogService');
const customBuild = require('./customBuild');

/** Every region this platform actually operates in, for a custom machine.
 *
 * A catalogue machine carries its own `regions`; a custom one has no row to
 * carry them, and offering no region at all would leave the customer with a
 * blank selector. The union of the active catalogue's regions is the honest
 * answer: those are the places hardware is known to exist. */
const platformRegions = async () => {
  const tiers = await catalogService.listActiveTiers();
  const seen = new Set();
  tiers.forEach((t) => (t.regions || []).forEach((r) => seen.add(r)));
  return [...seen];
};

const fail = (status, code, message) => ({ error: { status, code, message } });

/**
 * @param {Object}  params
 * @param {Object}  params.model        already loaded and known active
 * @param {String}  [params.tierId]     a catalogue machine's id or slug
 * @param {Object}  [params.customBuild] `{ picks: [{ componentId, quantity }] }`
 * @param {Object}  params.settings     billing settings, already loaded
 * @param {Boolean} [params.requireBookable] true at create time, false for a
 *   quote — stock is transient, and refusing to even price an out-of-stock
 *   machine tells the customer nothing useful.
 */
const resolve = async ({
  model, tierId, customBuild: build, settings, requireBookable = false,
}) => {
  if (build && Array.isArray(build.picks) && build.picks.length) {
    return resolveCustom({ model, build, settings });
  }
  return resolveCatalogue({ model, tierId, settings, requireBookable });
};

const resolveCatalogue = async ({ model, tierId, settings, requireBookable }) => {
  if (!tierId) {
    return fail(400, 'TIER_REQUIRED', 'Please choose a machine for this deployment.');
  }

  const tier = await catalogService.findTierByIdentifier(tierId);
  if (!tier || !tier.isActive) {
    return fail(404, 'TIER_NOT_FOUND', 'Tier not found or unavailable');
  }

  // The machine must actually be one this model is offered on.
  const listRate = catalogService.rateForTier(model, tier);
  if (listRate === null) {
    return fail(400, 'TIER_NOT_SUPPORTED',
      `${model.name} cannot be deployed on ${tier.name}. Please choose a supported configuration.`);
  }

  if (requireBookable && !catalogService.isBookable(tier)) {
    return fail(409, 'TIER_UNAVAILABLE',
      `${tier.name} is currently out of stock. Please choose another configuration.`);
  }

  const category = tier.categoryId
    ? await catalogService.findTierCategoryById(tier.categoryId)
    : null;

  return {
    machine: {
      isCustom: false,
      tierId: tier.id,
      name: tier.name,
      categoryName: category?.name || '',
      specs: {
        gpuModel: tier.gpuModel,
        gpuCount: tier.gpuCount,
        vramGb: tier.vramGb,
        vcpu: tier.vcpu,
        ramGb: tier.ramGb,
        storageGb: tier.storageGb,
        storageType: tier.storageType,
      },
      listRate,
      listStoppedRate: catalogService.stoppedRateForTier(model, tier) || 0,
      currency: tier.currency || settings.currency,
      regions: tier.regions || [],
      bookable: catalogService.isBookable(tier),
      customBuild: null,
    },
  };
};

const resolveCustom = async ({ model, build, settings }) => {
  if (settings.customBuild?.enabled === false) {
    return fail(403, 'CUSTOM_BUILD_DISABLED',
      'Custom machines are not available on this platform right now.');
  }

  const priced = await customBuild.priceCustomBuild(build.picks, { model, settings });

  if (priced.empty) {
    return fail(400, 'CUSTOM_BUILD_EMPTY',
      'This machine has nothing in it. Add at least one component before deploying.');
  }

  /*
   * The one thing a custom machine is not allowed to be: too small to load the
   * model. Everything else about the builder is deliberately unconstrained —
   * the customer can overbuy, underbuy CPU, take a tiny disk — but a machine
   * below the model's VRAM floor cannot run it at all. It would be provisioned,
   * start charging by the hour, and then fail, which is the one outcome where
   * the customer pays for something that was never going to work.
   */
  if (priced.vramShortfall) {
    const { needsVramGb, totalVramGb } = priced.vramShortfall;
    return fail(400, 'CUSTOM_BUILD_VRAM_SHORT',
      `${model.name} needs at least ${needsVramGb} GB of VRAM and this machine has ${totalVramGb} GB. `
      + 'It would not load. Please add accelerators or choose a larger one.');
  }

  return {
    machine: {
      isCustom: true,
      // No catalogue row exists, so no FK. `isCustom` is what tells a reader
      // this was built to order rather than pointing at a machine that was
      // later deleted — both leave `tierId` null.
      tierId: null,
      name: 'Custom machine',
      categoryName: 'Custom',
      specs: {
        gpuModel: priced.specs.gpuModel,
        gpuCount: priced.specs.gpuCount,
        vramGb: priced.specs.vramGb,
        vcpu: priced.specs.vcpu,
        ramGb: priced.specs.ramGb,
        storageGb: priced.specs.storageGb,
        storageType: priced.specs.storageType,
      },
      listRate: priced.pricePerHour,
      listStoppedRate: priced.stoppedPricePerHour,
      currency: settings.currency,
      regions: await platformRegions(),
      bookable: true,
      // The parts list, kept verbatim on the deployment: this is what the
      // admin actually has to provision, and no catalogue row will ever
      // reconstruct it for them.
      customBuild: {
        picks: priced.picks,
        lines: priced.lines,
        markupPercent: priced.markupPercent,
        networkGbps: priced.specs.networkGbps,
        totalVramGb: priced.specs.totalVramGb,
      },
    },
  };
};

module.exports = { resolve, platformRegions };
