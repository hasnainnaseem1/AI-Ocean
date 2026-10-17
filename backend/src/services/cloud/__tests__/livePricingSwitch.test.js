/**
 * The per-cloud "price machines on this cloud" switch.
 *
 * ── Why this needed a test ──
 *
 * The switch was stored by the settings route and read by nothing. It rendered
 * as a control, an admin could turn it off, the setting was saved — and the
 * platform went on calling the provider's price API exactly as before. A
 * control that silently decides nothing is worse than no control: it is a
 * lever somebody will pull in an emergency, believing it did something.
 *
 * The AWS half was also hard-disabled with "not implemented yet", long after
 * AWS pricing was implemented.
 *
 * These assert the switch is honoured identically on both clouds.
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const realLoad = Module._load;
afterEach(() => { Module._load = realLoad; });

/** Rates a provider would return if asked. */
const LIVE_RATES = { instanceHour: 0.5, currency: 'USD' };

/**
 * Load `cloudPricing` with both providers stubbed, recording who got asked.
 */
const withProviders = (settings) => {
  const asked = [];

  Module._load = function patched(request, parent, isMain) {
    if (request.endsWith('providers/gcpPricing') || request.endsWith('aws/awsPricing')) {
      const name = request.endsWith('awsPricing') ? 'aws' : 'gcp';
      return {
        name,
        label: name === 'aws' ? 'AWS' : 'Google Cloud',
        isConfigured: async () => true,
        fetchRates: async () => {
          asked.push(name);
          return { ok: true, rates: LIVE_RATES, notes: [], reason: null };
        },
        clearCache: () => {},
      };
    }
    if (request.endsWith('admin/adminSettingsService')) {
      return { getSettings: async () => settings };
    }
    return realLoad(request, parent, isMain);
  };

  delete require.cache[require.resolve('../cloudPricing')];
  return { cloudPricing: require('../cloudPricing'), asked };
};

const settingsWith = (providers) => ({
  cloudPricingSettings: {
    overheadPercent: 0, overheadPerHour: 0, taxPercent: 0, targetMarginPercent: 0,
    ...(providers ? { providers } : {}),
  },
});

const quote = (cloudPricing, provider) => cloudPricing.costFor({
  provider,
  region: provider === 'aws' ? 'eu-west-1' : 'europe-west4',
  machineType: provider === 'aws' ? 'm6i.large' : 'e2-medium',
  components: { vcpu: 2, ramGb: 8 },
});

describe('switched ON, the cloud is asked for a live price', () => {
  for (const cloud of ['gcp', 'aws']) {
    test(`${cloud} is asked and the price is live`, async () => {
      const { cloudPricing, asked } = withProviders(settingsWith({ gcp: true, aws: true }));

      const result = await quote(cloudPricing, cloud);

      assert.deepEqual(asked, [cloud]);
      assert.equal(result.source, 'live');
      assert.equal(result.ok, true);
    });
  }
});

describe('switched OFF, the cloud is NOT asked', () => {
  for (const cloud of ['gcp', 'aws']) {
    test(`${cloud} falls back instead of calling the provider`, async () => {
      const { cloudPricing, asked } = withProviders(
        settingsWith({ gcp: cloud !== 'gcp', aws: cloud !== 'aws' })
      );

      const result = await quote(cloudPricing, cloud);

      assert.deepEqual(asked, [], `${cloud} must not be asked when its switch is off`);
      assert.notEqual(result.source, 'live');
      // And it says why, so "the price looks stale" has a visible cause.
      assert.ok(
        result.notes.some((n) => /switched off/i.test(n)),
        `expected a note explaining the switch; got ${JSON.stringify(result.notes)}`,
      );
    });
  }

  test('turning one off does not affect the other', async () => {
    const { cloudPricing, asked } = withProviders(settingsWith({ gcp: true, aws: false }));

    await quote(cloudPricing, 'aws');
    await quote(cloudPricing, 'gcp');

    assert.deepEqual(asked, ['gcp']);
  });
});

describe('the default is the same on both clouds', () => {
  test('with nothing configured, both are asked', async () => {
    const { cloudPricing, asked } = withProviders(settingsWith(null));

    await quote(cloudPricing, 'gcp');
    await quote(cloudPricing, 'aws');

    /*
     * A live price is the only one that is certainly current. A recorded table
     * goes stale quietly, and a stale figure that is too low means every
     * machine built on it loses money on every hour it runs.
     */
    assert.deepEqual(asked.sort(), ['aws', 'gcp']);
  });

  test('the shipped defaults say so too', () => {
    Module._load = realLoad;
    const defaults = require('../../admin/adminSettingsDefaults');
    const providers = defaults.cloudPricingSettings?.providers
      || defaults.defaults?.cloudPricingSettings?.providers;

    assert.ok(providers, 'cloudPricingSettings.providers must exist in the defaults');
    assert.equal(providers.gcp, true);
    assert.equal(providers.aws, true, 'AWS pricing is implemented; it must not ship switched off');
  });
});
