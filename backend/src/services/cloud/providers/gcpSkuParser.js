/**
 * GCP SKU Parser
 *
 * Turns Google's price catalogue into the component rate table `costModel`
 * wants: so much per vCPU-hour, per GB of RAM-hour, per GPU card-hour, per GB
 * of disk-month.
 *
 * ── Why this is a file of its own ──
 *
 * Google does not publish a price for `e2-custom-16-32768`. It publishes
 * thousands of SKUs, and the price of a machine is the sum of the right ones:
 * an "Instance Core" SKU for its family and region, an "Instance Ram" SKU for
 * the same, a GPU SKU per card, a disk SKU per GB. Picking the right ones out
 * of that list is the whole difficulty, and it is pure string and number work —
 * so it lives here, away from the HTTP call, where every case can be asserted
 * against real SKU shapes instead of only being exercised against a live API
 * nobody can run in a test.
 *
 * ── The shape Google returns ──
 *
 *   {
 *     skuId: "D0CB-F2BC-D1A2",
 *     description: "N2 Instance Core running in Netherlands",
 *     category: { resourceFamily: "Compute", resourceGroup: "N2Standard",
 *                 usageType: "OnDemand" },
 *     serviceRegions: ["europe-west4"],
 *     pricingInfo: [{ pricingExpression: {
 *       usageUnit: "h",
 *       tieredRates: [{ startUsageAmount: 0,
 *                       unitPrice: { currencyCode: "USD", units: "0", nanos: 31611000 } }]
 *     }}]
 *   }
 *
 * A price is `units + nanos / 1e9`. `units` is a **string** because it can
 * exceed what JSON numbers hold safely, and `nanos` is where every small price
 * actually lives — a vCPU-hour is entirely nanos, with `units` at "0". Reading
 * only `units` yields zero for almost every compute SKU, which is the single
 * most expensive mistake available in this file.
 *
 * ── What is deliberately ignored ──
 *
 * Anything that is not `OnDemand`: preemptible and spot SKUs are cheaper and we
 * do not buy them (a customer's machine must stay up), so costing against them
 * would understate every machine. Commitment SKUs are ignored for the same
 * reason in reverse — they are an account-level arrangement, and the account
 * price endpoint already reflects it in `contractPrice`.
 */

/** `units` + `nanos` → a number. Both halves, always. */
const priceOf = (unitPrice) => {
  if (!unitPrice) return null;
  const units = Number(unitPrice.units || 0);
  const nanos = Number(unitPrice.nanos || 0);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  return units + nanos / 1e9;
};

/**
 * The first tier's price.
 *
 * Compute SKUs are flat-rate, so there is one tier. Where a SKU is tiered
 * (storage in some regions), tier 0 starts at zero usage and is what a new
 * machine's marginal GB is charged at — using a later, cheaper tier would
 * under-state the cost of the next machine, which is the wrong direction.
 */
const firstTierPrice = (sku) => {
  const expr = sku?.pricingInfo?.[0]?.pricingExpression;
  const tier = expr?.tieredRates?.[0];
  return priceOf(tier?.unitPrice);
};

const currencyOf = (sku) =>
  sku?.pricingInfo?.[0]?.pricingExpression?.tieredRates?.[0]?.unitPrice?.currencyCode || null;

/**
 * Which machine family does a machine type belong to?
 *
 * `e2-medium` → `e2`, `n2-highmem-32` → `n2`, `a2-ultragpu-1g` → `a2`,
 * `e2-custom-16-32768` → `e2`. Google's Core and Ram SKUs are priced per
 * family, so this is what decides which SKUs apply.
 */
const familyOf = (machineType) => {
  const first = String(machineType || '').trim().toLowerCase().split('-')[0];
  return first || '';
};

/**
 * Does this SKU's description name the family we are pricing?
 *
 * Matched on the description rather than on `resourceGroup`, because the group
 * is inconsistent — N1 shared-core SKUs sit in `N1Standard`, E2 in `CPU`, and
 * custom machine types in their own groups. The description always starts with
 * the family: "E2 Instance Core running in …", "N2 Custom Instance Core …".
 *
 * Anchored to a word boundary so `n2` does not match "N2D", which is a
 * different family at a different price.
 */
const describesFamily = (description, family) => {
  if (!family) return false;
  return new RegExp(`^${family}\\b`, 'i').test(String(description || '').trim());
};

/**
 * GPU model names as Google writes them, mapped to the platform's own names.
 *
 * These strings are NOT free to invent — they must be byte-identical to
 * `gcpMachineCatalog.js`'s `GPUS[*].label`, because that label is what ends up
 * as `plan.acceleratorLabel`, which `capGuard.js` sends straight into this
 * table as the cost lookup key. A mismatch here does not throw: it reads as a
 * missing rate, and the machine quietly falls back to a hand-recorded cost (or
 * "unknown") forever, on every quote, with nothing in a log pointing at why.
 * That exact mismatch shipped once already — 'NVIDIA A100' and 'NVIDIA H100'
 * here, versus the catalogue's 'NVIDIA A100 40GB' and 'NVIDIA H100 80GB' — so
 * each line below is commented with the catalogue key it has to keep matching,
 * and `gcpSkuParser.test.js` asserts the pair directly against the live
 * `gcpMachineCatalog` export rather than against a second copy of the strings.
 *
 * Ordered longest-and-most-specific first: "A100 80GB" has to be tested before
 * the bare "A100" pattern, or the 80GB SKU would be claimed by the 40GB entry
 * since its description also contains "A100".
 */
const GPU_ALIASES = [
  { match: /A100\s*80\s*GB/i, model: 'NVIDIA A100 80GB' }, // GPUS['a100|80']
  { match: /A100/i, model: 'NVIDIA A100 40GB' }, // GPUS['a100|40']
  // GCP sells H100 only as the 80GB SXM card (a3-highgpu / a3-megagpu), so
  // every H100 SKU description is this one card — no 40GB variant to
  // disambiguate against, unlike A100.
  { match: /\bH100\b/i, model: 'NVIDIA H100 80GB' }, // GPUS['h100|80']
  { match: /\bL4\b/i, model: 'NVIDIA L4' }, // GPUS['l4|24']
  { match: /\bT4\b/i, model: 'NVIDIA T4' }, // GPUS['t4|16']
  { match: /\bV100\b/i, model: 'NVIDIA V100' }, // GPUS['v100|16']
];

/**
 * Disk SKU descriptions, mapped to the platform's own storage type names.
 *
 * Derived from `gcpMachineCatalog.DISK_TYPES` — the same table `resolveDiskType`
 * uses to decide what actually gets BUILT — rather than kept as an independent
 * list, because an independent list is exactly what produced the bug this
 * replaced: "NVMe SSD" was wired to the "Extreme PD Capacity" SKU (pd-extreme)
 * here, while `resolveDiskType` has always built `pd-ssd` ("SSD backed PD
 * Capacity") for that same label — and "SSD" had the same problem one disk
 * tier down, wired to pd-ssd's SKU while actually building `pd-balanced`.
 * Every tier priced through either label was being costed against a disk
 * nobody was building. Deriving this table from `DISK_TYPES` makes that class
 * of drift impossible: there is one place that says what a label means, and
 * both "what gets built" and "what it costs" read it.
 *
 * `pd-extreme` and Local SSD are absent on purpose: `DISK_TYPES` has no entry
 * that builds either, so pricing one would answer a question nobody on this
 * platform can ask yet.
 */
const DISK_SKU_PATTERN_BY_GCP_TYPE = {
  'pd-ssd': /SSD backed PD Capacity/i,
  'pd-balanced': /Balanced PD Capacity/i,
  'pd-standard': /Storage PD Capacity/i,
};

const DISK_ALIASES = require('../../gcp/gcpMachineCatalog').DISK_TYPES
  .filter((d) => DISK_SKU_PATTERN_BY_GCP_TYPE[d.type])
  .map((d) => ({ match: DISK_SKU_PATTERN_BY_GCP_TYPE[d.type], type: d.label }));

const firstAlias = (aliases, description, key) => {
  const hit = aliases.find((a) => a.match.test(String(description || '')));
  return hit ? hit[key] : null;
};

/**
 * Build a component rate table from a list of SKUs.
 *
 * @param {object[]} skus   whatever the catalogue returned, unfiltered
 * @param {object} opts
 * @param {string} opts.region        a GCP region, e.g. "europe-west4"
 * @param {string} opts.machineType   e.g. "e2-medium" — decides the family
 * @returns {{rates: object, matched: object, notes: string[]}}
 */
const ratesFromSkus = (skus, { region, machineType } = {}) => {
  const family = familyOf(machineType);
  const notes = [];
  const rates = { vcpuHour: null, ramGbHour: null, gpuHour: {}, diskGbMonth: {}, currency: null };
  const matched = { vcpu: null, ram: null, gpus: [], disks: [] };

  /*
   * Core and Ram candidates are collected before one is chosen, rather than
   * taken as they arrive. Google publishes several that all match a family —
   * the plain one, a "Custom" one and sometimes a "Sole Tenancy" one — at
   * different prices, and whichever happened to come first in the response
   * would otherwise win. Collect, then prefer deliberately.
   */
  const coreCandidates = [];
  const ramCandidates = [];

  for (const sku of Array.isArray(skus) ? skus : []) {
    const category = sku?.category || {};

    // Never price against a machine we would not buy.
    if (category.usageType !== 'OnDemand') continue;

    // A SKU with no region list is global; one with a list must include ours.
    const regions = Array.isArray(sku.serviceRegions) ? sku.serviceRegions : [];
    if (region && regions.length && !regions.includes(region) && !regions.includes('global')) continue;

    const description = String(sku.description || '');
    const price = firstTierPrice(sku);
    if (price === null) continue;
    if (!rates.currency) rates.currency = currencyOf(sku);

    if (category.resourceFamily === 'Compute') {
      // "E2 Instance Core running in Netherlands"
      if (/Instance Core/i.test(description) && describesFamily(description, family)) {
        coreCandidates.push({ description, price });
        continue;
      }
      if (/Instance Ram/i.test(description) && describesFamily(description, family)) {
        ramCandidates.push({ description, price });
        continue;
      }
      // "Nvidia Tesla T4 GPU running in Netherlands"
      if (category.resourceGroup === 'GPU' || /GPU/i.test(description)) {
        const model = firstAlias(GPU_ALIASES, description, 'model');
        if (model && rates.gpuHour[model] === undefined) {
          rates.gpuHour[model] = price;
          matched.gpus.push(`${model} <- ${description}`);
        }
        continue;
      }
    }

    if (category.resourceFamily === 'Storage') {
      const type = firstAlias(DISK_ALIASES, description, 'type');
      if (type && rates.diskGbMonth[type] === undefined) {
        rates.diskGbMonth[type] = price;
        matched.disks.push(`${type} <- ${description}`);
      }
    }
  }

  /*
   * A custom machine type is priced on the Custom SKUs, and a predefined one on
   * the plain SKUs. Choosing the wrong set is a real price difference, not a
   * rounding error, so the machine type decides — and if the right kind is not
   * published, the rate stays null and `costModel` refuses rather than
   * silently using the other one.
   */
  const wantCustom = /-custom-/i.test(String(machineType || ''));
  const pick = (candidates) => {
    const custom = candidates.filter((c) => /Custom/i.test(c.description));
    const plain = candidates.filter((c) => !/Custom/i.test(c.description)
      && !/Sole Tenancy/i.test(c.description));
    const chosen = wantCustom ? custom[0] : plain[0];
    return chosen || null;
  };

  const core = pick(coreCandidates);
  if (core) { rates.vcpuHour = core.price; matched.vcpu = core.description; }

  const ram = pick(ramCandidates);
  if (ram) { rates.ramGbHour = ram.price; matched.ram = ram.description; }

  if (!rates.currency) rates.currency = 'USD';

  const kind = wantCustom ? 'custom' : 'predefined';
  if (rates.vcpuHour === null) {
    notes.push(`No on-demand ${kind} vCPU SKU for the "${family}" family in ${region || 'any region'}.`);
  }
  if (rates.ramGbHour === null) {
    notes.push(`No on-demand ${kind} RAM SKU for the "${family}" family in ${region || 'any region'}.`);
  }

  return { rates, matched, notes };
};

module.exports = {
  priceOf,
  firstTierPrice,
  familyOf,
  describesFamily,
  ratesFromSkus,
  GPU_ALIASES,
  DISK_ALIASES,
};
