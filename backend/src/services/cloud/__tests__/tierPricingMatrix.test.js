/**
 * Pricing one tier in one place.
 *
 * Every test here is a way a machine gets sold for less than it costs, or a
 * way a cell that cannot be built gets offered to a customer anyway.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const matrix = require('../tierPricingMatrix');

const TIER = { id: 't-1', name: 'A100 Single', regions: ['eu-central', 'us-east'] };

/** A cost-model result, as `cloudPricing.costFor` returns it. */
const price = (machine, storage = 0) => ({
  ok: true,
  source: 'live',
  asOf: new Date('2026-10-18T00:00:00Z'),
  cost: { direct: { total: machine + storage, storage } },
});

const share = (n) => ({ ok: true, share: n });
const shape = (machineType) => ({ ok: true, machineType });

const build = (over = {}) => matrix.cellFor({
  tier: TIER,
  cloud: 'aws',
  region: 'eu-central',
  shape: shape('m6i.large'),
  price: price(1.0),
  regionShare: share(0.009),
  policy: { overheadPercent: 0, overheadPerHour: 0, taxPercent: 0, targetMarginPercent: 30 },
  ...over,
});

describe('the region\'s own cost reaches the price', () => {
  test('a machine carries its share of what the region costs to keep open', () => {
    const cell = build();

    assert.equal(cell.providerCostPerHour, 1.0);
    assert.equal(cell.regionalSharePerHour, 0.009);
    // This line is the whole point of the phase: without it the cost would be
    // 1.0, the NAT gateways would be paid for by nobody, and nothing would say so.
    assert.equal(cell.totalCostPerHour, 1.009);
  });

  test('and the margin is taken on top of it, not just on the machine', () => {
    const cell = build();
    assert.equal(cell.floorPricePerHour, round(1.009 * 1.3));
    assert.equal(cell.sellPricePerHour, Number((1.009 * 1.3).toFixed(4)));
  });

  test('a region with a bigger standing cost prices higher', () => {
    const cheap = build({ regionShare: share(0.001) });
    const dear = build({ regionShare: share(0.09) });

    assert.ok(dear.sellPricePerHour > cheap.sellPricePerHour);
    assert.equal(round(dear.totalCostPerHour - cheap.totalCostPerHour), 0.089);
  });
});

describe('overhead and tax apply to the region too', () => {
  test('because the NAT bill is as real as the machine bill', () => {
    const cell = build({
      policy: {
        overheadPercent: 10, overheadPerHour: 0.01, taxPercent: 20, targetMarginPercent: 0,
      },
    });

    // direct 1.009 → overhead 0.1009 + 0.01 = 0.1109 → tax 20% of 1.1199
    assert.equal(cell.overheadPerHour, 0.1109);
    assert.equal(cell.taxPerHour, round((1.009 + 0.1109) * 0.2));
    assert.equal(cell.totalCostPerHour, round(1.009 + 0.1109 + (1.009 + 0.1109) * 0.2));
  });
});

describe('the margin comes from the tier, or the platform', () => {
  test('a tier with its own margin uses it', () => {
    const cell = build({ tier: { ...TIER, targetMarginPercent: 50 } });
    assert.equal(cell.floorPricePerHour, round(1.009 * 1.5));
  });

  test('a tier without one falls through to the platform default', () => {
    // Null, not zero: a default of zero here would have pinned every existing
    // tier to no margin the moment the column was added.
    const cell = build({ tier: { ...TIER, targetMarginPercent: null } });
    assert.equal(cell.floorPricePerHour, round(1.009 * 1.3));
  });

  test('a tier margin of zero is honoured, not treated as unset', () => {
    const cell = build({ tier: { ...TIER, targetMarginPercent: 0 } });
    assert.equal(cell.floorPricePerHour, 1.009);
  });
});

describe('a cell that cannot be priced is NOT published', () => {
  test('a cloud with no shape for these specs is unbuildable', () => {
    const cell = build({
      shape: { ok: false, reason: 'AWS sells NVIDIA A100 40GB in counts of 8; this tier asks for 1.' },
    });

    assert.equal(cell.status, matrix.STATUS.UNBUILDABLE);
    assert.equal(cell.sellPricePerHour, 0);
    assert.match(cell.lastError, /counts of 8/);
  });

  test('a provider that would not answer leaves the cell unpriced', () => {
    const cell = build({ price: { ok: false, reason: 'AWS is switched off.' } });

    assert.equal(cell.status, matrix.STATUS.UNPRICED);
    assert.equal(cell.sellPricePerHour, 0);
    assert.equal(cell.totalCostPerHour, 0);
  });

  test('an uncosted region leaves it unpriced too — NOT partially priced', () => {
    const cell = build({ regionShare: { ok: false, reason: 'No cost is recorded for aws in eu-central.' } });

    /*
     * The dangerous near-miss. Adding up the parts that did answer gives
     * 1.0 × 1.3 = 1.30, which looks exactly like a real price and is short by
     * the region's entire standing cost.
     */
    assert.equal(cell.status, matrix.STATUS.UNPRICED);
    assert.equal(cell.sellPricePerHour, 0);
    // The service's own wording is passed through rather than reworded here,
    // so an admin reading the cell sees the same sentence the cost screen shows.
    assert.equal(cell.lastError, 'No cost is recorded for aws in eu-central.');
  });

  test('neither unpriced state is sellable', () => {
    for (const broken of [
      { shape: { ok: false, reason: 'x' } },
      { price: { ok: false, reason: 'x' } },
      { regionShare: { ok: false, reason: 'x' } },
    ]) {
      assert.notEqual(build(broken).status, matrix.STATUS.SELLABLE);
    }
  });
});

describe('a price typed in by hand', () => {
  const existing = (sell) => ({ sellPriceIsOverridden: true, sellPricePerHour: sell });

  test('survives the refresh', () => {
    const cell = build({ existing: existing(2.5) });
    assert.equal(cell.sellPricePerHour, 2.5);
  });

  test('but is still checked against the floor', () => {
    const cell = build({ existing: existing(0.5) });

    // Overriding must not be a way to quietly sell below cost.
    assert.equal(cell.status, matrix.STATUS.BELOW_FLOOR);
    assert.match(cell.lastError, /floor here is/);
  });

  test('and the cost figures are refreshed under it either way', () => {
    const cell = build({ existing: existing(2.5), price: price(1.5) });
    assert.equal(cell.providerCostPerHour, 1.5);
    assert.equal(cell.sellPricePerHour, 2.5);
  });
});

describe('the floor tolerance stops cells flapping', () => {
  test('a hair under the floor is still sellable', () => {
    // A provider's published rate moves in its last decimal place. Without
    // slack, cells flip in and out of sellable every hour — and each flip is a
    // region vanishing from a customer's picker for no visible reason.
    const floor = 1.009 * 1.3;
    const cell = build({
      existing: { sellPriceIsOverridden: true, sellPricePerHour: round4(floor * 0.999) },
      policy: { overheadPercent: 0, overheadPerHour: 0, taxPercent: 0, targetMarginPercent: 30, floorTolerancePercent: 0.5 },
    });
    assert.equal(cell.status, matrix.STATUS.SELLABLE);
  });

  test('but a real shortfall is not forgiven', () => {
    const floor = 1.009 * 1.3;
    const cell = build({
      existing: { sellPriceIsOverridden: true, sellPricePerHour: round4(floor * 0.9) },
      policy: { overheadPercent: 0, overheadPerHour: 0, taxPercent: 0, targetMarginPercent: 30, floorTolerancePercent: 0.5 },
    });
    assert.equal(cell.status, matrix.STATUS.BELOW_FLOOR);
  });

  test('with no tolerance set, the floor is exact', () => {
    const floor = 1.009 * 1.3;
    const cell = build({
      existing: { sellPriceIsOverridden: true, sellPricePerHour: round4(floor * 0.999) },
    });
    assert.equal(cell.status, matrix.STATUS.BELOW_FLOOR);
  });
});

describe('auto-pricing can be switched off entirely', () => {
  const manual = {
    overheadPercent: 0, overheadPerHour: 0, taxPercent: 0, targetMarginPercent: 30,
    autoPriceTiers: false,
  };

  test('an existing price is left exactly alone', () => {
    const cell = build({
      policy: manual,
      existing: { sellPriceIsOverridden: false, sellPricePerHour: 2.75 },
    });
    assert.equal(cell.sellPricePerHour, 2.75);
  });

  test('but the costs underneath are still refreshed', () => {
    // The point of the off position: a cost report. Not knowing what a machine
    // costs must not depend on whether we let the platform act on it.
    const cell = build({
      policy: manual,
      existing: { sellPriceIsOverridden: false, sellPricePerHour: 2.75 },
      price: price(1.5),
    });
    assert.equal(cell.providerCostPerHour, 1.5);
    assert.equal(cell.totalCostPerHour, 1.509);
    assert.equal(cell.floorPricePerHour, round(1.509 * 1.3));
  });

  test('a price left alone is still checked against the floor', () => {
    const cell = build({
      policy: manual,
      existing: { sellPriceIsOverridden: false, sellPricePerHour: 0.5 },
    });
    assert.equal(cell.status, matrix.STATUS.BELOW_FLOOR);
  });

  test('with nothing stored yet it uses the floor, NOT zero', () => {
    // Zero would read as free, and the status check would call it sellable.
    const cell = build({ policy: manual, existing: null });
    assert.equal(cell.sellPricePerHour, Number((1.009 * 1.3).toFixed(4)));
    assert.equal(cell.status, matrix.STATUS.SELLABLE);
  });
});

describe('a paused machine is priced on its disk alone', () => {
  test('no vCPU, no GPU, and no share of the region', () => {
    const cell = build({ price: price(0.95, 0.05) });

    // The region's share is a cost of being reachable, not of running — a
    // paused machine is not holding a NAT open.
    assert.equal(cell.stoppedPricePerHour, round4(0.05 * 1.3));
    assert.ok(cell.stoppedPricePerHour < cell.sellPricePerHour);
  });
});

describe('which places a tier is priced in', () => {
  const sellable = ['eu-central', 'us-east', 'ap-south'];

  test('its own regions, crossed with the clouds that are on', () => {
    const places = matrix.placesFor(TIER, ['gcp', 'aws'], sellable);

    assert.equal(places.length, 4);
    assert.deepEqual(
      places.map((p) => `${p.cloud}/${p.region}`).sort(),
      ['aws/eu-central', 'aws/us-east', 'gcp/eu-central', 'gcp/us-east'],
    );
  });

  test('a cloud that is off gets no cells — nothing to quote', () => {
    assert.equal(matrix.placesFor(TIER, ['gcp'], sellable).length, 2);
    assert.equal(matrix.placesFor(TIER, [], sellable).length, 0);
  });

  test('a region the platform does not sell is skipped', () => {
    const odd = { ...TIER, regions: ['eu-central', 'mars-north-1'] };
    const places = matrix.placesFor(odd, ['aws'], sellable);

    assert.equal(places.length, 1);
    assert.equal(places[0].region, 'eu-central');
  });
});

function round(n) { return Number(Number(n).toFixed(6)); }
function round4(n) { return Number(Number(n).toFixed(4)); }

describe('rounding never pushes the price under the floor', () => {
  /*
   * ── The bug this is about ──
   *
   * The sell price is the floor rounded to four decimals, and the cell is
   * then checked against that same floor. With plain rounding, a floor whose
   * fifth decimal is below five rounds DOWN — producing a price that fails
   * the check it was derived from, and a cell marked `below_floor` with no
   * explanation an operator could act on.
   *
   * It was found on real Google prices: `Micro 1GB` in eu-central had a floor
   * of 0.036645, which became 0.0366 and was refused, while the same tier in
   * us-east had 0.037273, became 0.0373, and passed. Whether a region could
   * be sold came down to a digit nobody chose.
   */
  const floorOf = (machine) => build({
    price: price(machine),
    regionShare: share(0),
    policy: { overheadPercent: 0, overheadPerHour: 0, taxPercent: 0, targetMarginPercent: 0 },
  });

  test('a floor that would round DOWN is still sellable', () => {
    // 0.036645 -> 0.0366 under plain rounding, which is below the floor.
    const cell = floorOf(0.036645);

    assert.equal(cell.status, matrix.STATUS.SELLABLE, cell.lastError);
    assert.ok(
      cell.sellPricePerHour >= cell.floorPricePerHour,
      `sell ${cell.sellPricePerHour} is under floor ${cell.floorPricePerHour}`,
    );
  });

  test('and one that rounds UP is too — the behaviour does not depend on the digit', () => {
    const cell = floorOf(0.037273);

    assert.equal(cell.status, matrix.STATUS.SELLABLE, cell.lastError);
    assert.ok(cell.sellPricePerHour >= cell.floorPricePerHour);
  });

  test('the price is never more than a hundredth of a cent above the floor', () => {
    /*
     * Rounding up is paid for by the customer, so it has to stay negligible.
     * A hundredth of a cent an hour is about nine cents a year.
     */
    for (const machine of [0.036645, 0.037273, 1.000049, 0.0000501, 2.5]) {
      const cell = floorOf(machine);
      assert.ok(
        cell.sellPricePerHour - cell.floorPricePerHour < 0.0001,
        `${machine}: charged ${cell.sellPricePerHour - cell.floorPricePerHour} over the floor`,
      );
    }
  });

  test('a floor already at four decimals is not nudged up', () => {
    // Exactness matters here: ceil() on a value already on the boundary must
    // not add a tick, or every price creeps upward on each refresh.
    const cell = floorOf(0.0366);

    assert.equal(cell.sellPricePerHour, 0.0366);
  });
});
