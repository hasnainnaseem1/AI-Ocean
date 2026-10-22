/**
 * What a region costs, and how much of that each machine in it carries.
 *
 * ── The cost with no customer attached to it ──
 *
 * Opening a region is not free, and on AWS it is not cheap. A NAT gateway is
 * charged per availability zone whether zero machines use it or a hundred —
 * about $0.045 an hour each, so roughly $65 a month standing for a two-zone
 * region. Google bills NAT per VM instead, so the same region costs almost
 * nothing until it is used.
 *
 * Nothing in this platform used to account for that. A tier sold in a fresh
 * AWS region was priced on the machine alone, so the first customer there was
 * served at a loss that no screen could show.
 *
 * ── The two halves, and why they must not be added together ──
 *
 *   `fixedCostPerHour`      exists at zero machines → SPREAD across machines
 *   `perMachineCostPerHour` arrives with each machine → CHARGED per machine
 *
 * Folding the second into the first would be correct only at the exact moment
 * the region held precisely `assumedMachines` machines, and wrong the rest of
 * the time — under-recovering whenever the region is fuller than assumed,
 * which is the direction that loses money.
 *
 * ── `assumedMachines` is a judgement, and the honest one is small ──
 *
 * The true share is `fixed / howManyAreRunning`, but that number changes every
 * hour and a price that moved with it would charge two customers differently
 * for the same hour. So the operator picks a figure to spread the cost over.
 *
 * 1 is the only value that cannot lose money — and it also prices a new region
 * so high that it may never fill, which is its own kind of failure. That trade
 * is the operator's to make, so `recovery()` exists to show them exactly what
 * the current setting is costing while they decide.
 *
 * Pure: no database, no network, no clock.
 */

/** Never divide by zero, and never by a negative. */
const spreadOver = (assumedMachines) => {
  const n = Math.floor(Number(assumedMachines));
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Six places: a share spread over many machines is genuinely sub-cent. */
const round6 = (n) => Number(n.toFixed(6));

/**
 * What one machine in this region carries of the region's own cost.
 *
 * This is the figure that goes into every `TierPrice` row for this cloud and
 * region, on top of what the machine itself costs.
 */
const shareOf = ({ fixedCostPerHour, perMachineCostPerHour, assumedMachines } = {}) => {
  const fixed = num(fixedCostPerHour);
  const perMachine = num(perMachineCostPerHour);
  const spread = spreadOver(assumedMachines);

  return round6(fixed / spread + perMachine);
};

/**
 * Are we actually recovering what this region costs, right now?
 *
 * The question `assumedMachines` cannot answer on its own. If an operator
 * assumed ten machines and two are running, eight shares of the fixed cost are
 * being paid by nobody — and that is a real hourly loss, not a rounding error.
 *
 * Returns the gap in money rather than a percentage, because the decision it
 * informs ("lower the assumption, or wait for the region to fill") is about
 * money per hour.
 */
const recovery = ({ fixedCostPerHour, assumedMachines, liveMachines } = {}) => {
  const fixed = num(fixedCostPerHour);
  const spread = spreadOver(assumedMachines);
  const live = Math.max(0, Math.floor(Number(liveMachines)) || 0);

  // What each running machine contributes towards the fixed cost.
  const perMachineShare = fixed / spread;
  const recovered = round6(Math.min(live, spread) * perMachineShare);

  /*
   * Capped at the fixed cost: a region fuller than assumed over-recovers per
   * machine, but that is margin, not a negative shortfall. Reporting it as
   * "minus $0.04" would read as a credit we do not have.
   */
  const shortfallPerHour = round6(Math.max(0, fixed - recovered));

  return {
    fixedCostPerHour: round6(fixed),
    assumedMachines: spread,
    liveMachines: live,
    perMachineShare: round6(perMachineShare),
    recovered,
    shortfallPerHour,
    // True when the region is at least paying for itself.
    ok: shortfallPerHour === 0,
    /*
     * The number an operator actually acts on: how many more machines are
     * needed before the region covers its own standing cost at the current
     * setting. Zero when it already does.
     */
    machinesShort: Math.max(0, spread - live),
  };
};

/**
 * The same share at several machine counts, for the admin screen.
 *
 * An operator setting `assumedMachines` is choosing a point on a curve, and
 * the curve is steep at the low end — 1 machine carries twenty times what 20
 * do. Showing one number hides that; showing the ladder makes the choice
 * obvious.
 */
const ladder = ({ fixedCostPerHour, perMachineCostPerHour, counts = [1, 2, 5, 10, 25, 50] } = {}) =>
  counts.map((machines) => ({
    machines,
    sharePerHour: shareOf({ fixedCostPerHour, perMachineCostPerHour, assumedMachines: machines }),
  }));

/**
 * What this region costs us per hour in total, at a given occupancy.
 *
 * For the dashboard line "ap-south is costing $0.094/hr and recovering $0.018".
 */
const totalCostPerHour = ({ fixedCostPerHour, perMachineCostPerHour, liveMachines } = {}) => {
  const live = Math.max(0, Math.floor(Number(liveMachines)) || 0);
  return round6(num(fixedCostPerHour) + num(perMachineCostPerHour) * live);
};

module.exports = {
  shareOf,
  recovery,
  ladder,
  totalCostPerHour,
  // Exported so a caller that needs the same guard uses the same one.
  spreadOver,
};
