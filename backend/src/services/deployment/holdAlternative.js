/**
 * Finding the customer a machine they can actually have right now.
 *
 * ── The promise this keeps ──
 *
 * Every hold message already ends with an offer:
 *
 *   repricing  "...or pick a different machine and we will start it straight away"
 *   capacity   "...picking a different machine or another region will usually start right away"
 *   region     "...or pick a region we already run in and it will start straight away"
 *
 * All three were true and all three were useless, because none of them said
 * WHICH. The customer was sent back to the catalogue to work out for
 * themselves which machine (a) runs their model, (b) exists where they want
 * it, and (c) is sellable today. Those are three facts the platform holds and
 * they do not.
 *
 * An offer the customer cannot act on is worse than no offer: it reads as
 * being brushed off. So this finds the alternative, or says plainly that
 * there isn't one.
 *
 * ── Why a different alternative per kind of hold ──
 *
 * The three waits have different causes, so the thing that fixes them
 * differs:
 *
 *   repricing  this tier's price is stale HERE. Another tier in the same
 *              region is priced and ready — so: change the machine.
 *   capacity   the cloud has no room for this SHAPE here. A different shape,
 *              or the same shape elsewhere, will start — so: either.
 *   region     nothing is built HERE yet. The same machine in a built region
 *              starts immediately — so: change the region, keep the machine.
 *
 * The region case is the one worth being careful about: suggesting a
 * different machine there would be answering a question nobody asked. What is
 * wrong is the place, not the machine, and the customer picked that machine
 * for a reason.
 *
 * ── What is never done ──
 *
 * Never suggests something below the model's floors. A machine that cannot
 * load the model is not an alternative, it is a refund and a support ticket —
 * and it would be offered by the platform itself, which makes it our mistake
 * rather than a thing they chose.
 *
 * Never names our cost, floor or margin, for the same reason the hold
 * messages do not. Pure: no database, no clock.
 */

/** Which of these a given hold can be answered with. */
const STRATEGY = {
  /** Same region, a different machine. */
  ANOTHER_MACHINE: 'another_machine',
  /** Same machine, a different region. */
  ANOTHER_REGION: 'another_region',
};

const BY_KIND = {
  repricing: [STRATEGY.ANOTHER_MACHINE, STRATEGY.ANOTHER_REGION],
  capacity: [STRATEGY.ANOTHER_MACHINE, STRATEGY.ANOTHER_REGION],
  // Deliberately region-only — see the header.
  region: [STRATEGY.ANOTHER_REGION],
  // A funding hold is not fixed by a different machine; it is fixed by paying.
  funds: [],
};

/**
 * Can this tier actually run the model?
 *
 * The same four floors the scorer enforces, applied again here because this is
 * a different entry point into the same question — and a suggestion is the one
 * place where getting it wrong is the platform's fault rather than the
 * customer's choice.
 *
 * A floor of 0 means "not stated", not "needs nothing", so it never excludes.
 */
const canRun = (tier, model) => {
  if (!tier || !model) return false;

  const needs = [
    [model.minVramGb, tier.vramGb],
    [model.minGpuCount, tier.gpuCount],
    [model.minVcpu, tier.vcpu],
    [model.minRamGb, tier.ramGb],
  ];

  return needs.every(([need, has]) => !need || Number(has || 0) >= Number(need));
};

/**
 * Rank the candidates and pick one.
 *
 * ── Why cheapest, and not "closest to what they chose" ──
 *
 * The customer is being told to take something other than what they wanted.
 * The least they are owed is that it does not cost them more. Offering a
 * dearer machine to someone whose order we have just held reads as an upsell
 * taken out of their inconvenience, and it is the kind of thing that is
 * remembered.
 *
 * Among equal prices, the one that runs the model with the least waste —
 * fewest idle GPUs — so a four-GPU tier is not offered when a one-GPU tier
 * at the same price would do.
 */
const rank = (candidates) => [...candidates].sort((a, b) => {
  if (a.pricePerHour !== b.pricePerHour) return a.pricePerHour - b.pricePerHour;
  const waste = (c) => (Number(c.tier?.vramGb || 0) + Number(c.tier?.gpuCount || 0) * 1000);
  return waste(a) - waste(b);
});

/**
 * Choose what to offer a held order.
 *
 * @param {object} input
 * @param {string} input.kind        the hold kind (`deploymentHold.KINDS`)
 * @param {object} input.model       the model, with its four floors
 * @param {object} input.current     `{ tierId, region, pricePerHour }` as ordered
 * @param {object[]} input.places    every sellable (tier × region) for this cloud:
 *   `{ tierId, tier, region, pricePerHour, regionReady }`
 *
 * @returns {{ok: boolean, …}} never throws; `ok:false` with a reason the
 *   caller can show, because "there is nothing else" is itself an answer the
 *   customer needs rather than silence.
 */
const choose = ({ kind, model, current, places = [] } = {}) => {
  const strategies = BY_KIND[kind] || [];
  if (!strategies.length) {
    return { ok: false, code: 'NOT_APPLICABLE', reason: 'This wait is not fixed by a different machine.' };
  }

  /*
   * Only places that would actually start. `regionReady` is false for a
   * region whose network does not exist yet — suggesting one of those would
   * move the customer from one wait to an identical wait, which is worse than
   * saying nothing because it costs them a decision as well.
   */
  const usable = places.filter((p) => (
    p.regionReady !== false
    && Number(p.pricePerHour) > 0
    && canRun(p.tier, model)
  ));

  if (!usable.length) {
    return {
      ok: false,
      code: 'NOTHING_ELSE',
      reason: 'Nothing else can run this model right now.',
    };
  }

  const out = {};

  if (strategies.includes(STRATEGY.ANOTHER_REGION)) {
    /*
     * The SAME machine somewhere else. Checked first for a region hold,
     * because there the machine was never the problem.
     */
    const sameTier = rank(usable.filter((p) => (
      p.tierId === current?.tierId && p.region !== current?.region
    )));
    if (sameTier.length) out.region = sameTier[0];
  }

  if (strategies.includes(STRATEGY.ANOTHER_MACHINE)) {
    // A different machine, in the region they asked for.
    const sameRegion = rank(usable.filter((p) => (
      p.region === current?.region && p.tierId !== current?.tierId
    )));
    if (sameRegion.length) out.machine = sameRegion[0];
  }

  if (!out.region && !out.machine) {
    return {
      ok: false,
      code: 'NOTHING_ELSE',
      reason: 'Nothing else is available for this model right now.',
    };
  }

  /*
   * Which to lead with. For a region hold the machine is not in question, so
   * the region offer leads; otherwise the cheaper of the two, because that is
   * the one most likely to be taken.
   */
  const lead = kind === 'region'
    ? (out.region || out.machine)
    : rank([out.region, out.machine].filter(Boolean))[0];

  return {
    ok: true,
    lead,
    sameMachineElsewhere: out.region || null,
    differentMachineHere: out.machine || null,
    // True when the customer would pay less than they agreed to. Worth saying
    // out loud: it turns an apology into good news.
    cheaper: Number(lead.pricePerHour) < Number(current?.pricePerHour || Infinity),
  };
};

/**
 * The offer in the customer's own words.
 *
 * Reads as a sentence they can act on, names the price, and — like every hold
 * message — never mentions what anything costs us.
 */
const describe = (offer, { kind } = {}) => {
  if (!offer?.ok) return null;

  const money = (n) => `$${Number(n).toFixed(4)}/hr`;
  const lead = offer.lead;
  const movingRegion = offer.sameMachineElsewhere === lead;

  const body = movingRegion
    ? `The same machine is ready in ${lead.region} at ${money(lead.pricePerHour)} and would start `
      + 'straight away.'
    : `${lead.tier?.name || 'Another machine'} is ready in ${lead.region} at `
      + `${money(lead.pricePerHour)} and would start straight away.`;

  return {
    title: kind === 'region' ? 'Available in another region now' : 'Available right now',
    body: offer.cheaper ? `${body} It also costs less than the one you picked.` : body,
    tierId: lead.tierId,
    tierName: lead.tier?.name || '',
    region: lead.region,
    pricePerHour: lead.pricePerHour,
    movingRegion,
  };
};

module.exports = {
  STRATEGY,
  BY_KIND,
  canRun,
  rank,
  choose,
  describe,
};
