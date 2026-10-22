/**
 * Keeping `cloud_region_costs` up to date, and answering what a region costs.
 *
 * The thin layer between the pure arithmetic in `regionCost.js` and the two
 * providers that publish the figures. It owns three things:
 *
 *   - reading each cloud's standing cost for a region, live where published
 *   - counting what is actually running there
 *   - leaving an operator's own judgement (`assumedMachines`) alone
 *
 * ── Why a failed read never zeroes a stored figure ──
 *
 * A provider outage, an expired credential, a region whose SKU wording
 * changed: each of these makes the live lookup fail. Writing zero on failure
 * would make the region read as free and price every tier in it below cost —
 * silently, because zero is a perfectly ordinary-looking number.
 *
 * So a failed read keeps whatever is stored and records why. The figure goes
 * stale rather than wrong, and `costAsOf` makes the staleness visible.
 */
const prisma = require('../../lib/prismaClient');
const regionCost = require('./regionCost');
const cloudRegions = require('./cloudRegions');
const { CLOUDS } = require('./cloudRouter');

/** The providers that can be asked for a region's standing cost. */
const SOURCES = {
  get gcp() { return require('./providers/gcpPricing'); },
  get aws() { return require('../aws/awsPricing'); },
};

/**
 * How many availability zones this platform builds NAT in, for one region.
 *
 * Load-bearing on AWS, where the gateway is charged per zone: reading two
 * zones as one halves the recorded cost of every region.
 */
const zoneCountFor = (cloud, region) => {
  if (cloud !== 'aws') return 1;
  const resolved = cloudRegions.resolveOn('aws', region);
  return resolved.ok && Array.isArray(resolved.azs) ? Math.max(1, resolved.azs.length) : 1;
};

/** The provider's own name for a platform region. */
const providerRegionFor = (cloud, region) => {
  const resolved = cloudRegions.resolveOn(cloud, region);
  if (!resolved.ok) return null;
  return cloud === 'aws' ? resolved.awsRegion : resolved.gcpRegion;
};

/**
 * Read one region's standing cost from its cloud.
 *
 * Returns `{ok:false, reason}` rather than throwing — the caller is a job that
 * must carry on to the next region.
 */
const readFromCloud = async (cloud, region, { force = false } = {}) => {
  const source = SOURCES[cloud];
  if (!source || typeof source.fetchRegionFixedCost !== 'function') {
    return { ok: false, reason: `${cloud} cannot be asked what a region costs.` };
  }

  const providerRegion = providerRegionFor(cloud, region);
  if (!providerRegion) {
    return { ok: false, reason: `${cloud} has no region mapped for "${region}".` };
  }

  try {
    return await source.fetchRegionFixedCost({
      region: providerRegion,
      azCount: zoneCountFor(cloud, region),
      force,
    });
  } catch (err) {
    return { ok: false, reason: err.message };
  }
};

/** How many billable machines are running in one cloud and region right now. */
const countLiveMachines = async (cloud, region) => {
  const instanceStore = require('../gcp/deploymentInstanceService');
  try {
    return await prisma.deploymentInstance.count({
      where: {
        provider: cloud,
        phase: { in: instanceStore.LIVE_PHASES },
        deployment: { region },
      },
    });
  } catch {
    // Reporting only — a failed count must not stop a cost being recorded.
    return 0;
  }
};

/**
 * Make sure a row exists for this cloud and region, and refresh its cost.
 *
 * Never touches `assumedMachines`: that is the operator's judgement, and a
 * refresh that reset it would undo their decision every hour.
 */
const refreshOne = async (cloud, region, { force = false } = {}) => {
  const existing = await prisma.cloudRegionCost.findUnique({
    where: { cloud_region: { cloud, region } },
  });

  const live = await countLiveMachines(cloud, region);
  const read = await readFromCloud(cloud, region, { force });

  if (!read.ok) {
    /*
     * Keep what is stored. A region whose price we could not read this hour is
     * stale, not free — and the stored figure is the one thing standing
     * between a provider outage and a region priced at zero.
     */
    const row = await prisma.cloudRegionCost.upsert({
      where: { cloud_region: { cloud, region } },
      create: {
        cloud,
        region,
        fixedCostPerHour: 0,
        perMachineCostPerHour: 0,
        costSource: 'unknown',
        liveMachines: live,
      },
      update: { liveMachines: live },
    });

    return {
      ok: false,
      cloud,
      region,
      reason: read.reason,
      // True only when this is the first read and there is nothing to fall
      // back on — the case an admin has to act on.
      neverRead: !existing || Number(existing.fixedCostPerHour) === 0,
      row,
    };
  }

  const row = await prisma.cloudRegionCost.upsert({
    where: { cloud_region: { cloud, region } },
    create: {
      cloud,
      region,
      fixedCostPerHour: read.fixedCostPerHour,
      perMachineCostPerHour: read.perMachineCostPerHour || 0,
      costSource: read.source || 'live',
      costAsOf: read.fetchedAt || new Date(),
      liveMachines: live,
    },
    update: {
      fixedCostPerHour: read.fixedCostPerHour,
      perMachineCostPerHour: read.perMachineCostPerHour || 0,
      costSource: read.source || 'live',
      costAsOf: read.fetchedAt || new Date(),
      liveMachines: live,
    },
  });

  return { ok: true, cloud, region, row, notes: read.notes || [] };
};

/**
 * Refresh every region on every cloud this platform sells.
 *
 * Only `commonRegions()` — the ones every cloud can serve — because those are
 * the only ones a tier may be sold in.
 */
const refreshAll = async ({ force = false } = {}) => {
  const results = [];
  for (const cloud of CLOUDS) {
    for (const region of cloudRegions.commonRegions()) {
      results.push(await refreshOne(cloud, region, { force }));
    }
  }
  return {
    checked: results.length,
    read: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    // The ones with no figure at all: these price a region at zero if anything
    // starts selling in it.
    unknown: results.filter((r) => !r.ok && r.neverRead).map((r) => `${r.cloud}/${r.region}`),
    results,
  };
};

/**
 * What one machine in this cloud and region carries of the region's own cost.
 *
 * The figure that goes into a `TierPrice` row. Returns `null` when the region
 * has never been costed — and null is deliberately not zero, because the
 * caller must be able to tell "costs nothing" from "we do not know".
 */
const shareFor = async (cloud, region) => {
  const row = await prisma.cloudRegionCost.findUnique({
    where: { cloud_region: { cloud, region } },
  });

  if (!row || (Number(row.fixedCostPerHour) === 0 && Number(row.perMachineCostPerHour) === 0)) {
    return { ok: false, share: null, reason: `No cost is recorded for ${cloud} in ${region}.` };
  }

  return {
    ok: true,
    share: regionCost.shareOf({
      fixedCostPerHour: Number(row.fixedCostPerHour),
      perMachineCostPerHour: Number(row.perMachineCostPerHour),
      assumedMachines: row.assumedMachines,
    }),
    source: row.costSource,
    asOf: row.costAsOf,
  };
};

/**
 * Every region's cost with its recovery, for the admin screen.
 *
 * The ladder comes along because an operator setting `assumedMachines` is
 * choosing a point on a steep curve, and one number hides that.
 */
const overview = async () => {
  const rows = await prisma.cloudRegionCost.findMany({
    orderBy: [{ cloud: 'asc' }, { region: 'asc' }],
  });

  return rows.map((row) => {
    const fixedCostPerHour = Number(row.fixedCostPerHour);
    const perMachineCostPerHour = Number(row.perMachineCostPerHour);

    return {
      cloud: row.cloud,
      region: row.region,
      providerRegion: providerRegionFor(row.cloud, row.region),
      fixedCostPerHour,
      perMachineCostPerHour,
      assumedMachines: row.assumedMachines,
      liveMachines: row.liveMachines,
      costSource: row.costSource,
      costAsOf: row.costAsOf,
      sharePerHour: regionCost.shareOf({
        fixedCostPerHour, perMachineCostPerHour, assumedMachines: row.assumedMachines,
      }),
      recovery: regionCost.recovery({
        fixedCostPerHour,
        assumedMachines: row.assumedMachines,
        liveMachines: row.liveMachines,
      }),
      ladder: regionCost.ladder({ fixedCostPerHour, perMachineCostPerHour }),
      costPerHourNow: regionCost.totalCostPerHour({
        fixedCostPerHour, perMachineCostPerHour, liveMachines: row.liveMachines,
      }),
    };
  });
};

/**
 * Set the operator's judgement for one region.
 *
 * Separate from the refresh on purpose: the refresh owns the measured figures
 * and this owns the chosen one, so neither can overwrite the other.
 */
const setAssumedMachines = async (cloud, region, assumedMachines) => {
  const n = regionCost.spreadOver(assumedMachines);
  return prisma.cloudRegionCost.upsert({
    where: { cloud_region: { cloud, region } },
    create: { cloud, region, assumedMachines: n },
    update: { assumedMachines: n },
  });
};

/**
 * Record a region's standing cost by hand.
 *
 * For the case the parsers refuse: a cloud whose SKU wording this platform
 * does not recognise. A figure an operator typed and can see is better than a
 * region priced at zero.
 */
const recordCost = async (cloud, region, { fixedCostPerHour, perMachineCostPerHour }) => {
  const fixed = Math.max(0, Number(fixedCostPerHour) || 0);
  const perMachine = Math.max(0, Number(perMachineCostPerHour) || 0);

  return prisma.cloudRegionCost.upsert({
    where: { cloud_region: { cloud, region } },
    create: {
      cloud,
      region,
      fixedCostPerHour: fixed,
      perMachineCostPerHour: perMachine,
      costSource: 'recorded',
      costAsOf: new Date(),
    },
    update: {
      fixedCostPerHour: fixed,
      perMachineCostPerHour: perMachine,
      costSource: 'recorded',
      costAsOf: new Date(),
    },
  });
};

/**
 * Do we know what these regions cost, on every cloud that is switched on?
 *
 * ── Why this is asked when a tier is SAVED, not when one is sold ──
 *
 * A region's standing cost has to reach the price of everything sold there.
 * If it is missing, the honest thing is to refuse — but refusing at order time
 * means a tier sits in the catalogue looking perfectly normal until a customer
 * tries to use it, and the person who could fix it is not the person who hits
 * the problem.
 *
 * So the question is asked the moment an operator says "this tier is sold in
 * ap-south", while they are on the screen that can fix it.
 *
 * ── Why a missing cost is not the same as a missing region ──
 *
 * What a region COSTS and whether it is BUILT are different facts with
 * different timing, and conflating them would make one of this platform's
 * requirements impossible:
 *
 *   cost   AWS publishes the NAT price for ap-south-1 whether or not we have
 *          ever built anything there. Knowable today, from the price list.
 *   infra  the VPC and NAT in that region. Built when the first deployment
 *          lands there.
 *
 * So this asks only about cost. A region can be priced, sold, and have its
 * network built later — which is exactly the case where a customer is the
 * first to deploy somewhere.
 *
 * Tries a live read before giving up: on a connected cloud the figure is one
 * API call away, and an operator should not be asked to type in a number the
 * provider publishes.
 */
const ensureCosted = async (regions, { settings = null } = {}) => {
  const loaded = settings || await require('../admin/adminSettingsService').getSettings();
  const clouds = CLOUDS.filter((c) => !!loaded?.[`${c}Settings`]?.enabled);

  // No cloud on means nothing can be built anywhere, so there is nothing to
  // check — a platform writing its catalogue before connecting a cloud is not
  // doing anything wrong.
  if (!clouds.length) return { ok: true, missing: [], checked: 0 };

  const wanted = [...new Set((regions || []).filter(Boolean))];
  const missing = [];
  let checked = 0;

  for (const region of wanted) {
    for (const cloud of clouds) {
      checked += 1;

      const known = await shareFor(cloud, region);
      if (known.ok) continue;

      // Not recorded. Ask the cloud now rather than making a person type in a
      // number it publishes.
      const read = await refreshOne(cloud, region).catch(() => ({ ok: false }));
      if (read.ok) continue;

      const after = await shareFor(cloud, region);
      if (after.ok) continue;

      missing.push({
        cloud,
        region,
        reason: read.reason || `${cloud} could not be asked what ${region} costs.`,
      });
    }
  }

  return { ok: missing.length === 0, missing, checked };
};

module.exports = {
  refreshOne,
  refreshAll,
  ensureCosted,
  shareFor,
  overview,
  setAssumedMachines,
  recordCost,
  // Exported for tests.
  zoneCountFor,
  providerRegionFor,
  countLiveMachines,
};
