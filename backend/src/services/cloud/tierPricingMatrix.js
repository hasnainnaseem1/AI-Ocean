/**
 * Working out what one tier costs, and should sell for, in one place.
 *
 * ── What a "place" is ──
 *
 * A cloud and a region together. The same tier is a different machine on each
 * cloud (`m6i.large` here, `e2-standard-2` there) at a different rate, and a
 * different rate again in each region. Six places for two clouds and three
 * regions, and each one needs its own answer.
 *
 * ── The sum, in the order it is built ──
 *
 *   the machine          what the provider charges for that shape, live
 * + the region's share   its part of what the region costs to keep open
 * + overhead             what running this platform costs, per machine-hour
 * + tax                  on both of the above, because both are real spending
 * = cost
 * + margin               what the tier should earn
 * = floor, and normally the price
 *
 * The middle line is the one that did not exist before: a tier sold in a fresh
 * AWS region was priced on the machine alone, and the NAT gateways standing
 * there were paid for by nobody.
 *
 * ── Why a missing figure refuses instead of counting as zero ──
 *
 * Every step can fail: a cloud that has no shape for these specs, a region
 * never costed, a provider that would not answer. Each of those makes the
 * answer unknown, and unknown is not free. A cell that cannot be priced is
 * marked unsellable rather than published at whatever the sum of the parts we
 * did manage to read happens to be.
 *
 * Pure except for the price lookups it is handed: the arithmetic and the
 * verdict live here, the I/O lives in `tierPriceService`.
 */

const round6 = (n) => Number(Number(n).toFixed(6));
const round4 = (n) => Number(Number(n).toFixed(4));

/**
 * Round a price UP to four decimals.
 *
 * Used wherever the platform's own floor becomes a price to charge. Plain
 * rounding goes whichever way the fifth decimal points, and half the time
 * that is down — which put the sell price *below* the floor it was derived
 * from and marked the cell `below_floor`. Whether a tier could be sold then
 * depended on a digit nobody chose: a GCP floor of 0.036645 rounded to
 * 0.0366 and was refused, while 0.037273 rounded to 0.0373 and passed.
 *
 * The most a customer ever pays for this is 0.00005 of a dollar an hour.
 * The alternative is selling under cost, which is the one thing this whole
 * matrix exists to prevent.
 */
const ceil4 = (n) => Math.ceil(Number(n) * 1e4 - 1e-9) / 1e4;

/** Statuses a cell can be in. Only `sellable` may be offered to a customer. */
const STATUS = {
  SELLABLE: 'sellable',
  BELOW_FLOOR: 'below_floor',
  UNPRICED: 'unpriced',
  UNBUILDABLE: 'unbuildable',
};

/**
 * The margin this tier should earn, as a fraction.
 *
 * A tier's own figure wins; null falls through to the platform default, so a
 * business-wide change reaches every tier that has not been given its own.
 */
const marginFor = (tier, policy) => {
  const own = tier?.targetMarginPercent;
  const pct = own === null || own === undefined ? Number(policy?.targetMarginPercent) : Number(own);
  return Number.isFinite(pct) && pct > 0 ? pct : 0;
};

/**
 * Build one cell from the parts that were successfully read.
 *
 * @param {object} input
 * @param {object} input.tier          the tier being priced
 * @param {string} input.cloud         'gcp' | 'aws'
 * @param {string} input.region        a platform region
 * @param {object} input.shape         `{ ok, machineType, reason }` from the spec mapper
 * @param {object} input.price         `{ ok, cost, source, reason }` from cloudPricing
 * @param {object} input.regionShare   `{ ok, share, reason }` from regionCostService
 * @param {object} input.policy        overhead / tax / margin
 * @param {object} [input.existing]    the stored row, for an overridden price
 */
const cellFor = ({
  tier, cloud, region, shape, price, regionShare, policy = {}, existing = null,
}) => {
  const base = {
    tierId: tier?.id,
    cloud,
    region,
    machineType: shape?.machineType || '',
    providerCostPerHour: 0,
    regionalSharePerHour: 0,
    overheadPerHour: 0,
    taxPerHour: 0,
    totalCostPerHour: 0,
    floorPricePerHour: 0,
    costSource: 'unknown',
    costAsOf: null,
    sellPricePerHour: 0,
    stoppedPricePerHour: 0,
    status: STATUS.UNPRICED,
    lastError: '',
  };

  /*
   * ── This cloud cannot build this tier at all ──
   *
   * A single A100 on AWS, where they are sold only in eights. Permanent and
   * not a pricing failure, so it is said differently: there is nothing to fix
   * by reading a price again.
   */
  if (shape && shape.ok === false) {
    return { ...base, status: STATUS.UNBUILDABLE, lastError: shape.reason || shape.message || '' };
  }

  /*
   * ── Something could not be read ──
   *
   * Deliberately NOT partially priced. Adding up the parts that did answer
   * produces a number that looks exactly like a real price and is too low by
   * however much is missing.
   */
  if (!price?.ok) {
    return {
      ...base,
      status: STATUS.UNPRICED,
      lastError: price?.reason || `No price could be read for ${cloud} in ${region}.`,
    };
  }
  if (!regionShare?.ok) {
    return {
      ...base,
      status: STATUS.UNPRICED,
      costSource: price.source || 'unknown',
      lastError: regionShare?.reason
        || `${region} has no recorded cost on ${cloud}, so what it adds to every machine there is unknown.`,
    };
  }

  /*
   * The provider's own charge for the machine and its disk. Taken from the
   * cost model's `direct` line rather than its total, because overhead and tax
   * are re-applied below over the larger base that includes the region.
   */
  const machine = round6(price.cost?.direct?.total ?? 0);
  const share = round6(regionShare.share ?? 0);
  const direct = round6(machine + share);

  const overheadPercent = Number(policy.overheadPercent) || 0;
  const overheadPerHour = Number(policy.overheadPerHour) || 0;
  const taxPercent = Number(policy.taxPercent) || 0;

  const overhead = round6(direct * (overheadPercent / 100) + overheadPerHour);
  const tax = round6((direct + overhead) * (taxPercent / 100));
  const totalCost = round6(direct + overhead + tax);

  const marginPercent = marginFor(tier, policy);
  const floor = round6(totalCost * (1 + marginPercent / 100));

  /*
   * ── The price ──
   *
   * Normally the floor: one margin decision prices the whole table.
   *
   * Two things keep a price out of the refresh's hands, and they are different
   * decisions. A cell an operator priced by hand keeps their figure, because a
   * refresh that undid an edit would be unusable. And with `autoPriceTiers`
   * off, the refresh prices nothing at all — it becomes a cost report, for an
   * operator who sets every price themselves.
   *
   * Either way the price is then checked against the floor like any other, so
   * neither is a way to quietly sell below cost.
   */
  const keepExisting = !!existing?.sellPriceIsOverridden || policy.autoPriceTiers === false;
  const kept = round4(Number(existing?.sellPricePerHour) || 0);

  /*
   * With auto-pricing off and nothing stored yet there is no price to keep, so
   * the floor is used for the first pass rather than leaving the cell at zero
   * — zero would read as free, and the status would say it is sellable.
   */
  // `ceil4`, not `round4`: see its header. Rounding the floor down produces a
  // price that fails the very check it was derived from.
  const sell = keepExisting && kept > 0 ? kept : ceil4(floor);

  /*
   * A cell is sellable when its price covers the floor. The tolerance exists
   * because a provider's published rate moves in its last decimal place, and
   * without it cells would flip in and out of sellable every hour — each flip
   * a region vanishing from a customer's picker for no visible reason.
   */
  const tolerance = Number(policy.floorTolerancePercent);
  const slack = Number.isFinite(tolerance) && tolerance > 0 ? floor * (tolerance / 100) : 0;
  const status = sell > 0 && sell >= round6(floor - slack) ? STATUS.SELLABLE : STATUS.BELOW_FLOOR;

  return {
    ...base,
    providerCostPerHour: machine,
    regionalSharePerHour: share,
    overheadPerHour: overhead,
    taxPerHour: tax,
    totalCostPerHour: totalCost,
    floorPricePerHour: floor,
    costSource: price.source || 'unknown',
    costAsOf: price.asOf || new Date(),
    sellPricePerHour: sell,
    /*
     * A paused machine keeps its disk and nothing else — no vCPU, no GPU, and
     * no share of the region, which is a cost of being reachable rather than
     * of running. Priced at the same margin so a paused hour is not a
     * different business from a running one.
     */
    stoppedPricePerHour: round4((price.cost?.direct?.storage ?? 0) * (1 + marginPercent / 100)),
    status,
    lastError: status === STATUS.BELOW_FLOOR
      ? `Priced at ${sell}/hr but the floor here is ${floor}/hr.`
      : '',
  };
};

/**
 * Which (cloud, region) pairs a tier should have a price for.
 *
 * The tier's own regions crossed with the clouds that are switched on. A
 * region a tier is not sold in gets no row, and a cloud that is off gets none
 * either — there is no price to quote for a machine that cannot be built.
 */
const placesFor = (tier, enabledClouds, sellableRegions) => {
  const regions = (tier?.regions || []).filter((r) => sellableRegions.includes(r));
  const places = [];
  for (const cloud of enabledClouds) {
    for (const region of regions) places.push({ cloud, region });
  }
  return places;
};

module.exports = {
  STATUS,
  marginFor,
  cellFor,
  placesFor,
};
