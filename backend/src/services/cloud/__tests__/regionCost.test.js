/**
 * What a region costs, and who carries it.
 *
 * Each test here stands for a way the platform loses money on a region without
 * anything on a screen saying so.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const regionCost = require('../regionCost');

/** Two AWS NAT gateways, one per availability zone. */
const AWS = { fixedCostPerHour: 0.09, perMachineCostPerHour: 0 };
/** Google: one NAT address standing, the rest billed per VM. */
const GCP = { fixedCostPerHour: 0.005, perMachineCostPerHour: 0.0014 };

describe('the fixed part is spread, the per-machine part is not', () => {
  test('AWS: one machine carries the whole standing cost', () => {
    assert.equal(regionCost.shareOf({ ...AWS, assumedMachines: 1 }), 0.09);
  });

  test('AWS: ten machines carry a tenth each', () => {
    assert.equal(regionCost.shareOf({ ...AWS, assumedMachines: 10 }), 0.009);
  });

  test('Google: the per-VM part does NOT shrink with the count', () => {
    const at1 = regionCost.shareOf({ ...GCP, assumedMachines: 1 });
    const at10 = regionCost.shareOf({ ...GCP, assumedMachines: 10 });

    // fixed 0.005 → 0.005 / 0.0005, plus 0.0014 per machine either way.
    assert.equal(at1, 0.0064);
    assert.equal(at10, 0.0019);

    /*
     * The load-bearing assertion. If the per-VM charge were folded into the
     * fixed figure it would shrink as the count rose, and a busy region would
     * under-recover the one cost that actually grows with it.
     */
    assert.ok(at10 > 0.0014, 'the per-machine floor must survive any spread');
  });

  test('the two clouds are an order of magnitude apart, which is the point', () => {
    const aws = regionCost.shareOf({ ...AWS, assumedMachines: 1 });
    const gcp = regionCost.shareOf({ ...GCP, assumedMachines: 1 });

    // A fresh AWS region costs ~14× what a fresh Google one does. This is why
    // "the first customer in a new region" is an AWS problem, not a general one.
    assert.ok(aws > gcp * 10, `${aws} vs ${gcp}`);
  });
});

describe('a bad assumed count can never divide by zero or go negative', () => {
  for (const bad of [0, -5, null, undefined, NaN, 'ten', 0.4]) {
    test(`assumedMachines = ${JSON.stringify(bad)} falls back to 1`, () => {
      const got = regionCost.shareOf({ ...AWS, assumedMachines: bad });
      // Falling back to 1 is the SAFE direction: it charges the most. Falling
      // back to a large number would quietly price the region at nearly free.
      assert.equal(got, 0.09);
    });
  }

  test('a negative or missing cost reads as zero, not as a credit', () => {
    assert.equal(regionCost.shareOf({ fixedCostPerHour: -5, assumedMachines: 1 }), 0);
    assert.equal(regionCost.shareOf({}), 0);
  });
});

describe('recovery says whether the region is paying for itself', () => {
  test('a full region recovers everything', () => {
    const got = regionCost.recovery({ fixedCostPerHour: 0.09, assumedMachines: 10, liveMachines: 10 });

    assert.equal(got.recovered, 0.09);
    assert.equal(got.shortfallPerHour, 0);
    assert.equal(got.ok, true);
    assert.equal(got.machinesShort, 0);
  });

  test('an optimistic assumption shows the hourly gap in money', () => {
    // Assumed 10, only 2 running: eight shares are paid by nobody.
    const got = regionCost.recovery({ fixedCostPerHour: 0.09, assumedMachines: 10, liveMachines: 2 });

    assert.equal(got.perMachineShare, 0.009);
    assert.equal(got.recovered, 0.018);
    assert.equal(got.shortfallPerHour, 0.072);
    assert.equal(got.ok, false);
    assert.equal(got.machinesShort, 8);
  });

  test('an empty region recovers nothing and says so', () => {
    const got = regionCost.recovery({ fixedCostPerHour: 0.09, assumedMachines: 1, liveMachines: 0 });

    assert.equal(got.recovered, 0);
    assert.equal(got.shortfallPerHour, 0.09);
    assert.equal(got.ok, false);
  });

  test('a fuller-than-assumed region is NOT reported as a credit', () => {
    const got = regionCost.recovery({ fixedCostPerHour: 0.09, assumedMachines: 5, liveMachines: 40 });

    // Over-recovery is margin, not a negative shortfall. Showing "-$0.63"
    // would read as money we have in hand against this region, which we do not.
    assert.equal(got.shortfallPerHour, 0);
    assert.equal(got.recovered, 0.09);
    assert.equal(got.ok, true);
  });

  test('assumed 1 and one machine running is exactly break-even', () => {
    const got = regionCost.recovery({ fixedCostPerHour: 0.09, assumedMachines: 1, liveMachines: 1 });
    assert.equal(got.ok, true);
    assert.equal(got.shortfallPerHour, 0);
  });
});

describe('the ladder shows how steep the low end is', () => {
  test('one machine carries far more than twenty', () => {
    const rows = regionCost.ladder(AWS);
    const at1 = rows.find((r) => r.machines === 1).sharePerHour;
    const at50 = rows.find((r) => r.machines === 50).sharePerHour;

    assert.equal(at1, 0.09);
    assert.equal(at50, 0.0018);
    assert.equal(at1 / at50, 50);
  });

  test('it never rises as the count goes up', () => {
    const rows = regionCost.ladder(GCP);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        rows[i].sharePerHour <= rows[i - 1].sharePerHour,
        `${rows[i].machines} machines must not carry more than ${rows[i - 1].machines}`,
      );
    }
  });
});

describe('what the region actually costs us at a given occupancy', () => {
  test('AWS: flat, because the gateways do not care', () => {
    assert.equal(regionCost.totalCostPerHour({ ...AWS, liveMachines: 0 }), 0.09);
    assert.equal(regionCost.totalCostPerHour({ ...AWS, liveMachines: 50 }), 0.09);
  });

  test('Google: grows with the machines, because the NAT is per VM', () => {
    assert.equal(regionCost.totalCostPerHour({ ...GCP, liveMachines: 0 }), 0.005);
    assert.equal(regionCost.totalCostPerHour({ ...GCP, liveMachines: 10 }), 0.019);
  });
});
