/**
 * What a customer is offered when their order is held.
 *
 * Every hold message already said "pick a different machine" or "pick a region
 * we already run in". All of them were true and none of them said which, so
 * the customer was sent back to the catalogue to work out for themselves which
 * machine runs their model, exists where they want it, and is sellable today —
 * three facts the platform holds and they do not.
 *
 * Every test here is a way that offer becomes wrong: a machine that cannot
 * load the model, a region that is no readier than the one they are waiting
 * on, an upsell taken out of their inconvenience.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const alt = require('../holdAlternative');
const hold = require('../deploymentHold');

/** A model that needs a real GPU. */
const MODEL = { minVramGb: 24, minGpuCount: 1, minVcpu: 8, minRamGb: 32 };

const tier = (name, over = {}) => ({
  name, vramGb: 40, gpuCount: 1, vcpu: 16, ramGb: 64, ...over,
});

const place = (tierId, region, pricePerHour, over = {}) => ({
  tierId, region, pricePerHour, tier: tier(tierId), regionReady: true, ...over,
});

const CURRENT = { tierId: 'a10', region: 'ap-south', pricePerHour: 2.0 };

describe('a machine that cannot run the model is never offered', () => {
  test('too little VRAM is excluded', () => {
    assert.equal(alt.canRun(tier('small', { vramGb: 16 }), MODEL), false);
  });

  test('too few GPUs is excluded', () => {
    assert.equal(alt.canRun(tier('cpu', { gpuCount: 0 }), MODEL), false);
  });

  test('too little CPU or RAM is excluded', () => {
    assert.equal(alt.canRun(tier('thin', { vcpu: 2 }), MODEL), false);
    assert.equal(alt.canRun(tier('thin', { ramGb: 8 }), MODEL), false);
  });

  test('a tier that clears every floor is allowed', () => {
    assert.equal(alt.canRun(tier('ok'), MODEL), true);
  });

  test('a floor of 0 means "not stated" and never excludes', () => {
    /*
     * Most models in the catalogue predate these fields and read 0 on all
     * four. Treating 0 as a requirement would offer them nothing at all.
     */
    const unstated = { minVramGb: 0, minGpuCount: 0, minVcpu: 0, minRamGb: 0 };
    assert.equal(alt.canRun(tier('tiny', { vramGb: 0, gpuCount: 0, vcpu: 1, ramGb: 1 }), unstated), true);
  });

  test('and the whole offer refuses rather than suggesting something short', () => {
    const offer = alt.choose({
      kind: 'repricing',
      model: MODEL,
      current: CURRENT,
      places: [place('tiny', 'ap-south', 0.5, { tier: tier('tiny', { vramGb: 8, gpuCount: 0 }) })],
    });

    assert.equal(offer.ok, false);
    assert.equal(offer.code, 'NOTHING_ELSE');
  });
});

describe('what is offered for each kind of wait', () => {
  const places = [
    place('a10', 'ap-south', 2.0),      // what they ordered
    place('a10', 'eu-central', 1.8),    // same machine, elsewhere
    place('l4', 'ap-south', 1.5),       // different machine, same place
  ];

  test('a price hold can be answered either way', () => {
    const offer = alt.choose({ kind: 'repricing', model: MODEL, current: CURRENT, places });

    assert.ok(offer.ok);
    assert.ok(offer.sameMachineElsewhere, 'the same machine elsewhere is an answer');
    assert.ok(offer.differentMachineHere, 'so is a different machine here');
  });

  test('a capacity hold likewise', () => {
    const offer = alt.choose({ kind: 'capacity', model: MODEL, current: CURRENT, places });
    assert.ok(offer.ok);
    assert.ok(offer.sameMachineElsewhere || offer.differentMachineHere);
  });

  test('a region hold offers only another region, never another machine', () => {
    /*
     * Nothing is wrong with the machine — the region simply has no network
     * yet. Offering a different machine would answer a question nobody asked,
     * and the customer chose that machine for a reason.
     */
    const offer = alt.choose({ kind: 'region', model: MODEL, current: CURRENT, places });

    assert.ok(offer.ok);
    assert.equal(offer.differentMachineHere, null, 'a region hold must not change the machine');
    assert.equal(offer.lead.tierId, 'a10', 'the machine they picked, somewhere else');
    assert.equal(offer.lead.region, 'eu-central');
  });

  test('a funding hold is not answered with a machine at all', () => {
    // It is fixed by paying, and suggesting a cheaper machine to someone short
    // of credit is both unhelpful and a little insulting.
    const offer = alt.choose({ kind: 'funds', model: MODEL, current: CURRENT, places });
    assert.equal(offer.ok, false);
    assert.equal(offer.code, 'NOT_APPLICABLE');
  });

  test('every hold kind is accounted for', () => {
    // A kind added later with no entry here would silently offer nothing.
    for (const kind of Object.values(hold.KINDS)) {
      assert.ok(kind in alt.BY_KIND, `${kind} has no alternative strategy`);
    }
  });
});

describe('a region that is not ready is not an alternative', () => {
  test('an unbuilt region is excluded', () => {
    /*
     * Moving a customer from one wait to an identical wait is worse than
     * saying nothing — it costs them a decision as well as the time.
     */
    const offer = alt.choose({
      kind: 'region',
      model: MODEL,
      current: CURRENT,
      places: [place('a10', 'us-east', 1.9, { regionReady: false })],
    });

    assert.equal(offer.ok, false);
    assert.equal(offer.code, 'NOTHING_ELSE');
  });

  test('and a ready one is taken instead', () => {
    const offer = alt.choose({
      kind: 'region',
      model: MODEL,
      current: CURRENT,
      places: [
        place('a10', 'us-east', 1.0, { regionReady: false }),
        place('a10', 'eu-central', 1.9),
      ],
    });

    assert.ok(offer.ok);
    assert.equal(offer.lead.region, 'eu-central', 'the cheaper one is not built yet');
  });

  test('an unpriced place is never offered', () => {
    // A price of 0 means the cell never got a figure. Offering it would be
    // offering a machine at no charge.
    const offer = alt.choose({
      kind: 'repricing',
      model: MODEL,
      current: CURRENT,
      places: [place('l4', 'ap-south', 0)],
    });
    assert.equal(offer.ok, false);
  });
});

describe('the customer is never upsold out of their own inconvenience', () => {
  test('the cheapest workable option leads', () => {
    const offer = alt.choose({
      kind: 'repricing',
      model: MODEL,
      current: CURRENT,
      places: [
        place('h100', 'ap-south', 9.0),
        place('l4', 'ap-south', 1.5),
        place('a100', 'ap-south', 4.0),
      ],
    });

    assert.equal(offer.lead.tierId, 'l4');
  });

  test('and paying less is said out loud', () => {
    const offer = alt.choose({
      kind: 'repricing',
      model: MODEL,
      current: CURRENT,
      places: [place('l4', 'ap-south', 1.5)],
    });

    assert.equal(offer.cheaper, true);
    assert.match(alt.describe(offer, { kind: 'repricing' }).body, /costs less/);
  });

  test('a dearer alternative is still offered, but not called cheaper', () => {
    // Sometimes the only thing that runs the model costs more. Saying so is
    // honest; claiming a saving that is not there is not.
    const offer = alt.choose({
      kind: 'repricing',
      model: MODEL,
      current: CURRENT,
      places: [place('a100', 'ap-south', 4.0)],
    });

    assert.ok(offer.ok);
    assert.equal(offer.cheaper, false);
    assert.ok(!/costs less/.test(alt.describe(offer, { kind: 'repricing' }).body));
  });

  test('at equal price, the machine with less idle hardware wins', () => {
    const offer = alt.choose({
      kind: 'repricing',
      model: MODEL,
      current: CURRENT,
      places: [
        place('quad', 'ap-south', 2.0, { tier: tier('quad', { gpuCount: 4, vramGb: 160 }) }),
        place('single', 'ap-south', 2.0, { tier: tier('single', { gpuCount: 1, vramGb: 40 }) }),
      ],
    });

    assert.equal(offer.lead.tierId, 'single', 'four idle GPUs at the same price helps nobody');
  });
});

describe('what the customer reads', () => {
  const offer = alt.choose({
    kind: 'repricing',
    model: MODEL,
    current: CURRENT,
    places: [place('l4', 'ap-south', 1.5)],
  });

  test('it names the machine, the place and the price', () => {
    const text = alt.describe(offer, { kind: 'repricing' });
    assert.match(text.body, /l4/);
    assert.match(text.body, /ap-south/);
    assert.match(text.body, /\$1\.5000\/hr/);
  });

  test('it says it would start now, which is the point', () => {
    assert.match(alt.describe(offer, { kind: 'repricing' }).body, /start straight away/);
  });

  test('and it never leaks what anything costs us', () => {
    for (const kind of ['repricing', 'capacity', 'region']) {
      const o = alt.choose({
        kind,
        model: MODEL,
        current: CURRENT,
        places: [place('l4', 'ap-south', 1.5), place('a10', 'eu-central', 1.8)],
      });
      const text = JSON.stringify(alt.describe(o, { kind }));

      for (const leak of [/margin/i, /\bfloor\b/i, /costs? us/i, /profit/i, /overhead/i]) {
        assert.ok(!leak.test(text), `${kind}: "${text}" leaks ${leak}`);
      }
    }
  });

  test('nothing to offer produces null, not an empty promise', () => {
    assert.equal(alt.describe({ ok: false }, { kind: 'repricing' }), null);
  });
});
