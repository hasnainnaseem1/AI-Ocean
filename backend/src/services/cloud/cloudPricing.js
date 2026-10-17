/**
 * Cloud Pricing
 *
 * The one question the rest of the platform asks: **what does this machine
 * cost us per hour, and what is the lowest we may sell it for?**
 *
 * ── The shape of the answer ──
 *
 * Three sources, tried in order, and which one answered is always reported:
 *
 *   1. **live** — the provider's own API, through a provider module. This is
 *      what "dynamic pricing" means: nobody maintains a price list, and a
 *      change at Google shows up here within the hour.
 *   2. **recorded** — the per-machine-type figures an operator typed into
 *      Admin → Integrations. The fallback while a cloud account is being set
 *      up, and the only source for a provider whose API is not implemented.
 *   3. **unknown** — and then nothing is invented. `capGuard` refuses to build
 *      a machine whose cost nobody can state, because the alternative is
 *      approving exactly the tiers that lose money.
 *
 * ── Multi-provider by construction ──
 *
 * `PROVIDERS` is a registry in the same shape as `provisioningDriver.DRIVERS`,
 * and for the same reason: which cloud the platform is on is a setting, not a
 * constant. Adding AWS is adding a module and a settings entry. Running both at
 * once is two entries — `priceFor` takes the provider name, so nothing above it
 * assumes there is only one.
 *
 * ── What this deliberately does not do ──
 *
 * It does not set prices. It says what something costs and what the floor is;
 * what a tier actually sells for stays an explicit decision in the catalogue.
 * A pricing engine that silently re-prices a customer's tier would change what
 * somebody already bought.
 */
const costModel = require('./costModel');

/**
 * Required of every provider module:
 *
 *   name, label
 *   isConfigured()                        → boolean
 *   fetchRates({ region, machineType })   → { ok, rates, source, notes, reason }
 *   clearCache()
 *
 * Required lazily so that a platform on one cloud does not load the other's
 * client, and so an unimplemented provider costs nothing to have registered.
 */
const PROVIDERS = {
  get gcp() { return require('./providers/gcpPricing'); },
  get aws() { return require('../aws/awsPricing'); },
};

const PROVIDER_NAMES = ['gcp', 'aws'];

const getProvider = (name) =>
  (Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null);

/** The pricing policy — overhead, tax, margin — with safe, inert defaults. */
const policyFrom = (settings) => {
  const p = settings?.cloudPricingSettings || {};
  return {
    overheadPercent: Number(p.overheadPercent) || 0,
    overheadPerHour: Number(p.overheadPerHour) || 0,
    taxPercent: Number(p.taxPercent) || 0,
    targetMarginPercent: Number(p.targetMarginPercent) || 0,
  };
};

/**
 * What one machine costs per hour, and the price floor that follows.
 *
 * @param {object} input
 * @param {string} input.provider      'gcp' | 'aws'
 * @param {string} input.region        the provider's own region name
 * @param {string} input.machineType   the provider's own machine type
 * @param {object} input.components    { vcpu, ramGb, gpuModel, gpuCount, storageGb, storageType }
 * @param {object} [input.settings]    admin settings, re-read if omitted
 * @param {boolean} [input.allowRecorded]  fall back to the typed-in table (default true)
 *
 * @returns {Promise<{ok, source: 'live'|'recorded'|'unknown', cost: object|null,
 *   floorPrice: number|null, currency: string, rates: object|null,
 *   notes: string[], reason: string|null}>}
 */
const costFor = async (input) => {
  const {
    provider: providerName = 'gcp',
    region,
    machineType,
    components = {},
    allowRecorded = true,
  } = input || {};

  const adminSettingsService = require('../admin/adminSettingsService');
  const settings = input?.settings || (await adminSettingsService.getSettings());
  const policy = policyFrom(settings);

  const notes = [];
  const provider = getProvider(providerName);
  if (!provider) {
    return {
      ok: false,
      source: 'unknown',
      cost: null,
      floorPrice: null,
      currency: 'USD',
      rates: null,
      notes,
      reason: `"${providerName}" is not a cloud this platform knows about.`,
    };
  }

  /*
   * ── 1. Live, from the provider ──
   *
   * Two conditions, and they answer different questions:
   *
   *   `livePricingAllowed` — may we ask? An operator's choice. The reason it
   *     exists is that a provider's price API can be *wrong* — a bad SKU
   *     match, a region it has stopped publishing, a figure that is obviously
   *     off — and the fix must not be "disconnect the whole cloud", because
   *     that also stops building machines. Turning this off falls back to the
   *     recorded cost table, which is a number a human put there on purpose.
   *
   *   `isConfigured()` — can we? A fact about credentials.
   *
   * Both must hold. Previously only the second was checked, so the switch on
   * the settings screen was stored and never read — it looked like a control
   * and decided nothing.
   */
  const livePricingAllowed = settings?.cloudPricingSettings?.providers?.[providerName] !== false;

  let live = null;
  if (!livePricingAllowed) {
    notes.push(
      `Live pricing is switched off for ${provider.label}, so the recorded cost table is used. `
      + 'Turn it back on under Cloud → what a machine-hour really costs.'
    );
  }

  if (livePricingAllowed && await provider.isConfigured().catch(() => false)) {
    live = await provider.fetchRates({ region, machineType }).catch((err) => ({
      ok: false, rates: null, notes: [], reason: err.message,
    }));
    if (live?.notes?.length) notes.push(...live.notes);

    if (live?.ok && live.rates) {
      const cost = costModel.costOf({ components, rates: live.rates, policy });
      if (cost.ok) {
        return {
          ok: true,
          source: 'live',
          cost,
          floorPrice: cost.floorPrice,
          currency: cost.currency,
          rates: live.rates,
          notes,
          reason: null,
        };
      }
      /*
       * The provider answered, but not about everything this machine is made
       * of — a GPU it does not publish a price for, say. Fall through rather
       * than failing: a figure an operator recorded by hand is a worse source
       * than the API, and a far better one than nothing.
       */
      notes.push(`Live prices were incomplete: ${cost.missing.join(', ')}.`);
    } else if (live?.reason) {
      notes.push(live.reason);
    }
  }

  // ── 2. Recorded by hand ──
  if (allowRecorded) {
    /*
     * Each cloud has its own table, read from its own settings block. One
     * shared table would be worse than useless: `m6i.xlarge` and `e2-medium`
     * never collide by name, but a figure typed for one cloud appearing under
     * the other's screen is how a price gets attributed to the wrong provider
     * and then defended as "what the table says".
     */
    const table = settings?.[`${providerName}Settings`]?.machineCostPerHour;
    const recorded = table && typeof table === 'object' ? table[machineType] : undefined;
    const rate = costModel.rateOf(recorded);
    if (rate !== null) {
      /*
       * A recorded figure is the provider's charge for the whole machine, not
       * a component rate — so it stands in for `direct.total`, and the
       * platform's own overhead, tax and margin are applied on top exactly as
       * they would be to a live figure. Anything else would make the two
       * sources mean different things.
       */
      const overhead = (rate * policy.overheadPercent) / 100 + policy.overheadPerHour;
      const tax = ((rate + overhead) * policy.taxPercent) / 100;
      const totalCost = Number((rate + overhead + tax).toFixed(6));
      const floorPrice = Number((totalCost * (1 + policy.targetMarginPercent / 100)).toFixed(4));
      return {
        ok: true,
        source: 'recorded',
        cost: {
          ok: true,
          missing: [],
          currency: 'USD',
          /*
           * A recorded figure is a whole-machine price — an operator typing
           * what the machine costs, not a per-core rate — so it is reported
           * under `instance`, exactly as a live AWS price is. The component
           * lines stay null because they are genuinely unknown, and the admin
           * screen can render both sources the same way without caring which
           * one answered.
           */
          direct: { instance: rate, compute: null, memory: null, gpu: null, storage: null, total: rate },
          pricedWholeMachine: true,
          overhead: Number(overhead.toFixed(6)),
          tax: Number(tax.toFixed(6)),
          totalCost,
          marginAmount: Number((floorPrice - totalCost).toFixed(6)),
          floorPrice,
        },
        floorPrice,
        currency: 'USD',
        rates: null,
        notes,
        reason: null,
      };
    }
  }

  // ── 3. Nothing is invented ──
  return {
    ok: false,
    source: 'unknown',
    cost: null,
    floorPrice: null,
    currency: 'USD',
    rates: null,
    notes,
    reason: `No price is available for "${machineType}" on ${provider.label}. `
      + 'Either connect the provider so prices can be read automatically, or record this '
      + 'machine type\'s hourly cost in Admin → Integrations.',
  };
};

/**
 * Is a tier's price healthy against what its machine costs?
 *
 * The question the catalogue screen asks about a price somebody typed, and the
 * one `capGuard` asks before building. One implementation, so the two can never
 * disagree about whether a tier is profitable.
 */
const assess = async (input) => {
  const cost = await costFor(input);
  if (!cost.ok) {
    return { ...cost, verdict: 'unknown', marginPercent: null, shortfall: 0 };
  }
  const price = costModel.assessPrice({ sellPrice: input.sellPrice, cost: cost.cost });
  return { ...cost, ...price };
};

/** Which providers this platform could price, and whether each is ready. */
const providerStatus = async () => {
  const out = [];
  for (const name of PROVIDER_NAMES) {
    const p = getProvider(name);
    out.push({
      name,
      label: p.label,
      configured: await p.isConfigured().catch(() => false),
    });
  }
  return out;
};

const clearCache = () => {
  for (const name of PROVIDER_NAMES) {
    try { getProvider(name).clearCache(); } catch { /* a provider with no cache */ }
  }
};

module.exports = {
  PROVIDER_NAMES,
  getProvider,
  policyFrom,
  costFor,
  assess,
  providerStatus,
  clearCache,
};
