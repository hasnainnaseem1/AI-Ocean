/**
 * Reading a region's standing cost from each cloud's published prices.
 *
 * The parsers are tested against the shapes the providers actually return. The
 * failure these guard against is the quiet one: a pattern that matches nothing
 * returns zero, and zero reads as "this region is free" — which prices a whole
 * region below cost without anything on a screen changing.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const { natGatewayRateFrom } = require('../../aws/awsPriceParser');
const { regionFixedCostFromSkus } = require('../providers/gcpSkuParser');

/* ── AWS: the Price List API's JSON shape ─────────────────────────────── */

const awsProduct = ({ family, usagetype, region, price, unit }) => JSON.stringify({
  product: {
    productFamily: family,
    attributes: { regionCode: region, usagetype },
  },
  terms: {
    OnDemand: {
      'X.Y': { priceDimensions: { 'X.Y.Z': { unit, pricePerUnit: { USD: String(price) } } } },
    },
  },
});

describe('AWS: the NAT gateway hourly charge', () => {
  const list = [
    awsProduct({ family: 'NAT Gateway', usagetype: 'EU-NatGateway-Hours', region: 'eu-west-1', price: 0.045, unit: 'Hrs' }),
    awsProduct({ family: 'NAT Gateway', usagetype: 'EU-NatGateway-Bytes', region: 'eu-west-1', price: 0.045, unit: 'GB' }),
    awsProduct({ family: 'NAT Gateway', usagetype: 'USE1-NatGateway-Hours', region: 'us-east-1', price: 0.045, unit: 'Hrs' }),
    awsProduct({ family: 'VpcEndpoint', usagetype: 'EU-VpcEndpoint-Hours', region: 'eu-west-1', price: 0.011, unit: 'Hrs' }),
  ];

  test('it finds the hourly rate for the asked-for region', () => {
    const got = natGatewayRateFrom(list, { regionCode: 'eu-west-1' });
    assert.equal(got.ok, true);
    assert.equal(got.natGatewayHour, 0.045);
  });

  test('it takes hours, NOT the per-GB data charge', () => {
    /*
     * Both are published under the same family at the same number. Taking the
     * GB one would add a per-gigabyte figure to an hourly cost, inflating
     * every price in the region by a factor of nothing in particular.
     */
    const got = natGatewayRateFrom(list, { regionCode: 'eu-west-1' });
    assert.match(got.matched.usagetype, /Hours$/);
    assert.match(String(got.matched.unit), /Hrs/i);
  });

  test('it ignores other VPC products billed by the hour', () => {
    // A VPC endpoint is also $/hr under AmazonVPC and would otherwise match.
    const got = natGatewayRateFrom(list, { regionCode: 'eu-west-1' });
    assert.notEqual(got.natGatewayHour, 0.011);
  });

  test('a region with no NAT price REFUSES rather than returning zero', () => {
    const got = natGatewayRateFrom(list, { regionCode: 'ap-south-1' });
    assert.equal(got.ok, false);
    assert.equal(got.natGatewayHour, null);
    assert.match(got.reason, /ap-south-1/);
  });

  test('an empty answer refuses too', () => {
    assert.equal(natGatewayRateFrom([], { regionCode: 'eu-west-1' }).ok, false);
    assert.equal(natGatewayRateFrom(null, { regionCode: 'eu-west-1' }).ok, false);
  });

  test('on ambiguity it takes the HIGHEST', () => {
    const two = [
      awsProduct({ family: 'NAT Gateway', usagetype: 'EU-NatGateway-Hours', region: 'eu-west-1', price: 0.045, unit: 'Hrs' }),
      awsProduct({ family: 'NAT Gateway', usagetype: 'EU-NatGateway-Hours', region: 'eu-west-1', price: 0.052, unit: 'Hrs' }),
    ];
    const got = natGatewayRateFrom(two, { regionCode: 'eu-west-1' });
    // Too high loses a sale; too low loses money every hour the region is open.
    assert.equal(got.natGatewayHour, 0.052);
    assert.ok(got.notes.some((n) => /highest/i.test(n)));
  });
});

/* ── Google: the Cloud Billing SKU shape ──────────────────────────────── */

const sku = ({ description, region, nanos, units = 0 }) => ({
  description,
  category: { usageType: 'OnDemand', resourceFamily: 'Network' },
  serviceRegions: region ? [region] : [],
  pricingInfo: [{
    pricingExpression: {
      tieredRates: [{ unitPrice: { units: String(units), nanos, currencyCode: 'USD' } }],
    },
  }],
});

describe('Google: Cloud NAT, split into standing and per-VM', () => {
  const skus = [
    sku({ description: 'NAT Gateway: IP address uptime charge', region: 'europe-west4', nanos: 5_000_000 }),
    sku({ description: 'NAT Gateway: VM instance uptime charge', region: 'europe-west4', nanos: 1_400_000 }),
    sku({ description: 'NAT Gateway: Data processed per GiB', region: 'europe-west4', nanos: 45_000_000 }),
    sku({ description: 'E2 Instance Core running in Netherlands', region: 'europe-west4', nanos: 21_811_000 }),
  ];

  test('the standing part and the per-VM part come back separately', () => {
    const got = regionFixedCostFromSkus(skus, { region: 'europe-west4' });

    assert.equal(got.ok, true);
    assert.equal(got.fixedCostPerHour, 0.005);
    assert.equal(got.perMachineCostPerHour, 0.0014);
  });

  test('the per-GiB data charge is excluded', () => {
    const got = regionFixedCostFromSkus(skus, { region: 'europe-west4' });
    // 0.045 would dwarf both real figures if it leaked into either.
    assert.notEqual(got.fixedCostPerHour, 0.045);
    assert.notEqual(got.perMachineCostPerHour, 0.045);
  });

  test('non-NAT SKUs are ignored', () => {
    const got = regionFixedCostFromSkus(skus, { region: 'europe-west4' });
    assert.ok(got.fixedCostPerHour < 0.01, 'a machine core price must not be read as a region cost');
  });

  test('another region is not matched', () => {
    const got = regionFixedCostFromSkus(skus, { region: 'asia-south1' });
    assert.equal(got.ok, false);
    assert.match(got.reason, /by hand/);
  });

  test('nothing recognised REFUSES rather than returning zero', () => {
    const got = regionFixedCostFromSkus([
      sku({ description: 'Something else entirely', region: 'europe-west4', nanos: 1 }),
    ], { region: 'europe-west4' });

    // Zero would read as "this region is free" and price it below cost.
    assert.equal(got.ok, false);
    assert.equal(got.fixedCostPerHour, null);
  });

  test('finding only one half still works, and says which is missing', () => {
    const got = regionFixedCostFromSkus([
      sku({ description: 'NAT Gateway: VM instance uptime charge', region: 'europe-west4', nanos: 1_400_000 }),
    ], { region: 'europe-west4' });

    assert.equal(got.ok, true);
    assert.equal(got.perMachineCostPerHour, 0.0014);
    assert.equal(got.fixedCostPerHour, 0);
    assert.ok(got.notes.some((n) => /standing/i.test(n)));
  });
});

describe('the Google catalogue is downloaded once, not once per lookup', () => {
  test('the cache key does not vary by region or machine type', () => {
    /*
     * `fetchSkus` pulls Google's ENTIRE Compute catalogue — every region, every
     * family — because the v1 list method has no useful server-side filter. The
     * cache used to be keyed by (region, family), so that one download repeated
     * for every key: three regions times five families is fifteen identical
     * full-catalogue downloads an hour.
     *
     * Now that the hourly price refresh asks for every tier in every region,
     * that would have been dozens. Asserted on the source because the download
     * itself cannot be exercised without a Google credential.
     */
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../providers/gcpPricing'), 'utf8');

    assert.match(src, /skuCacheKey\s*=\s*\(billingAccountId\)/);
    assert.ok(
      !/cacheKey\s*=\s*\(region,\s*machineType\)/.test(src),
      'the per-(region, machineType) SKU cache key must be gone',
    );
    // The billing account stays in the key: an account's negotiated prices
    // must never be served to a platform reading public list prices.
    assert.match(src, /billingAccountId \|\| 'list'/);
  });

  test('both lookups share the one catalogue fetch', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../providers/gcpPricing'), 'utf8');

    // `fetchSkus` is called in exactly one place now — inside `_skus`.
    const calls = (src.match(/await fetchSkus\(/g) || []).length;
    assert.equal(calls, 1, 'fetchSkus must have exactly one caller');

    assert.match(src, /async fetchRegionFixedCost\(/);
    assert.match(src, /this\._skus\(\{ force \}\)/);
  });
});
