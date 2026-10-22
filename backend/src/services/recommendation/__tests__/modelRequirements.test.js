/**
 * A model's own hardware floor, as opposed to what a customer's answers imply.
 *
 * ── The distinction these tests exist to hold ──
 *
 *   the model's floor    what it needs to LOAD. Not negotiable, and nothing to
 *                        do with how busy anyone expects it to be.
 *   the answers' floor   what the workload suggests. Advice: it ranks machines
 *                        and warns, and never refuses an order.
 *
 * Until now a model stated only its VRAM. Cards, cores and memory were taken
 * from the answers alone — so a model needing two cards sat happily at the top
 * of a one-card tier's ranking, because nobody had said anything about traffic.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const tierScorer = require('../tierScorer');

/** A tier as the scorer receives it. */
const tier = (over = {}) => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`,
  name: 'probe tier',
  gpuModel: 'NVIDIA A100 40GB',
  gpuCount: 1,
  vramGb: 40,
  vcpu: 8,
  ramGb: 64,
  storageGb: 100,
  storageType: 'SSD',
  pricePerHour: 1,
  stoppedPricePerHour: 0.1,
  currency: 'USD',
  status: 'available',
  capacityTotal: 0,
  capacityAllocated: 0,
  isActive: true,
  displayOrder: 0,
  ...over,
});

const model = (over = {}) => ({
  id: 'm-1',
  name: 'Probe Model',
  minVramGb: 0,
  minGpuCount: 0,
  minVcpu: 0,
  minRamGb: 0,
  supportedTiers: [],
  ...over,
});

/** A profile with nothing asked for, so only the model's floor can bite. */
const emptyProfile = () => ({
  floors: {
    minVramGb: 0, minGpuCount: 0, minVcpu: 0, minRamGb: 0, minContextLength: 0,
  },
  ceilings: { maxMonthlyBudget: null, maxPricePerHour: null },
  priorities: { costPriority: null, latencyPriority: null },
});

const { DEFAULT_POLICY } = require('../policyDefaults');

/**
 * Score one tier against one model, and hand back its issues.
 *
 * `scoreTiers` takes positional arguments and wants facts, not tiers — the
 * link between a model and a tier carries the price multiplier, so a tier on
 * its own cannot be scored.
 */
const scoreOne = (m, t, profile = emptyProfile()) => {
  const link = { tierId: t.id, tierName: t.name, priceMultiplier: 1, recommended: false };
  const withLink = { ...m, supportedTiers: [link] };

  const facts = tierScorer.buildFacts(withLink, [t], 0, DEFAULT_POLICY);
  return tierScorer.scoreTiers(withLink, facts, profile, DEFAULT_POLICY)[0];
};

describe("a model's own floors are read, not just its VRAM", () => {
  test('a model needing two cards is short on a one-card tier', () => {
    const got = scoreOne(model({ minGpuCount: 2 }), tier({ gpuCount: 1 }));
    const codes = (got?.issues || []).map((i) => i.code);

    // Nothing was said about traffic. Before this, that meant nothing was
    // checked, and a one-card tier ranked as a clean fit.
    assert.ok(codes.includes('GPU_COUNT_SHORTFALL'), codes.join(', '));
  });

  test('a model needing more cores is short on a smaller tier', () => {
    const got = scoreOne(model({ minVcpu: 16 }), tier({ vcpu: 8 }));
    assert.ok((got?.issues || []).some((i) => i.code === 'VCPU_SHORTFALL'));
  });

  test('a model needing more memory is short on a smaller tier', () => {
    const got = scoreOne(model({ minRamGb: 128 }), tier({ ramGb: 64 }));
    assert.ok((got?.issues || []).some((i) => i.code === 'RAM_SHORTFALL'));
  });

  test('VRAM still works, as it always did', () => {
    const got = scoreOne(model({ minVramGb: 80 }), tier({ vramGb: 40, gpuCount: 1 }));
    assert.equal(got?.meetsVram, false);
  });

  test('a tier that meets every floor has no shortfall at all', () => {
    const got = scoreOne(
      model({ minVramGb: 40, minGpuCount: 1, minVcpu: 8, minRamGb: 64 }),
      tier(),
    );
    const codes = (got?.issues || []).map((i) => i.code);

    for (const shortfall of ['GPU_COUNT_SHORTFALL', 'VCPU_SHORTFALL', 'RAM_SHORTFALL']) {
      assert.ok(!codes.includes(shortfall), `${shortfall} should not fire: ${codes.join(', ')}`);
    }
  });
});

describe('the stricter of the two wins', () => {
  test("the customer's answer wins when it asks for more", () => {
    const profile = emptyProfile();
    profile.floors.minGpuCount = 4;

    const got = scoreOne(model({ minGpuCount: 2 }), tier({ gpuCount: 2 }), profile);
    const issue = (got?.issues || []).find((i) => i.code === 'GPU_COUNT_SHORTFALL');

    assert.ok(issue, 'two cards is enough for the model but not for the workload');
    assert.match(issue.message, /4/);
  });

  test('the model wins when IT asks for more', () => {
    const profile = emptyProfile();
    profile.floors.minGpuCount = 1;

    const got = scoreOne(model({ minGpuCount: 4 }), tier({ gpuCount: 2 }), profile);
    const issue = (got?.issues || []).find((i) => i.code === 'GPU_COUNT_SHORTFALL');

    assert.ok(issue);
    assert.match(issue.message, /4/);
  });

  test('neither asking means nothing is checked', () => {
    const got = scoreOne(model(), tier({ gpuCount: 0, vcpu: 1, ramGb: 1 }));
    const codes = (got?.issues || []).map((i) => i.code);

    /*
     * The migration defaults every existing model to 0. A model nobody has
     * filled in must not start refusing the machines that have been running it.
     */
    for (const shortfall of ['GPU_COUNT_SHORTFALL', 'VCPU_SHORTFALL', 'RAM_SHORTFALL']) {
      assert.ok(!codes.includes(shortfall), codes.join(', '));
    }
  });
});

describe('a shortfall ranks and warns — it does not reject', () => {
  test('an undersized tier is still returned, with its problem attached', () => {
    const got = scoreOne(model({ minGpuCount: 8 }), tier({ gpuCount: 1 }));

    // The scorer's own governing rule: constraints rank and warn, they never
    // reject. A customer who wants it anyway is allowed to have it.
    assert.ok(got, 'the tier must still come back');
    assert.ok((got.issues || []).length > 0);
  });

  test('a fitting tier outranks one that is short', () => {
    const m = model({ minGpuCount: 2 });
    const short = scoreOne(m, tier({ gpuCount: 1, pricePerHour: 0.5 }));
    const fits = scoreOne(m, tier({ gpuCount: 2, pricePerHour: 2 }));

    // Even though the short one is cheaper.
    assert.ok(
      (fits?.score ?? 0) > (short?.score ?? 0),
      `fits ${fits?.score} vs short ${short?.score}`,
    );
  });
});
