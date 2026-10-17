/**
 * Tests for turning AWS's price list into rates.
 *
 * One instance type has dozens of prices in AWS's catalogue and only one of
 * them is what this platform gets charged. Every bug available here produces a
 * **confidently wrong number** rather than an error — which is the one failure
 * the margin guard cannot protect against, because it is being fed the bad
 * figure:
 *
 *   - a Windows price for the same hardware (roughly double)
 *   - a SQL-Server-preinstalled price (far more)
 *   - a Dedicated-tenancy price (much higher)
 *   - a capacity-reservation price (reservation accounting, not on-demand)
 *   - a per-second price read as per-hour
 *
 * So the fixtures below deliberately contain all of those wrong answers
 * alongside the right one, and the tests check the right one is picked.
 *
 * Pure: no network, no clock.
 *
 * Run with:  node --test src/services/aws/__tests__/awsPriceParser.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const parser = require('../awsPriceParser');

/** A price-list entry in the shape GetProducts returns: a JSON string. */
const product = ({
  sku = 'SKU1',
  productFamily = 'Compute Instance',
  attributes = {},
  price = '0.1920000000',
  unit = 'Hrs',
  currency = 'USD',
}) => JSON.stringify({
  product: { sku, productFamily, attributes },
  terms: {
    OnDemand: {
      [`${sku}.JRTCKXETXF`]: {
        priceDimensions: {
          [`${sku}.JRTCKXETXF.6YS6EN2CT7`]: {
            unit,
            pricePerUnit: { [currency]: price },
          },
        },
      },
    },
  },
});

/** The attributes of the one price that is actually right. */
const correct = {
  instanceType: 'm6i.xlarge',
  operatingSystem: 'Linux',
  preInstalledSw: 'NA',
  tenancy: 'Shared',
  capacitystatus: 'Used',
  regionCode: 'eu-west-1',
};

/** The right answer, buried among five plausible wrong ones. */
const PRICE_LIST = [
  product({ sku: 'RIGHT', attributes: correct, price: '0.1920000000' }),
  product({ sku: 'WIN', attributes: { ...correct, operatingSystem: 'Windows' }, price: '0.3760000000' }),
  product({ sku: 'SQL', attributes: { ...correct, preInstalledSw: 'SQL Std' }, price: '1.0000000000' }),
  product({ sku: 'DED', attributes: { ...correct, tenancy: 'Dedicated' }, price: '0.2112000000' }),
  product({ sku: 'RES', attributes: { ...correct, capacitystatus: 'UnusedCapacityReservation' }, price: '0.1000000000' }),
  product({ sku: 'OTHERREGION', attributes: { ...correct, regionCode: 'us-east-1' }, price: '0.1710000000' }),
  // Volumes.
  product({
    sku: 'GP3', productFamily: 'Storage', unit: 'GB-Mo', price: '0.0880000000',
    attributes: { volumeApiName: 'gp3', regionCode: 'eu-west-1' },
  }),
  product({
    sku: 'IO2', productFamily: 'Storage', unit: 'GB-Mo', price: '0.1380000000',
    attributes: { volumeApiName: 'io2', regionCode: 'eu-west-1' },
  }),
  product({
    sku: 'ST1', productFamily: 'Storage', unit: 'GB-Mo', price: '0.0153000000',
    attributes: { volumeApiName: 'st1', regionCode: 'eu-west-1' },
  }),
];

/* ── Picking the right price out of the wrong ones ───────────────────────── */

test('the Linux, shared, no-extras, on-demand price is the one chosen', () => {
  const r = parser.instanceRateFrom(PRICE_LIST, {
    instanceType: 'm6i.xlarge', regionCode: 'eu-west-1',
  });
  assert.strictEqual(r.ok, true, r.notes.join(' | '));
  assert.strictEqual(r.instanceHour, 0.192);
  assert.strictEqual(r.matched.sku, 'RIGHT');
});

test('a Windows price for the same hardware is never used', () => {
  // Roughly double, because it includes a licence.
  const r = parser.instanceRateFrom(PRICE_LIST, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.notStrictEqual(r.instanceHour, 0.376);
});

test('a pre-installed-software price is never used', () => {
  const r = parser.instanceRateFrom(PRICE_LIST, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.notStrictEqual(r.instanceHour, 1);
});

test('a dedicated-tenancy price is never used', () => {
  const r = parser.instanceRateFrom(PRICE_LIST, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.notStrictEqual(r.instanceHour, 0.2112);
});

test('a capacity-reservation price is never used — that is not what a launch costs', () => {
  const r = parser.instanceRateFrom(PRICE_LIST, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.notStrictEqual(r.instanceHour, 0.1);
});

test("another region's price is never used", () => {
  const r = parser.instanceRateFrom(PRICE_LIST, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.notStrictEqual(r.instanceHour, 0.171);
});

test('a price quoted per second is skipped, not read as hourly', () => {
  // Out by a factor of 3600 in the direction that makes everything look cheap.
  const list = [product({ sku: 'SEC', attributes: correct, unit: 'Seconds', price: '0.0000533' })];
  const r = parser.instanceRateFrom(list, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.notes.some((n) => /per "Seconds"/.test(n)), r.notes.join(' | '));
});

/* ── Ambiguity is reported, not hidden ──────────────────────────────────── */

test('two matching prices take the HIGHER one and say so', () => {
  /*
   * Two survivors means a filter is not narrow enough. Taking the lower would
   * understate cost, and understating is the direction that approves a
   * loss-making tier.
   */
  const list = [
    product({ sku: 'A', attributes: correct, price: '0.1920000000' }),
    product({ sku: 'B', attributes: correct, price: '0.2000000000' }),
  ];
  const r = parser.instanceRateFrom(list, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.strictEqual(r.instanceHour, 0.2);
  assert.ok(r.notes.some((n) => /2 on-demand prices matched/.test(n)), r.notes.join(' | '));
});

/* ── Nothing found ──────────────────────────────────────────────────────── */

test('an instance type with no price refuses and names it', () => {
  const r = parser.instanceRateFrom(PRICE_LIST, { instanceType: 'p5.48xlarge', regionCode: 'eu-west-1' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.instanceHour, null);
  assert.match(r.notes[0], /p5\.48xlarge/);
});

test('an empty or junk price list refuses rather than throwing', () => {
  for (const bad of [[], null, undefined, ['not json'], [{}], [null]]) {
    const r = parser.instanceRateFrom(bad, { instanceType: 'm6i.xlarge' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.instanceHour, null);
  }
});

test('a zero price is a real published price and is kept', () => {
  // Free tier, or a credit netting out. Treating it as absent would be wrong.
  const list = [product({ sku: 'FREE', attributes: correct, price: '0.0000000000' })];
  const r = parser.instanceRateFrom(list, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.strictEqual(r.ok, true, r.notes.join(' | '));
  assert.strictEqual(r.instanceHour, 0);
});

/* ── Volumes, keyed by the platform's own names ──────────────────────────── */

test("volume prices come back under the platform's storage labels, not AWS's", () => {
  /*
   * Keyed by what the TIER says ("NVMe SSD"), because that is what the cost
   * model looks up — and derived from the same table that decides which EBS
   * type actually gets built, so the two cannot drift. That exact drift
   * shipped once on the GCP side.
   */
  const { diskGbMonth } = parser.volumeRatesFrom(PRICE_LIST, { regionCode: 'eu-west-1' });
  assert.strictEqual(diskGbMonth['NVMe SSD'], 0.138); // io2
  assert.strictEqual(diskGbMonth.SSD, 0.088); // gp3
  assert.strictEqual(diskGbMonth.HDD, 0.0153); // st1
});

test('a volume type with no price is left out, so the cost model refuses', () => {
  const partial = PRICE_LIST.filter((e) => !e.includes('"io2"'));
  const { diskGbMonth, notes } = parser.volumeRatesFrom(partial, { regionCode: 'eu-west-1' });
  assert.strictEqual(diskGbMonth['NVMe SSD'], undefined);
  assert.ok(notes.some((n) => /io2/.test(n)), notes.join(' | '));
});

test('IOPS and throughput lines are not mistaken for capacity', () => {
  // Billed separately from capacity; reading one as a per-GB price would be
  // wildly wrong in either direction.
  const list = [
    product({
      sku: 'IOPS', productFamily: 'Storage', unit: 'IOPS-Mo', price: '0.0650000000',
      attributes: { volumeApiName: 'gp3', regionCode: 'eu-west-1' },
    }),
  ];
  const { diskGbMonth } = parser.volumeRatesFrom(list, { regionCode: 'eu-west-1' });
  assert.strictEqual(diskGbMonth.SSD, undefined);
});

/* ── The whole thing together ───────────────────────────────────────────── */

test('ratesFromPriceList produces exactly what the cost model wants', () => {
  const { rates } = parser.ratesFromPriceList(PRICE_LIST, {
    instanceType: 'm6i.xlarge', regionCode: 'eu-west-1',
  });
  assert.strictEqual(rates.instanceHour, 0.192);
  assert.strictEqual(rates.diskGbMonth.SSD, 0.088);
  assert.strictEqual(rates.currency, 'USD');

  // And it actually costs a machine, end to end.
  const costModel = require('../../cloud/costModel');
  const cost = costModel.costOf({
    components: { vcpu: 4, ramGb: 16, storageGb: 100, storageType: 'SSD' },
    rates,
  });
  assert.strictEqual(cost.ok, true, cost.missing.join(', '));
  assert.strictEqual(cost.direct.instance, 0.192);
});

test('an already-parsed object is accepted as well as a JSON string', () => {
  // GetProducts returns strings, but a cache or a test may hold objects.
  const asObjects = PRICE_LIST.map((s) => JSON.parse(s));
  const r = parser.instanceRateFrom(asObjects, { instanceType: 'm6i.xlarge', regionCode: 'eu-west-1' });
  assert.strictEqual(r.instanceHour, 0.192);
});
