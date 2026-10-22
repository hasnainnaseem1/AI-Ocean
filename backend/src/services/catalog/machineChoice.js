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
 * What this machine costs where the customer wants it.
 *
 * ── Why a rate now depends on a region ──
 *
 * The same tier is a different machine on each cloud (`m6i.large` here,
 * `e2-standard-2` there) at a different rate, and a different rate again in
 * each region — and on AWS each region carries a standing NAT charge of its
 * own. One number for everywhere means under-charging in at least one of them.
 *
 * ── The three answers, in order ──
 *
 *   a region was asked for   that place's price, or a refusal if it is not
 *                            somewhere this can actually be built
 *   no region yet            the cheapest place, so the figure first shown is
 *                            one the customer could really get
 *   no prices at all         the tier's own catalogue rate, for a platform
 *                            that has not connected a cloud yet
 *
 * ── Why an unknown region is refused rather than defaulted ──
 *
 * The controller used to accept whatever region string arrived and fall back
 * to `regions[0]`, so a customer asking for somewhere we cannot build was
 * silently given somewhere else — at a price quoted for the place they did not
 * get. Being told no is the better outcome of the two.
 */
const rateForPlace = async ({ tier, model, settings, region, fallbackRate }) => {
  const tierPriceService = require('../cloud/tierPriceService');

  const offer = await tierPriceService.offerFor({ tier, model, settings })
    .catch((err) => {
      // Pricing must never be the reason an order cannot be placed at all.
      console.error(`[MachineChoice] Could not price ${tier.name}:`, err.message);
      return null;
    });

  const stoppedFallback = catalogService.stoppedRateForTier(model, tier) || 0;

  if (!offer || !offer.places.length) {
    return {
      rate: fallbackRate,
      stoppedRate: stoppedFallback,
      places: (tier.regions || []).map((r) => ({
        region: r, pricePerHour: fallbackRate, stoppedPricePerHour: stoppedFallback, regionBuilt: false,
      })),
      cloud: offer?.cloud ?? null,
      source: 'tier',
    };
  }

  if (!region) {
    // The cheapest, because `places` comes back sorted and the first thing a
    // customer sees should be a price they can actually have.
    const cheapest = offer.places[0];
    return {
      rate: cheapest.pricePerHour,
      stoppedRate: cheapest.stoppedPricePerHour,
      places: offer.places,
      cloud: offer.cloud,
      source: offer.source,
    };
  }

  const place = offer.places.find((p) => p.region === region);
  if (!place) {
    const available = offer.places.map((p) => p.region);
    return {
      error: fail(400, 'REGION_NOT_AVAILABLE',
        available.length
          ? `${tier.name} cannot be deployed in "${region}". It is available in ${available.join(', ')}.`
          : `${tier.name} cannot be deployed anywhere just now. Please choose another machine.`),
    };
  }

  return {
    rate: place.pricePerHour,
    stoppedRate: place.stoppedPricePerHour,
    places: offer.places,
    cloud: offer.cloud,
    source: offer.source,
  };
};

/**
 * @param {Object}  params
 * @param {Object}  params.model        already loaded and known active
 * @param {String}  [params.tierId]     a catalogue machine's id or slug
 * @param {Object}  [params.customBuild] `{ picks: [{ componentId, quantity }] }`
 * @param {Object}  params.settings     billing settings, already loaded
 * @param {Boolean} [params.requireBookable] true at create time, false for a
 *   quote — stock is transient, and refusing to even price an out-of-stock
 *   machine tells the customer nothing useful.
 * @param {String}  [params.region]     where the customer wants it. The same
 *   machine costs a different amount on each cloud and in each region, so the
 *   rate depends on this — see `cloud/tierPriceService.offerFor`. Omitted for a
 *   first quote, where the cheapest place is used so the figure shown is the
 *   one the customer could actually get.
 */
const resolve = async ({
  model, tierId, customBuild: build, settings, requireBookable = false, region = null,
}) => {
  if (build && Array.isArray(build.picks) && build.picks.length) {
    return resolveCustom({ model, build, settings });
  }
  return resolveCatalogue({ model, tierId, settings, requireBookable, region });
};

const resolveCatalogue = async ({ model, tierId, settings, requireBookable, region = null }) => {
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

  /*
   * What this machine costs where the customer wants it.
   *
   * `listRate` above was `tier.pricePerHour x the model's multiplier` — one
   * number for everywhere. That was right when there was one cloud and one
   * region; now the same machine costs a different amount on each cloud and in
   * each region, and quoting one figure means under-charging in at least one
   * of them.
   */
  const offer = await rateForPlace({ tier, model, settings, region, fallbackRate: listRate });
  if (offer.error) return offer.error;

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
        // Carried through so the deployment's snapshot is complete. It used to
        // be dropped here, which meant a catalogue deployment had no record of
        // the bandwidth it was sold — only custom builds kept it, inside their
        // parts list.
        networkGbps: tier.networkGbps,
      },
      listRate: offer.rate,
      listStoppedRate: offer.stoppedRate,
      currency: tier.currency || settings.currency,
      // Where this can actually be built, each with its own price. The bare
      // `tier.regions` list is no longer enough: a region the tier is sold in
      // but which has no sellable price is not somewhere an order can be taken.
      regions: offer.places.map((p) => p.region),
      places: offer.places,
      cloud: offer.cloud,
      priceSource: offer.source,
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

  /*
   * The model's other floors, checked for the same reason as VRAM.
   *
   * A model needing two cards does not need them because of anyone's traffic —
   * the weights do not fit on one. Built short, the machine is provisioned,
   * starts charging by the hour, and then fails to load: the one outcome where
   * a customer pays for something that was never going to work.
   *
   * Only what the MODEL states. What the customer's answers imply is advice —
   * the sizing engine ranks on it and warns, and this platform does not refuse
   * an order because somebody's traffic estimate suggested something larger.
   */
  const built = priced.specs || {};
  const shortfalls = [
    ['accelerators', model.minGpuCount, built.gpuCount, ''],
    ['vCPU', model.minVcpu, built.vcpu, ''],
    ['RAM', model.minRamGb, built.ramGb, ' GB'],
  ].filter(([, needs, has]) => Number(needs) > 0 && Number(has || 0) < Number(needs));

  if (shortfalls.length) {
    const said = shortfalls
      .map(([what, needs, has, unit]) => `${needs}${unit} of ${what} (this has ${has || 0}${unit})`)
      .join(', ');
    return fail(400, 'CUSTOM_BUILD_TOO_SMALL',
      `${model.name} needs at least ${said}. It would not run. Please build a larger machine.`);
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
        networkGbps: priced.specs.networkGbps,
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
