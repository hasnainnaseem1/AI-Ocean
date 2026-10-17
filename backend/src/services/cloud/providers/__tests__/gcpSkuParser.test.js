/**
 * Tests for turning Google's SKU catalogue into component rates.
 *
 * The fixtures below are shaped exactly like what the Cloud Billing catalogue
 * returns, because every bug available in this file is a *parsing* bug and each
 * one produces a wrong price rather than an error:
 *
 *   - reading `units` and ignoring `nanos` prices a vCPU at exactly zero
 *   - matching "N2" against an "N2D" SKU prices the wrong family
 *   - taking a preemptible SKU understates every machine
 *   - taking the Custom SKU for a predefined machine, or the reverse
 *   - taking a SKU from another region
 *
 * None of those throw. All of them would quietly approve a tier that loses
 * money, which is what the margin guard exists to prevent.
 *
 * Run with:  node --test src/services/cloud/providers/__tests__/gcpSkuParser.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const { ratesFromSkus, priceOf, familyOf, describesFamily } = require('../gcpSkuParser');

const REGION = 'europe-west4';

/** A SKU in the shape the catalogue actually returns. */
const sku = ({
  description,
  units = '0',
  nanos = 0,
  resourceFamily = 'Compute',
  resourceGroup = 'CPU',
  usageType = 'OnDemand',
  regions = [REGION],
  currency = 'USD',
}) => ({
  skuId: description.slice(0, 12),
  description,
  category: { resourceFamily, resourceGroup, usageType, serviceDisplayName: 'Compute Engine' },
  serviceRegions: regions,
  pricingInfo: [{
    pricingExpression: {
      usageUnit: 'h',
      tieredRates: [{ startUsageAmount: 0, unitPrice: { currencyCode: currency, units, nanos } }],
    },
  }],
});

const CATALOGUE = [
  sku({ description: 'E2 Instance Core running in Netherlands', nanos: 21811000 }),
  sku({ description: 'E2 Instance Ram running in Netherlands', nanos: 2923000 }),
  sku({ description: 'E2 Custom Instance Core running in Netherlands', nanos: 23000000 }),
  sku({ description: 'E2 Custom Instance Ram running in Netherlands', nanos: 3100000 }),
  sku({ description: 'N2 Instance Core running in Netherlands', nanos: 31611000 }),
  sku({ description: 'N2 Instance Ram running in Netherlands', nanos: 4237000 }),
  sku({ description: 'N2D Instance Core running in Netherlands', nanos: 27500000 }),
  sku({
    description: 'Nvidia Tesla T4 GPU running in Netherlands',
    nanos: 350000000, resourceGroup: 'GPU',
  }),
  sku({
    description: 'Nvidia L4 GPU running in Netherlands',
    units: '0', nanos: 644000000, resourceGroup: 'GPU',
  }),
  sku({
    description: 'SSD backed PD Capacity in Netherlands',
    nanos: 187000000, resourceFamily: 'Storage', resourceGroup: 'SSD',
  }),
  sku({
    description: 'Storage PD Capacity in Netherlands',
    nanos: 44000000, resourceFamily: 'Storage', resourceGroup: 'PDStandard',
  }),
];

/* ── Reading a price ─────────────────────────────────────────────────────── */

test('a price is units AND nanos — nanos alone is where small prices live', () => {
  // Reading only `units` prices a vCPU-hour at exactly zero, and every machine
  // then looks free.
  assert.strictEqual(priceOf({ units: '0', nanos: 31611000 }), 0.031611);
  assert.strictEqual(priceOf({ units: '2', nanos: 500000000 }), 2.5);
  assert.strictEqual(priceOf({ units: '3', nanos: 0 }), 3);
});

test('a missing price is null, not zero', () => {
  assert.strictEqual(priceOf(null), null);
  assert.strictEqual(priceOf(undefined), null);
});

/* ── Family matching ─────────────────────────────────────────────────────── */

test('the family comes from the machine type, custom or not', () => {
  assert.strictEqual(familyOf('e2-medium'), 'e2');
  assert.strictEqual(familyOf('n2-highmem-32'), 'n2');
  assert.strictEqual(familyOf('e2-custom-16-32768'), 'e2');
  assert.strictEqual(familyOf('a2-ultragpu-1g'), 'a2');
});

test('N2 does not match an N2D SKU — they are different machines at different prices', () => {
  assert.strictEqual(describesFamily('N2D Instance Core running in X', 'n2'), false);
  assert.strictEqual(describesFamily('N2 Instance Core running in X', 'n2'), true);
});

/* ── Picking the right SKUs ──────────────────────────────────────────────── */

test('a predefined machine gets the plain family rates', () => {
  const { rates } = ratesFromSkus(CATALOGUE, { region: REGION, machineType: 'e2-medium' });
  assert.strictEqual(rates.vcpuHour, 0.021811);
  assert.strictEqual(rates.ramGbHour, 0.002923);
});

test('a custom machine gets the Custom rates, which are a different price', () => {
  const { rates } = ratesFromSkus(CATALOGUE, { region: REGION, machineType: 'e2-custom-16-32768' });
  assert.strictEqual(rates.vcpuHour, 0.023);
  assert.strictEqual(rates.ramGbHour, 0.0031);
});

test('asking for one family never returns another family\'s rate', () => {
  const { rates } = ratesFromSkus(CATALOGUE, { region: REGION, machineType: 'n2-highmem-32' });
  assert.strictEqual(rates.vcpuHour, 0.031611); // N2, not N2D's 0.0275
});

test('a family with no SKUs yields null rates and says so, rather than borrowing', () => {
  const { rates, notes } = ratesFromSkus(CATALOGUE, { region: REGION, machineType: 'c3-standard-4' });
  assert.strictEqual(rates.vcpuHour, null);
  assert.strictEqual(rates.ramGbHour, null);
  assert.ok(notes.length >= 2);
  assert.match(notes[0], /c3/);
});

test('a predefined machine does not fall back to Custom rates when the plain SKU is absent', () => {
  // Falling back would be a quiet price change, and in the direction that
  // understates cost whenever custom is cheaper.
  const onlyCustom = CATALOGUE.filter((s) => !/^E2 Instance/.test(s.description));
  const { rates } = ratesFromSkus(onlyCustom, { region: REGION, machineType: 'e2-medium' });
  assert.strictEqual(rates.vcpuHour, null);
});

/* ── What must be excluded ───────────────────────────────────────────────── */

test('preemptible SKUs are ignored — we do not buy machines that can vanish', () => {
  const withSpot = [
    sku({ description: 'Spot Preemptible E2 Instance Core running in Netherlands', nanos: 6500000, usageType: 'Preemptible' }),
    ...CATALOGUE,
  ];
  const { rates } = ratesFromSkus(withSpot, { region: REGION, machineType: 'e2-medium' });
  assert.strictEqual(rates.vcpuHour, 0.021811); // not the 0.0065 spot price
});

test('another region\'s SKU is ignored', () => {
  const elsewhere = [
    sku({ description: 'E2 Instance Core running in Americas', nanos: 1000000, regions: ['us-east4'] }),
    ...CATALOGUE,
  ];
  const { rates } = ratesFromSkus(elsewhere, { region: REGION, machineType: 'e2-medium' });
  assert.strictEqual(rates.vcpuHour, 0.021811);
});

test('a global SKU with no region list is accepted', () => {
  const global = [sku({ description: 'E2 Instance Core running Everywhere', nanos: 5000000, regions: [] })];
  const { rates } = ratesFromSkus(global, { region: REGION, machineType: 'e2-medium' });
  assert.strictEqual(rates.vcpuHour, 0.005);
});

/* ── GPUs and disks ──────────────────────────────────────────────────────── */

test('GPU SKUs are mapped to the platform\'s own model names', () => {
  const { rates } = ratesFromSkus(CATALOGUE, { region: REGION, machineType: 'n1-standard-4' });
  assert.strictEqual(rates.gpuHour['NVIDIA T4'], 0.35);
  assert.strictEqual(rates.gpuHour['NVIDIA L4'], 0.644);
});

test('A100 80GB is told apart from the 40GB card — they are not the same card', () => {
  const cards = [
    sku({ description: 'Nvidia Tesla A100 80GB GPU running in Netherlands', units: '3', nanos: 930000000, resourceGroup: 'GPU' }),
    sku({ description: 'Nvidia Tesla A100 GPU running in Netherlands', units: '2', nanos: 930000000, resourceGroup: 'GPU' }),
  ];
  const { rates } = ratesFromSkus(cards, { region: REGION, machineType: 'a2-highgpu-1g' });
  assert.strictEqual(rates.gpuHour['NVIDIA A100 80GB'], 3.93);
  // Not 'NVIDIA A100' — the catalogue's label for the 40GB card carries its
  // VRAM too, and the two cards must never collide under one key.
  assert.strictEqual(rates.gpuHour['NVIDIA A100 40GB'], 2.93);
});

test('disk SKUs are mapped to the platform\'s storage type names', () => {
  const { rates } = ratesFromSkus(CATALOGUE, { region: REGION, machineType: 'e2-medium' });
  // "SSD backed PD Capacity" is pd-ssd, which `resolveDiskType` builds for the
  // platform's "NVMe SSD" tier label — not for "SSD". Reading this rate under
  // the wrong key was the bug: a tier sold as "NVMe SSD" was being costed
  // against a different disk product than the one actually provisioned for it.
  assert.strictEqual(rates.diskGbMonth['NVMe SSD'], 0.187);
  assert.strictEqual(rates.diskGbMonth.HDD, 0.044);
});

test('"SSD" prices from the Balanced PD SKU, because that is the disk the platform builds for it', () => {
  const withBalanced = [
    ...CATALOGUE,
    sku({ description: 'Balanced PD Capacity in Netherlands', nanos: 104000000, resourceFamily: 'Storage', resourceGroup: 'SSD' }),
  ];
  const { rates } = ratesFromSkus(withBalanced, { region: REGION, machineType: 'e2-medium' });
  assert.strictEqual(rates.diskGbMonth.SSD, 0.104);
  // And it must stay distinct from pd-ssd's own price, which this same
  // catalogue also carries under 'NVMe SSD'.
  assert.notStrictEqual(rates.diskGbMonth.SSD, rates.diskGbMonth['NVMe SSD']);
});

/*
 * ── The contract with gcpMachineCatalog ──
 *
 * Every GPU and disk label this parser can produce has to be one
 * `gcpMachineCatalog.js` actually builds for, or a live price is read for a
 * machine that is never the machine provisioned — which is precisely the bug
 * fixed above. Rather than re-typing the catalogue's labels as a second copy
 * of the truth (which is what drifted last time), these tests import the real
 * catalogue and check the parser's output names against it directly.
 */
const catalog = require('../../../gcp/gcpMachineCatalog');

test('every GPU in the machine catalogue has a label this parser can find', () => {
  // One synthetic, realistic SKU per catalogue card — not the label itself,
  // the way Google would actually describe it, so this exercises the regex
  // rather than restating the assertion.
  const descriptions = {
    'NVIDIA A100 40GB': 'Nvidia Tesla A100 GPU running in Netherlands',
    'NVIDIA A100 80GB': 'Nvidia Tesla A100 80GB GPU running in Netherlands',
    'NVIDIA H100 80GB': 'Nvidia H100 80GB GPU running in Netherlands',
    'NVIDIA L4': 'Nvidia L4 GPU running in Netherlands',
    'NVIDIA T4': 'Nvidia Tesla T4 GPU running in Netherlands',
    'NVIDIA V100': 'Nvidia Tesla V100 GPU running in Netherlands',
  };

  const catalogueLabels = Object.values(catalog.GPUS).map((g) => g.label);
  assert.deepStrictEqual(
    Object.keys(descriptions).sort(),
    [...catalogueLabels].sort(),
    'this test\'s fixture fell out of step with gcpMachineCatalog.GPUS — add the new card here too'
  );

  for (const [label, description] of Object.entries(descriptions)) {
    const skus = [sku({ description, nanos: 500000000, resourceGroup: 'GPU' })];
    const { rates } = ratesFromSkus(skus, { region: REGION, machineType: 'a2-highgpu-1g' });
    assert.strictEqual(rates.gpuHour[label], 0.5, `"${description}" should price as "${label}"`);
  }
});

test('every disk type the mapper can build has a label this parser can find', () => {
  const descriptions = {
    'NVMe SSD': 'SSD backed PD Capacity in Netherlands',
    SSD: 'Balanced PD Capacity in Netherlands',
    HDD: 'Storage PD Capacity in Netherlands',
  };

  const catalogueLabels = catalog.DISK_TYPES.map((d) => d.label);
  assert.deepStrictEqual(
    Object.keys(descriptions).sort(),
    [...catalogueLabels].sort(),
    'this test\'s fixture fell out of step with gcpMachineCatalog.DISK_TYPES — add the new disk here too'
  );

  for (const [label, description] of Object.entries(descriptions)) {
    const skus = [sku({ description, nanos: 100000000, resourceFamily: 'Storage' })];
    const { rates } = ratesFromSkus(skus, { region: REGION, machineType: 'e2-medium' });
    assert.strictEqual(rates.diskGbMonth[label], 0.1, `"${description}" should price as "${label}"`);
  }
});

test('an unrecognised GPU or disk is left out rather than guessed at', () => {
  const odd = [
    sku({ description: 'Nvidia Tesla B200 GPU running in Netherlands', units: '9', resourceGroup: 'GPU' }),
    sku({ description: 'Hyperdisk Extreme Capacity in Netherlands', nanos: 1, resourceFamily: 'Storage' }),
  ];
  const { rates } = ratesFromSkus(odd, { region: REGION, machineType: 'a3-highgpu-8g' });
  assert.deepStrictEqual(rates.gpuHour, {});
  assert.deepStrictEqual(rates.diskGbMonth, {});
});

/* ── Robustness ──────────────────────────────────────────────────────────── */

test('an empty or junk catalogue yields nulls rather than throwing', () => {
  for (const input of [[], null, undefined, [{}], [{ category: null }]]) {
    const { rates } = ratesFromSkus(input, { region: REGION, machineType: 'e2-medium' });
    assert.strictEqual(rates.vcpuHour, null);
    assert.strictEqual(rates.currency, 'USD');
  }
});

test('the currency comes from the SKUs, not from an assumption', () => {
  const eur = [sku({ description: 'E2 Instance Core running in Netherlands', nanos: 2, currency: 'EUR' })];
  const { rates } = ratesFromSkus(eur, { region: REGION, machineType: 'e2-medium' });
  assert.strictEqual(rates.currency, 'EUR');
});
