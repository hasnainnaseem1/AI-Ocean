/**
 * Cost Model
 *
 * What one machine actually costs this platform per hour, and therefore the
 * lowest price a tier containing it may be sold at.
 *
 * ── Why this is not "the GCP price" ──
 *
 * The customer pays for a machine. The platform pays for a machine **and** for
 * everything that machine needs in order to be reachable and safe: the NAT
 * gateway its egress goes through, the egress itself, flow logs, the platform's
 * own always-on infrastructure, and tax on all of it. None of that appears on a
 * per-VM price list anywhere, because no cloud sells it that way — NAT and
 * egress are billed on usage, across the whole project, once.
 *
 * So the real cost of an hour of a customer's machine is:
 *
 *     direct      what the provider charges for this exact shape
 *   + overhead    this machine's share of the shared infrastructure
 *   + tax         on both
 *   = cost
 *   × (1+margin)  what we need on top to be a business
 *   = floor       the price below which this tier loses money
 *
 * ── Provider-agnostic by construction ──
 *
 * Nothing here knows about Google or Amazon. It takes a set of **component
 * rates** — so much per vCPU-hour, so much per GB of RAM-hour, so much per GPU
 * card-hour, so much per GB of disk-month — and the shape of the machine, and
 * does arithmetic. A provider module's whole job is to produce that rate table.
 * That is what makes "GCP today, AWS tomorrow, or both at once" a question of
 * which rate table you pass in, not a rewrite.
 *
 * ── The one rule that matters ──
 *
 * **A missing rate is never zero.** If the provider could not tell us what a
 * component costs, this refuses to answer and names what is missing. The
 * alternative — quietly costing it at nothing — produces a confident number
 * that is too low, which would approve exactly the tiers that lose money. Same
 * principle as `capGuard`: an unknown cost is a refusal, not an assumption.
 *
 * Pure: no database, no network, no clock.
 */

/**
 * Hours in a billing month, for turning per-GB-month disk prices into an
 * hourly figure.
 *
 * 730 is 365×24÷12, and it is the convention the major clouds publish their
 * monthly prices against — a 30-day month (720) would under-state disk by about
 * 1.4% every month, in our favour on the invoice and against us in the margin
 * guard, which is the wrong direction for a number that decides pricing.
 */
const HOURS_PER_MONTH = 730;

const round6 = (n) => Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;

/** A rate that is genuinely a number. `''`, null and NaN are all "unknown". */
const rateOf = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Work out the cost of one machine-hour, and the price floor that follows.
 *
 * @param {object} input
 * @param {object} input.components  what the machine is made of
 * @param {number} input.components.vcpu
 * @param {number} input.components.ramGb
 * @param {string} [input.components.gpuModel]   e.g. "NVIDIA L4"
 * @param {number} [input.components.gpuCount]
 * @param {number} [input.components.storageGb]
 * @param {string} [input.components.storageType] e.g. "SSD", "NVMe SSD", "HDD"
 *
 * @param {object} input.rates  one provider's component prices, same currency
 * @param {number} input.rates.vcpuHour          per vCPU per hour
 * @param {number} input.rates.ramGbHour         per GB of RAM per hour
 * @param {object} [input.rates.gpuHour]         { "<model>": per card per hour }
 * @param {object} [input.rates.diskGbMonth]     { "<type>": per GB per month }
 * @param {string} [input.rates.currency]
 *
 * @param {object} [input.policy]  the platform's own additions
 * @param {number} [input.policy.overheadPercent]   % of direct cost, for shared
 *   infrastructure that scales with the machine (egress, logging)
 * @param {number} [input.policy.overheadPerHour]   a flat amount per machine-hour,
 *   for what does not scale with it (NAT gateways, the platform's own servers)
 * @param {number} [input.policy.taxPercent]        applied to direct + overhead
 * @param {number} [input.policy.targetMarginPercent] what we need on top
 *
 * @returns {{ok: boolean, missing: string[], currency: string,
 *   direct: object, overhead: number, tax: number, totalCost: number,
 *   floorPrice: number, marginAmount: number}}
 */
const costOf = (input) => {
  /*
   * `= {}` only defaults an *undefined* key, so an explicit `null` — which is
   * what a caller passes when a lookup came back empty — would sail past it
   * and throw on the first property read. This runs on the path that prices a
   * customer's deployment, so it coalesces instead.
   */
  const src = input || {};
  const components = src.components || {};
  const rates = src.rates || {};
  const policy = src.policy || {};
  const missing = [];

  const vcpu = Number(components.vcpu) || 0;
  const ramGb = Number(components.ramGb) || 0;
  const gpuCount = Number(components.gpuCount) || 0;
  const gpuModel = String(components.gpuModel || '').trim();
  const storageGb = Number(components.storageGb) || 0;
  const storageType = String(components.storageType || '').trim();

  /*
   * ── Two shapes of rate, because the two clouds genuinely bill differently ──
   *
   * Google prices COMPONENTS: so much per vCPU-hour, so much per GB of
   * RAM-hour, so much per GPU card-hour. A machine's price is the sum.
   *
   * AWS prices WHOLE INSTANCE TYPES: there is one `m6i.xlarge` price covering
   * its CPU, memory and any GPU welded to it. There is no published vCPU price
   * to multiply.
   *
   * So `instanceHour`, when present, IS the compute-plus-memory-plus-GPU cost
   * and the component rates are not consulted at all. The alternative —
   * dividing an instance price by its vCPU count to synthesise a per-core rate
   * — would invent a number AWS never published and then present it as fact.
   *
   * Storage stays separate either way, because it genuinely is: an EBS volume
   * is billed per GB-month independently of the instance, exactly as a GCP
   * persistent disk is.
   */
  const instanceRate = rateOf(rates.instanceHour);
  const pricedWholeMachine = instanceRate !== null;

  let vcpuRate = null;
  let ramRate = null;
  let gpuRate = null;

  if (!pricedWholeMachine) {
    vcpuRate = rateOf(rates.vcpuHour);
    if (vcpu > 0 && vcpuRate === null) missing.push('vCPU rate');

    ramRate = rateOf(rates.ramGbHour);
    if (ramGb > 0 && ramRate === null) missing.push('RAM rate');

    if (gpuCount > 0) {
      gpuRate = rateOf((rates.gpuHour || {})[gpuModel]);
      if (gpuRate === null) missing.push(`GPU rate for "${gpuModel || 'unnamed GPU'}"`);
    }
  } else if (vcpu <= 0 && ramGb <= 0 && gpuCount <= 0) {
    /*
     * An instance price with no machine to attach it to. Not arithmetic that
     * can be done — and quietly returning the instance price for a machine
     * with no specs would make an empty tier look priceable.
     */
    missing.push('machine specs to price against the instance rate');
  }

  let diskRate = null;
  if (storageGb > 0) {
    diskRate = rateOf((rates.diskGbMonth || {})[storageType]);
    if (diskRate === null) missing.push(`disk rate for "${storageType || 'unnamed disk type'}"`);
  }

  /*
   * Refuse rather than under-count. A partial answer here is worse than no
   * answer: it is a number an operator would act on, and it is always too low
   * — every missing component is one we would have charged for.
   */
  if (missing.length) {
    return {
      ok: false,
      missing,
      currency: rates.currency || 'USD',
      direct: null,
      overhead: 0,
      tax: 0,
      totalCost: null,
      floorPrice: null,
      marginAmount: 0,
    };
  }

  /*
   * Where the provider priced the whole machine, the component lines are
   * `null` rather than 0 — "not broken down" and "costs nothing" are different
   * facts, and an admin screen showing `$0.0000` for CPU would be a lie.
   */
  const compute = pricedWholeMachine ? null : round6(vcpu * (vcpuRate || 0));
  const memory = pricedWholeMachine ? null : round6(ramGb * (ramRate || 0));
  const gpu = pricedWholeMachine ? null : round6(gpuCount * (gpuRate || 0));
  const instance = pricedWholeMachine ? round6(instanceRate) : null;

  // Disk is quoted per GB-month everywhere; the machine is billed per hour.
  const storage = round6((storageGb * (diskRate || 0)) / HOURS_PER_MONTH);

  const directTotal = round6(
    (pricedWholeMachine ? instance : compute + memory + gpu) + storage
  );

  /*
   * ── Overhead: the part no price list contains ──
   *
   * Two shapes, because the costs behave differently. Egress and logging scale
   * roughly with how busy a machine is, so they are a percentage. A NAT
   * gateway and the platform's own servers cost the same whether one machine
   * is running or twenty, so that share is a flat per-hour figure the operator
   * sets from their own bill.
   *
   * Both default to zero, so a platform that has not configured this gets the
   * raw provider cost and nothing invented on top.
   */
  const overheadPercent = Math.max(0, Number(policy.overheadPercent) || 0);
  const overheadPerHour = Math.max(0, Number(policy.overheadPerHour) || 0);
  const overhead = round6((directTotal * overheadPercent) / 100 + overheadPerHour);

  const taxPercent = Math.max(0, Number(policy.taxPercent) || 0);
  const tax = round6(((directTotal + overhead) * taxPercent) / 100);

  const totalCost = round6(directTotal + overhead + tax);

  /*
   * The floor. Not a suggested price — the point below which selling this tier
   * loses money on every hour it runs. The admin screen shows it beside the
   * price so a tier cannot be mispriced by accident, and `capGuard` refuses to
   * build a machine whose sale price is under its cost.
   */
  const marginPercent = Math.max(0, Number(policy.targetMarginPercent) || 0);
  const marginAmount = round6((totalCost * marginPercent) / 100);
  const floorPrice = round4(totalCost + marginAmount);

  return {
    ok: true,
    missing: [],
    currency: rates.currency || 'USD',
    // `instance` is set when the provider priced the whole machine (AWS);
    // `compute`/`memory`/`gpu` when it priced components (GCP). Never both.
    direct: { instance, compute, memory, gpu, storage, total: directTotal },
    pricedWholeMachine,
    overhead,
    tax,
    totalCost,
    marginAmount,
    floorPrice,
    breakdown: {
      overheadPercent,
      overheadPerHour,
      taxPercent,
      marginPercent,
      hoursPerMonth: HOURS_PER_MONTH,
    },
  };
};

/**
 * Is a price healthy, given what the machine costs?
 *
 * Separated from `costOf` because it answers a different question: `costOf`
 * says what something costs, this says what to do about the price on it. The
 * admin catalogue screen and the provisioning guard both want the second one
 * and should agree on it.
 *
 * @returns {{verdict: 'loss'|'below_target'|'ok', marginPercent: number|null,
 *   shortfall: number}}
 */
const assessPrice = ({ sellPrice, cost }) => {
  const price = Number(sellPrice) || 0;
  if (!cost || !cost.ok || cost.totalCost === null) {
    return { verdict: 'unknown', marginPercent: null, shortfall: 0 };
  }

  if (price <= cost.totalCost) {
    return {
      verdict: 'loss',
      marginPercent: cost.totalCost > 0
        ? round4(((price - cost.totalCost) / cost.totalCost) * 100)
        : 0,
      shortfall: round4(cost.totalCost - price),
    };
  }

  if (price < cost.floorPrice) {
    // Profitable, but thinner than the platform has decided it wants. Worth
    // saying, not worth refusing — that is the owner's call to make per tier.
    return {
      verdict: 'below_target',
      marginPercent: round4(((price - cost.totalCost) / cost.totalCost) * 100),
      shortfall: round4(cost.floorPrice - price),
    };
  }

  return {
    verdict: 'ok',
    marginPercent: round4(((price - cost.totalCost) / cost.totalCost) * 100),
    shortfall: 0,
  };
};

module.exports = {
  HOURS_PER_MONTH,
  costOf,
  assessPrice,
  // Exported for the provider modules, which have to decide the same way about
  // a rate the API did not return.
  rateOf,
};
