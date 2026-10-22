/**
 * AWS Price List Query API -> rates the cost model can use.
 *
 * The AWS twin of `gcpSkuParser.js`, and a file of its own for the same
 * reason: picking the right price out of what AWS returns is fiddly string and
 * shape work, and it is the only part that can be tested without an account.
 *
 * ── The shape AWS returns ──
 *
 * `GetProducts` answers with `PriceList`: an array of **JSON strings**, each of
 * which parses to
 *
 *   {
 *     product: {
 *       sku: "ABC123",
 *       productFamily: "Compute Instance",
 *       attributes: {
 *         instanceType: "m6i.xlarge",
 *         operatingSystem: "Linux",
 *         tenancy: "Shared",
 *         preInstalledSw: "NA",
 *         capacitystatus: "Used",
 *         regionCode: "eu-west-1",
 *         ...
 *       }
 *     },
 *     terms: {
 *       OnDemand: {
 *         "ABC123.JRTCKXETXF": {
 *           priceDimensions: {
 *             "ABC123.JRTCKXETXF.6YS6EN2CT7": {
 *               unit: "Hrs",
 *               pricePerUnit: { USD: "0.1920000000" }
 *             }
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * ── The five attributes that decide whether a price is the RIGHT price ──
 *
 * One instance type has dozens of prices in the catalogue, and only one of
 * them is what this platform will be charged. Each filter below removes a
 * whole family of wrong answers:
 *
 *   - `operatingSystem: Linux`   — a Windows price includes a licence, and is
 *                                  roughly double.
 *   - `preInstalledSw: NA`       — SQL Server pre-installed is a different,
 *                                  far larger number for the same hardware.
 *   - `tenancy: Shared`          — Dedicated and Host are priced separately
 *                                  and much higher.
 *   - `capacitystatus: Used`     — `UnusedCapacityReservation` and
 *                                  `AllocatedCapacityReservation` are
 *                                  reservation accounting, not what an
 *                                  on-demand launch costs.
 *   - `licenseModel: No License required` — belt and braces alongside the OS
 *                                  filter.
 *
 * Miss any one and the number that comes back is confidently wrong rather than
 * absent — which is the failure mode the margin guard cannot protect against,
 * because it is being fed the bad figure.
 *
 * Pure: no network, no clock.
 */

/** What an on-demand, Linux, shared-tenancy, no-extras instance looks like. */
const ON_DEMAND_INSTANCE = {
  operatingSystem: 'Linux',
  preInstalledSw: 'NA',
  tenancy: 'Shared',
  capacitystatus: 'Used',
};

/** Entries come back as JSON strings; tolerate already-parsed objects too. */
const parseEntry = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'object') return entry;
  try {
    return JSON.parse(entry);
  } catch {
    return null;
  }
};

/**
 * The on-demand price out of a product's `terms`.
 *
 * Walks both nested maps rather than indexing by the known offer-term code
 * (`JRTCKXETXF`), because that code is an AWS implementation detail and
 * hardcoding it would break silently the day it changes.
 */
const onDemandPrice = (product, currency = 'USD') => {
  const offers = product?.terms?.OnDemand;
  if (!offers || typeof offers !== 'object') return null;

  for (const offer of Object.values(offers)) {
    const dims = offer?.priceDimensions;
    if (!dims || typeof dims !== 'object') continue;

    for (const dim of Object.values(dims)) {
      const raw = dim?.pricePerUnit?.[currency];
      if (raw === undefined || raw === null) continue;

      const n = Number(raw);
      if (!Number.isFinite(n)) continue;

      /*
       * A free tier of zero IS a real published price, so 0 is kept. What is
       * skipped is a dimension with no price at all.
       */
      return { price: n, unit: dim.unit || '', description: dim.description || '' };
    }
  }
  return null;
};

/** Does this product's attributes match every filter? */
const matchesAll = (attributes, filters) =>
  Object.entries(filters).every(([k, v]) =>
    String(attributes?.[k] ?? '').toLowerCase() === String(v).toLowerCase());

/**
 * The hourly price for one instance type.
 *
 * @param {Array} priceList  whatever `GetProducts` returned
 * @param {object} opts
 * @param {string} opts.instanceType  e.g. "m6i.xlarge"
 * @param {string} [opts.regionCode]  e.g. "eu-west-1"
 * @param {string} [opts.currency]
 * @returns {{ok, instanceHour, currency, matched, notes}}
 */
const instanceRateFrom = (priceList, { instanceType, regionCode, currency = 'USD' } = {}) => {
  const notes = [];
  const wanted = String(instanceType || '').trim();

  if (!wanted) {
    return { ok: false, instanceHour: null, currency, matched: null, notes: ['No instance type given.'] };
  }

  const candidates = [];

  for (const entry of Array.isArray(priceList) ? priceList : []) {
    const product = parseEntry(entry);
    const attributes = product?.product?.attributes;
    if (!attributes) continue;

    if (String(attributes.instanceType || '') !== wanted) continue;

    // Region, when the caller pinned one. `regionCode` is used rather than
    // `location` ("EU (Ireland)") because the long names are prose and change.
    if (regionCode && String(attributes.regionCode || '') !== regionCode) continue;

    if (!matchesAll(attributes, ON_DEMAND_INSTANCE)) continue;

    const priced = onDemandPrice(product, currency);
    if (!priced) continue;

    /*
     * The unit must be hours. A price quoted per-second or per-request for the
     * same SKU would otherwise be read as an hourly rate and be out by orders
     * of magnitude.
     */
    if (priced.unit && !/^hrs?$/i.test(priced.unit)) {
      notes.push(`Skipped a ${wanted} price quoted per "${priced.unit}" rather than per hour.`);
      continue;
    }

    candidates.push({ price: priced.price, sku: product.product.sku, attributes });
  }

  if (!candidates.length) {
    return {
      ok: false,
      instanceHour: null,
      currency,
      matched: null,
      notes: [...notes, `No on-demand Linux price found for "${wanted}"`
        + `${regionCode ? ` in ${regionCode}` : ''}.`],
    };
  }

  /*
   * More than one survivor means a filter is not narrow enough. Taking the
   * LOWEST would understate cost, and understating is the direction that
   * approves a loss-making tier — so the highest wins and the ambiguity is
   * reported rather than hidden.
   */
  candidates.sort((a, b) => b.price - a.price);
  if (candidates.length > 1) {
    notes.push(`${candidates.length} on-demand prices matched "${wanted}"; using the highest `
      + `(${candidates[0].price}) so the margin guard is not fed an understated cost.`);
  }

  return {
    ok: true,
    instanceHour: candidates[0].price,
    currency,
    matched: { sku: candidates[0].sku, instanceType: wanted },
    notes,
  };
};

/**
 * EBS volume prices, keyed by the platform's own storage labels.
 *
 * Keyed by LABEL rather than by AWS's `volumeApiName`, deliberately: the cost
 * model looks a rate up by the name on the tier ("NVMe SSD"), and the mapping
 * from that name to an EBS type lives in `awsMachineCatalog.VOLUME_TYPES`.
 * Deriving the keys from that one table is what stops the two drifting — the
 * exact bug that shipped once on the GCP side, where the parser invented its
 * own disk vocabulary and priced tiers against disks nobody was building.
 */
const VOLUME_TYPES = require('./awsMachineCatalog').VOLUME_TYPES;

const volumeRatesFrom = (priceList, { regionCode, currency = 'USD' } = {}) => {
  const byApiName = {};

  for (const entry of Array.isArray(priceList) ? priceList : []) {
    const product = parseEntry(entry);
    const attributes = product?.product?.attributes;
    if (!attributes) continue;

    if (String(product.product.productFamily || '') !== 'Storage') continue;
    if (regionCode && String(attributes.regionCode || '') !== regionCode) continue;

    const apiName = String(attributes.volumeApiName || '');
    if (!apiName) continue;

    const priced = onDemandPrice(product, currency);
    if (!priced) continue;

    // EBS capacity is quoted per GB-month. Anything else here is IOPS or
    // throughput, which are billed separately and are not capacity.
    if (priced.unit && !/GB-?Mo/i.test(priced.unit)) continue;

    if (byApiName[apiName] === undefined) byApiName[apiName] = priced.price;
  }

  /*
   * Translate into the platform's own labels, using the same table that
   * decides what gets BUILT. A label whose EBS type has no price simply does
   * not appear, and the cost model refuses rather than guessing.
   */
  const diskGbMonth = {};
  const notes = [];
  for (const v of VOLUME_TYPES) {
    if (byApiName[v.type] !== undefined) {
      diskGbMonth[v.label] = byApiName[v.type];
    } else {
      notes.push(`No ${v.type} price found, so "${v.label}" tiers cannot be costed.`);
    }
  }

  return { diskGbMonth, byApiName, notes };
};

/**
 * Everything the cost model needs, from one price list.
 *
 * @returns {{rates: object, matched: object, notes: string[]}}
 */
const ratesFromPriceList = (priceList, { instanceType, regionCode, currency = 'USD' } = {}) => {
  const instance = instanceRateFrom(priceList, { instanceType, regionCode, currency });
  const volumes = volumeRatesFrom(priceList, { regionCode, currency });

  return {
    rates: {
      // The whole machine, AWS-style. The cost model skips its component
      // lookups entirely when this is present.
      instanceHour: instance.ok ? instance.instanceHour : null,
      diskGbMonth: volumes.diskGbMonth,
      currency,
    },
    matched: { instance: instance.matched, volumes: volumes.byApiName },
    notes: [...instance.notes, ...volumes.notes],
  };
};

/**
 * What one NAT gateway costs per hour in a region.
 *
 * ── Why this is priced at all ──
 *
 * A NAT gateway is charged whether a customer machine uses it or not: about
 * $0.045 an hour, per availability zone, standing. For a two-zone region that
 * is roughly $65 a month before anyone deploys anything. Priced live for the
 * same reason instances are — a figure typed in by hand goes stale quietly,
 * and a stale figure that is too low prices a whole region below cost.
 *
 * ── Hours, not gigabytes ──
 *
 * `AmazonVPC` also publishes the per-GB data-processing charge, in the same
 * product family. That one scales with traffic nobody can predict per machine,
 * so it is deliberately not taken here; only the dimension billed in hours is.
 * Taking the wrong one would add a per-GB number to an hourly cost and inflate
 * every price in the region by a factor of nothing in particular.
 *
 * @param {Array} priceList  whatever `GetProducts` returned for AmazonVPC
 * @param {object} opts
 * @param {string} opts.regionCode  e.g. "eu-west-1"
 * @returns {{ok, natGatewayHour, currency, matched, notes}}
 */
const natGatewayRateFrom = (priceList, { regionCode, currency = 'USD' } = {}) => {
  const notes = [];
  const candidates = [];

  for (const entry of priceList || []) {
    const product = parseEntry(entry);
    const attributes = product?.product?.attributes;
    if (!attributes) continue;

    if (regionCode && String(attributes.regionCode || '') !== String(regionCode)) continue;

    // The family name AWS publishes for this. Checked rather than assumed,
    // because the same service also carries endpoints and traffic mirroring.
    const family = String(product?.product?.productFamily || '');
    if (!/nat\s*gateway/i.test(family)) continue;

    const priced = onDemandPrice(product, currency);
    if (!priced) continue;

    /*
     * Hours only. `usagetype` reads like `EU-NatGateway-Hours` for the
     * standing charge and `EU-NatGateway-Bytes` for data processing; the unit
     * is the more reliable of the two, so both are checked.
     */
    const unit = String(priced.unit || '').toLowerCase();
    const usage = String(attributes.usagetype || '');
    if (!unit.includes('hour') && !/hours?$/i.test(usage)) continue;

    candidates.push({ price: priced.price, usagetype: usage, unit: priced.unit });
  }

  if (!candidates.length) {
    return {
      ok: false,
      natGatewayHour: null,
      currency,
      matched: null,
      notes,
      reason: `AWS published no NAT gateway hourly price for ${regionCode || 'that region'}.`,
    };
  }

  /*
   * On ambiguity take the HIGHEST, the same rule the instance parser uses. A
   * guess that is too high loses a sale; a guess that is too low loses money
   * on every hour the region is open.
   */
  candidates.sort((a, b) => b.price - a.price);
  if (candidates.length > 1) {
    notes.push(
      `AWS published ${candidates.length} NAT gateway hourly prices for ${regionCode}; `
      + 'took the highest.'
    );
  }

  return {
    ok: true,
    natGatewayHour: candidates[0].price,
    currency,
    matched: candidates[0],
    notes,
    reason: null,
  };
};

module.exports = {
  ON_DEMAND_INSTANCE,
  parseEntry,
  onDemandPrice,
  instanceRateFrom,
  volumeRatesFrom,
  natGatewayRateFrom,
  ratesFromPriceList,
};
