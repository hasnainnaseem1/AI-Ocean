/**
 * Catalog Controller
 *
 * Read-only view of the AI model catalog for signed-in customers.
 *
 * Prices are resolved server-side: the tier's hourly rate × the model's
 * multiplier, then minus the customer's plan discount in hybrid mode. The
 * frontend never computes a price, so what's quoted is what gets billed.
 */
const catalogService = require('../../services/catalog/catalogService');
const billingModeService = require('../../services/billing/billingModeService');
const { totalVram } = require('../../services/recommendation/tierFacts');
const customBuild = require('../../services/catalog/customBuild');

const round4 = (n) => Math.round(n * 10000) / 10000;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * How many hours a "per month" price is quoted over. Taken from the billing
 * settings rather than written as 730 in each place that needs it — the same
 * number decides what a month costs on the billing page, and the catalogue
 * must not be able to quote a different month from the one that gets billed.
 */
const HOURS_PER_MONTH = billingModeService.DEFAULTS.hoursPerMonth;

/**
 * Every rate a customer is quoted for one machine, derived from the single
 * hourly rate that is actually charged.
 *
 * Per-day and per-month figures are convenience views of the hourly rate and
 * nothing else — this platform only ever bills by the hour. They are computed
 * here, on the server, because the client is not allowed to work a price out
 * for itself: what is quoted has to be what gets billed.
 */
const priceLadder = (rate, stoppedRate) => ({
  pricePerHour: rate,
  pricePerDay: round2(rate * 24),
  pricePerMonth: round2(rate * HOURS_PER_MONTH),
  // What holding this machine costs while it is paused or stopped — the
  // compute is released, the disk is not.
  stoppedPricePerHour: stoppedRate,
  stoppedPricePerMonth: round2(stoppedRate * HOURS_PER_MONTH),
});

/**
 * Categories are a handful of documents that change about never, so a plain
 * id→document map per request is cheaper than a populate on every tier.
 */
const categoryMap = async () => {
  const categories = await catalogService.listActiveTierCategories();
  return new Map(categories.map((c) => [String(c.id), c]));
};

const categoryOf = (tier, categories) => {
  const found = tier.categoryId && categories?.get(String(tier.categoryId));
  return found ? { name: found.name, slug: found.slug, color: found.color } : null;
};

/**
 * Build the list of tiers a model can run on, with prices already discounted.
 *
 * Two rates come back for every option: `pricePerHour` while the deployment
 * runs, and `stoppedPricePerHour` for what the customer keeps paying to hold
 * their disk while it is paused or stopped. The model's price multiplier
 * applies to both — it prices the machine, not just the compute.
 */
const buildTierOptions = (model, tiers, discountPercent, categories = null) => {
  return (model.supportedTiers || [])
    .map((link) => {
      const tier = tiers.find((t) => t.id.toString() === link.tierId.toString());
      if (!tier || !tier.isActive) return null;

      const multiplier = link.priceMultiplier == null ? 1 : link.priceMultiplier;
      const listRate = round4(tier.pricePerHour * multiplier);
      const rate = round4(listRate * (1 - discountPercent / 100));

      const listStoppedRate = round4((tier.stoppedPricePerHour || 0) * multiplier);
      const stoppedRate = round4(listStoppedRate * (1 - discountPercent / 100));

      const gpuCount = tier.gpuCount == null ? 1 : tier.gpuCount;
      const machineVram = totalVram(tier);

      return {
        tierId: tier.id,
        name: tier.name,
        slug: tier.slug,
        category: categoryOf(tier, categories),
        gpuModel: tier.gpuModel,
        gpuCount,
        // Per accelerator, and across the whole machine. Both, because a
        // customer sizing a model cares about the total while someone reading
        // the spec sheet cares about the card.
        vramGb: tier.vramGb,
        totalVramGb: machineVram,
        vcpu: tier.vcpu,
        ramGb: tier.ramGb,
        storageGb: tier.storageGb,
        storageType: tier.storageType,
        regions: tier.regions,
        status: tier.status,
        availableUnits: catalogService.availableUnits(tier),
        recommended: link.recommended,
        notes: link.notes,
        // Warn rather than block — the admin may still accept an undersized request
        underpowered: model.minVramGb > 0 && machineVram < model.minVramGb,
        listPricePerHour: listRate,
        ...priceLadder(rate, stoppedRate),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.pricePerHour - b.pricePerHour);
};

const serializeModel = (model, tierOptions, { full = false } = {}) => {
  const base = {
    id: model.id,
    name: model.name,
    slug: model.slug,
    family: model.family,
    version: model.version,
    shortDescription: model.shortDescription,
    logoUrl: model.logoUrl,
    modalities: model.modalities,
    parameterSize: model.parameterSize,
    contextLength: model.contextLength,
    status: model.status,
    category: model.category,
    tags: model.tags,
    isFeatured: model.isFeatured,
    startingPricePerHour: tierOptions.length ? tierOptions[0].pricePerHour : null,
    tierCount: tierOptions.length,
  };

  if (!full) return base;

  return {
    ...base,
    description: model.description,
    docsUrl: model.docsUrl,
    huggingFaceId: model.huggingFaceId,
    license: model.license,
    minVramGb: model.minVramGb,
    tiers: tierOptions,
  };
};

/**
 * GET /api/v1/customer/catalog/models
 */
const getModels = async (req, res) => {
  try {
    const { family, modality, search } = req.query;

    const [models, tiers, discountPercent, categories] = await Promise.all([
      catalogService.listActiveModels({ family, modality, search }),
      catalogService.listActiveTiers(),
      billingModeService.getPlanDiscount(req.user),
      categoryMap(),
    ]);

    const data = models.map((model) =>
      serializeModel(model, buildTierOptions(model, tiers, discountPercent, categories))
    );

    res.json({
      success: true,
      models: data,
      discountPercent,
      total: data.length,
    });
  } catch (error) {
    console.error('Get catalog models error:', error);
    res.status(500).json({ success: false, message: 'Error fetching model catalog' });
  }
};

/**
 * GET /api/v1/customer/catalog/models/:slug
 */
const getModel = async (req, res) => {
  try {
    const model = await catalogService.findActiveModelBySlug(req.params.slug);
    if (!model) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }

    const [tiers, discountPercent, categories] = await Promise.all([
      catalogService.listActiveTiers(),
      billingModeService.getPlanDiscount(req.user),
      categoryMap(),
    ]);

    res.json({
      success: true,
      model: serializeModel(
        model,
        buildTierOptions(model, tiers, discountPercent, categories),
        { full: true }
      ),
      discountPercent,
    });
  } catch (error) {
    console.error('Get catalog model error:', error);
    res.status(500).json({ success: false, message: 'Error fetching model' });
  }
};

/**
 * ── The customer-safe view of a machine ──
 *
 * A whitelist, deliberately, and never a spread of the service's tier JSON.
 * `toTierJSON` carries things a customer must not see: the pricing mode and
 * markup percentage, the component bill of materials with a per-unit cost on
 * every line, raw capacity counts, internal metadata and the audit trail. The
 * public catalogue route does spread it, and leaks all of that to anyone who
 * asks — a separate problem, but the reason this one is built the other way
 * round. If a field is not named here, it does not reach a customer.
 *
 * Used by both the list and the detail handler so the two cannot drift.
 */
const serializeTier = (tier, categories, discountPercent, models = []) => {
  const discounted = (n) => round4((n || 0) * (1 - discountPercent / 100));
  const rate = discounted(tier.pricePerHour);
  const stoppedRate = discounted(tier.stoppedPricePerHour);

  return {
    id: tier.id,
    name: tier.name,
    slug: tier.slug,
    description: tier.description,
    category: categoryOf(tier, categories),

    gpuModel: tier.gpuModel,
    gpuCount: tier.gpuCount,
    vramGb: tier.vramGb,               // per accelerator
    totalVramGb: totalVram(tier),      // across the whole machine
    vcpu: tier.vcpu,
    ramGb: tier.ramGb,
    storageGb: tier.storageGb,
    storageType: tier.storageType,
    networkGbps: tier.networkGbps,
    regions: tier.regions,

    status: tier.status,
    // Whether one can actually be ordered right now, and how many are left —
    // `null` units means the platform does not track stock for this machine,
    // which is not the same as "none left".
    bookable: catalogService.isBookable(tier),
    availableUnits: catalogService.availableUnits(tier),

    currency: tier.currency,
    listPricePerHour: tier.pricePerHour,
    listStoppedPricePerHour: tier.stoppedPricePerHour || 0,
    ...priceLadder(rate, stoppedRate),

    models,
    modelCount: models.length,
  };
};

/**
 * GET /api/v1/customer/catalog/tiers
 *
 * The machine catalogue: every machine the platform offers, what is in it,
 * what it costs, and which models run on it. One request powers the whole
 * page — including the model lists, which come from a single reverse query
 * rather than one per machine.
 */
const getTiers = async (req, res) => {
  try {
    const [tiers, discountPercent, categories] = await Promise.all([
      catalogService.listActiveTiers({ orderByPrice: true }),
      billingModeService.getPlanDiscount(req.user),
      categoryMap(),
    ]);

    const modelsByTier = await catalogService.listModelsByTier(tiers.map((t) => t.id));

    res.json({
      success: true,
      discountPercent,
      // So the page can label a monthly figure with the hours it is quoted
      // over instead of implying a calendar month.
      hoursPerMonth: HOURS_PER_MONTH,
      tiers: tiers.map((t) => serializeTier(
        t,
        categories,
        discountPercent,
        // The list only needs enough to render a count and a tooltip; the
        // per-model pricing is the detail page's job.
        (modelsByTier.get(t.id) || []).map((m) => ({
          id: m.id, name: m.name, slug: m.slug, family: m.family, recommended: m.recommended,
        })),
      )),
    });
  } catch (error) {
    console.error('Get tiers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tiers' });
  }
};

/**
 * GET /api/v1/customer/catalog/tiers/:identifier
 *
 * One machine in full, with every model that runs on it priced for THAT
 * machine — a model's price multiplier applies to the whole machine, not just
 * its compute, so the same model costs differently on different hardware.
 */
const getTier = async (req, res) => {
  try {
    const tier = await catalogService.findTierByIdentifier(req.params.identifier);

    /*
     * `findTierByIdentifier` does not filter on `isActive` — it is also used by
     * admin paths that must see disabled machines. Without this guard a machine
     * the admin has taken off the catalogue would still be readable by anyone
     * who knew its slug.
     */
    if (!tier || !tier.isActive) {
      return res.status(404).json({ success: false, message: 'Machine not found' });
    }

    const [discountPercent, categories, modelsByTier] = await Promise.all([
      billingModeService.getPlanDiscount(req.user),
      categoryMap(),
      catalogService.listModelsByTier([tier.id]),
    ]);

    const discounted = (n) => round4((n || 0) * (1 - discountPercent / 100));
    const machineVram = totalVram(tier);

    const models = (modelsByTier.get(tier.id) || []).map((m) => {
      const rate = discounted(round4(tier.pricePerHour * m.priceMultiplier));
      const stoppedRate = discounted(round4((tier.stoppedPricePerHour || 0) * m.priceMultiplier));

      return {
        id: m.id,
        name: m.name,
        slug: m.slug,
        family: m.family,
        status: m.status,
        shortDescription: m.shortDescription,
        recommended: m.recommended,
        notes: m.notes,
        // Warn rather than hide — an undersized machine may still be what the
        // customer wants, and the deploy journey makes the same call.
        underpowered: m.minVramGb > 0 && machineVram < m.minVramGb,
        currency: tier.currency,
        // The multiplier itself stays internal; the resulting rate is the only
        // number the customer has any use for.
        ...priceLadder(rate, stoppedRate),
      };
    });

    res.json({
      success: true,
      discountPercent,
      hoursPerMonth: HOURS_PER_MONTH,
      tier: serializeTier(tier, categories, discountPercent, models),
    });
  } catch (error) {
    console.error('Get tier error:', error);
    res.status(500).json({ success: false, message: 'Error fetching machine' });
  }
};


/**
 * GET /api/v1/customer/catalog/custom-build
 *
 * The parts a customer may assemble their own machine from, and the shape of
 * each slider. Prices are deliberately NOT included: the total comes from the
 * quote endpoint below, computed by the same function that prices the
 * catalogue's own machines, so the browser can never quote a number the
 * platform would not bill.
 */
const getCustomBuildOptions = async (req, res) => {
  try {
    const settings = await billingModeService.getBillingSettings();
    if (settings.customBuild?.enabled === false) {
      return res.status(403).json({
        success: false,
        code: 'CUSTOM_BUILD_DISABLED',
        message: 'Custom machines are not available on this platform right now.',
      });
    }

    res.json({
      success: true,
      currency: (settings.currency || 'usd').toUpperCase(),
      hoursPerMonth: HOURS_PER_MONTH,
      components: await customBuild.listBuildableComponents(),
    });
  } catch (error) {
    console.error('Get custom build options error:', error);
    res.status(500).json({ success: false, message: 'Error loading the machine builder' });
  }
};

/**
 * POST /api/v1/customer/catalog/custom-build/quote
 *
 * What the picks on screen would cost, and what machine they add up to.
 * Called as the customer moves a slider, so it stays cheap: component reads
 * and arithmetic, no writes, nothing persisted.
 */
const quoteCustomBuild = async (req, res) => {
  try {
    const settings = await billingModeService.getBillingSettings();
    if (settings.customBuild?.enabled === false) {
      return res.status(403).json({
        success: false,
        code: 'CUSTOM_BUILD_DISABLED',
        message: 'Custom machines are not available on this platform right now.',
      });
    }

    // Optional: with a model in hand the quote can also say whether the
    // machine could actually load it.
    const model = req.body.modelId
      ? await catalogService.findModelByIdentifier(req.body.modelId)
      : null;

    const build = await customBuild.priceCustomBuild(req.body.picks, { model, settings });

    res.json({
      success: true,
      currency: (settings.currency || 'usd').toUpperCase(),
      hoursPerMonth: HOURS_PER_MONTH,
      specs: build.specs,
      lines: build.lines,
      dropped: build.dropped,
      vramShortfall: build.vramShortfall,
      empty: build.empty,
      ...priceLadder(build.pricePerHour, build.stoppedPricePerHour),
    });
  } catch (error) {
    console.error('Quote custom build error:', error);
    res.status(500).json({ success: false, message: 'Error pricing this machine' });
  }
};

module.exports = {
  getModels,
  getModel,
  getTiers,
  getTier,
  getCustomBuildOptions,
  quoteCustomBuild,
  // Shared with the public (unauthenticated) catalog routes
  buildTierOptions,
  serializeModel,
};
