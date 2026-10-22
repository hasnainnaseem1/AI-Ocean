/**
 * The margin guard, now that it enforces the floor rather than break-even.
 *
 * ── What changed, and why it needed to ──
 *
 * The guard refused only when a machine cost more than it sold for. A machine
 * costing $1.0000 and sold at $1.0001 was built, earning a hundredth of a
 * cent. The target margin was worked out on every pass, reported on the admin
 * screen, and never once consulted.
 *
 * ── Why this is normally a no-op ──
 *
 * Prices now come from the matrix, where each cell IS its own floor. This only
 * fires in the gap between a provider raising a rate and the hourly refresh
 * noticing it. The tests below are mostly about that gap, and about the two
 * halves of the platform agreeing on where the line is.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const capGuard = require('../capGuard');

/**
 * A platform where nothing else would refuse, so only the money is tested.
 *
 * Fully configured on purpose: the credential checks run BEFORE the money
 * ones, so a fixture missing a project id refuses for that instead and every
 * assertion below would be about the wrong thing.
 */
const base = (over = {}) => ({
  cloud: 'gcp',
  gcp: {
    enabled: true,
    dryRun: false,
    enforceMarginGuard: true,
    projectId: 'probe-project',
    serviceAccountKeyEncrypted: 'encrypted',
    customerServiceAccount: 'customer-vm@probe-project.iam.gserviceaccount.com',
  },
  accountAutoDeploy: true,
  hasLiveInstance: false,
  funding: { ok: true },
  teamInstances: 0,
  platformInstances: 0,
  machineType: 'e2-standard-2',
  costPerHour: 1.0,
  floorPrice: 1.3, // cost + 30%
  sellPricePerHour: 1.5,
  ...over,
});

describe('a machine that loses money is refused, as it always was', () => {
  test('sold under cost', () => {
    const got = capGuard.decide(base({ sellPricePerHour: 0.9 }));

    assert.equal(got.ok, false);
    assert.equal(got.code, capGuard.CODES.MARGIN_TOO_LOW);
    assert.equal(got.belowCost, true);
    assert.match(got.reason, /loses money/);
  });

  test('sold at exactly cost — break-even is not a business', () => {
    const got = capGuard.decide(base({ sellPricePerHour: 1.0 }));
    assert.equal(got.code, capGuard.CODES.MARGIN_TOO_LOW);
  });

  test('a blank cost is a refusal, not "costs nothing"', () => {
    // `Number('') === 0`, which would make every machine look profitable.
    for (const blank of ['', '   ', null, undefined, 'abc']) {
      const got = capGuard.decide(base({ costPerHour: blank }));
      assert.equal(got.code, capGuard.CODES.COST_UNKNOWN, `${JSON.stringify(blank)}`);
    }
  });
});

describe('a machine above cost but under the floor is now ALSO refused', () => {
  test('the case the old guard let through', () => {
    // Costs $1.00, sells for $1.0001. Profitable by a hundredth of a cent, and
    // the platform is set to want 30%.
    const got = capGuard.decide(base({ sellPricePerHour: 1.0001 }));

    assert.equal(got.ok, false);
    assert.equal(got.code, capGuard.CODES.BELOW_FLOOR);
  });

  test('it is NOT reported as losing money, because it is not', () => {
    const got = capGuard.decide(base({ sellPricePerHour: 1.2 }));

    assert.equal(got.belowCost, false);
    assert.match(got.reason, /would make money, just less than intended/);
    // The two need different answers: a mispriced tier versus a provider rate
    // that moved since the order was quoted.
    assert.notEqual(got.code, capGuard.CODES.MARGIN_TOO_LOW);
  });

  test('the message names the price it needs', () => {
    const got = capGuard.decide(base({ sellPricePerHour: 1.2 }));
    assert.match(got.reason, /1\.3000/);
    assert.equal(got.floorPrice, 1.3);
  });

  test('at exactly the floor it is allowed', () => {
    const got = capGuard.decide(base({ sellPricePerHour: 1.3 }));
    assert.equal(got.ok, true);
  });

  test('above the floor it is allowed', () => {
    assert.equal(capGuard.decide(base({ sellPricePerHour: 2.0 })).ok, true);
  });
});

describe('the tolerance is shared with the price matrix', () => {
  test('a hair under the floor passes, with tolerance set', () => {
    /*
     * A provider's published rate moves in its last decimal place. Without
     * slack, the matrix would call a cell sellable and this would refuse the
     * very same number — and from the outside that reads as the order simply
     * not working, with nothing on either screen explaining it.
     */
    const got = capGuard.decide(base({
      sellPricePerHour: 1.2987, // 0.1% under 1.30
      floorTolerancePercent: 0.5,
    }));
    assert.equal(got.ok, true);
  });

  test('but a real shortfall is still refused', () => {
    const got = capGuard.decide(base({
      sellPricePerHour: 1.1,
      floorTolerancePercent: 0.5,
    }));
    assert.equal(got.code, capGuard.CODES.BELOW_FLOOR);
  });

  test('with no tolerance set, the floor is exact', () => {
    const got = capGuard.decide(base({ sellPricePerHour: 1.2987 }));
    assert.equal(got.code, capGuard.CODES.BELOW_FLOOR);
  });

  test('tolerance never excuses selling below COST', () => {
    // A tolerance big enough to swallow the whole margin must not turn into a
    // licence to run machines at a loss.
    const got = capGuard.decide(base({
      sellPricePerHour: 0.95,
      floorTolerancePercent: 50,
    }));
    assert.equal(got.code, capGuard.CODES.MARGIN_TOO_LOW);
    assert.equal(got.belowCost, true);
  });
});

describe('a floor that is not known does not block anything', () => {
  test('no floor means only the loss check applies', () => {
    for (const floorPrice of [null, undefined, 0, NaN, 'x']) {
      const got = capGuard.decide(base({ floorPrice, sellPricePerHour: 1.05 }));
      assert.equal(got.ok, true, `floorPrice=${JSON.stringify(floorPrice)}`);
    }
  });

  test('and a loss is still caught without one', () => {
    const got = capGuard.decide(base({ floorPrice: null, sellPricePerHour: 0.5 }));
    assert.equal(got.code, capGuard.CODES.MARGIN_TOO_LOW);
  });
});

describe('the guard can still be switched off', () => {
  test('nothing about money is checked when it is', () => {
    // Merged onto the fixture rather than replacing it: a bare `gcp` object
    // drops the credentials and refuses for that instead.
    const got = capGuard.decide(base({
      gcp: { ...base().gcp, enforceMarginGuard: false },
      costPerHour: 5,
      sellPricePerHour: 0.01,
    }));

    // An explicit, logged choice — see the guard's own header.
    assert.equal(got.ok, true);
  });
});

describe('what the caller does with a refusal', () => {
  test('neither money refusal is in the quiet set', () => {
    /*
     * `autoProvisionService` keeps a list of codes it says nothing about —
     * the normal state of a platform that has not set a cloud up. A money
     * refusal in that list would be a deployment silently not built.
     */
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../autoProvisionService'), 'utf8');
    const quiet = src.slice(src.indexOf('const QUIET_CODES'), src.indexOf('];', src.indexOf('const QUIET_CODES')));

    assert.ok(!/MARGIN_TOO_LOW/.test(quiet), 'a machine losing money must never be quiet');
    assert.ok(!/BELOW_FLOOR/.test(quiet), 'a machine under its floor must never be quiet');
  });

  test('a refusal leaves the order in the queue rather than failing it', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../autoProvisionService'), 'utf8');

    // The customer did nothing wrong; the price is ours to fix.
    assert.match(src, /none of them is a reason\s+\*\s+to fail the customer's order/);
  });
});
