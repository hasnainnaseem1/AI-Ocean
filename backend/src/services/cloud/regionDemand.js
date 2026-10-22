/**
 * Which regions are wanted, which are built, and who is waiting.
 *
 * ── The gap this closes ──
 *
 * The platform costs and sells a region before it builds one. That is a
 * deliberate choice and the reason the pricing matrix works: a region's
 * standing cost (on AWS, its NAT gateways — charged per zone whether anything
 * uses them or not) is inside every price from the day the region is costed,
 * so the customer who happens to be the first one there pays the same rate as
 * the hundredth and subsidises nobody.
 *
 * What is genuinely absent on that first day is the network. A VPC, its
 * subnets, its security group and its NAT gateway are all regional on AWS, so
 * "we sell this region" and "we have built this region" are different facts
 * and only the second one can start a machine.
 *
 * Before this, the second fact was not recorded anywhere. The first order into
 * an unbuilt region was marked `failed` — a dead end for an order that only
 * needed to wait — and the only record was a notification an admin had to
 * read, with a Terragrunt path in it that the customer could also see.
 *
 * ── What this owns, and what it does not ──
 *
 * It owns the record: a region's build state, when a build was asked for, and
 * how many orders are waiting on it. That record is what makes the admin's
 * work list honest ("ap-south-1 — 3 orders waiting") and what lets a held
 * order start on its own the moment the region appears.
 *
 * It does NOT run `terragrunt apply`, and deliberately holds no credential
 * that could. A credential able to apply this infrastructure owns the VPC, the
 * firewall and the security groups of every region — and the platform's
 * hardest guarantee is that one customer's machine can never reach another's,
 * which rests entirely on the runtime having no power to change a network. A
 * key that could be read out of this process would make that guarantee
 * unprovable. So the record lives here; whatever performs the apply is asked,
 * from outside, to come and do it.
 *
 * ── Why 'built' is only ever concluded from the ids ──
 *
 * `markBuilt` is not something an operator asserts. The truth of "this region
 * works" is that `awsSettings.regions[r]` holds a VPC, a security group, an
 * AMI and at least one subnet — because those are what a launch actually uses.
 * A build state saying `built` while those are empty would route an order at a
 * network that does not exist. So the state is RE-DERIVED from settings
 * (`sync`), never trusted on its own.
 */
const prisma = require('../../lib/prismaClient');
const cloudRegions = require('./cloudRegions');

/**
 * The states a region's network can be in.
 *
 * `unbuilt` and `wanted` differ only in whether anybody is waiting, and that
 * difference is the whole point of the admin's list: one is a plan, the other
 * is revenue sitting still.
 */
const STATES = {
  UNBUILT: 'unbuilt',
  WANTED: 'wanted',
  BUILDING: 'building',
  BUILT: 'built',
  FAILED: 'failed',
};

/** States from which asking for a build is meaningful. */
const BUILDABLE = [STATES.UNBUILT, STATES.WANTED, STATES.FAILED];

/**
 * Both names a region goes by, given either one.
 *
 * ── Why a region has two names at all ──
 *
 * The platform sells `ap-south`; AWS calls the same place `ap-south-1` and
 * Google calls it `asia-south1`. The platform name is what a customer chose
 * and what is frozen onto their deployment, deliberately: it survives the
 * platform moving a region between providers. The provider name is what a
 * launch, a settings block and a price lookup all use.
 *
 * Code that holds one and queries the other finds nothing, with no error —
 * which is why this returns both and every lookup here accepts either.
 */
const spellingsOf = (cloud, region) => {
  const asked = String(region || '').trim();
  if (!asked) return [];

  const out = new Set([asked]);

  // Given a platform name: add the provider's.
  const resolved = cloudRegions.resolveOn(cloud, asked);
  if (resolved?.ok) {
    out.add(cloud === 'aws' ? resolved.awsRegion : resolved.gcpRegion);
    if (resolved.platformRegion) out.add(resolved.platformRegion);
  }

  // Given a provider name: find the platform name that maps to it.
  for (const platform of cloudRegions.commonRegions()) {
    const r = cloudRegions.resolveOn(cloud, platform);
    if (!r?.ok) continue;
    if ((cloud === 'aws' ? r.awsRegion : r.gcpRegion) === asked) out.add(platform);
  }

  return [...out].filter(Boolean);
};

/**
 * The one spelling `cloud_region_costs` is keyed by.
 *
 * ── Why this has to be pinned down ──
 *
 * This table already held the standing cost of each region, written by
 * `regionCostService` under the PLATFORM name (`ap-south`). The build state
 * added here is about the same region, so it has to land on the same row.
 *
 * Writing it under the provider's name instead produced two rows for one
 * place: the cost on one, the build state on the other. Every price read the
 * costed row and found no build state; every build read the other and found
 * no cost. Neither was empty enough to look broken.
 */
const keyFor = (cloud, region) => {
  const asked = String(region || '').trim();

  // Already a platform region.
  if (cloudRegions.commonRegions().includes(asked)) return asked;

  // A provider's own name — translate back.
  for (const platform of cloudRegions.commonRegions()) {
    const r = cloudRegions.resolveOn(cloud, platform);
    if (!r?.ok) continue;
    if ((cloud === 'aws' ? r.awsRegion : r.gcpRegion) === asked) return platform;
  }

  // Unrecognised. Returned as given rather than guessed at, so the caller's
  // own validation is what refuses it.
  return asked;
};

/**
 * Find or create the row for one (cloud, region).
 *
 * Created rather than required because a region can be wanted before anybody
 * has costed it — the order arrives when it arrives. The cost columns keep
 * their defaults and `regionCostService` fills them on its next pass.
 */
const rowFor = async (cloud, region) => {
  const key = keyFor(cloud, region);

  const existing = await prisma.cloudRegionCost.findUnique({
    where: { cloud_region: { cloud, region: key } },
  });
  if (existing) return existing;

  return prisma.cloudRegionCost.create({
    data: { cloud, region: key, buildState: STATES.UNBUILT },
  });
};

/**
 * How many orders are waiting on this region, counted rather than incremented.
 *
 * A counter that is bumped on each hold drifts: the provisioning job runs
 * every minute and would count the same order sixty times an hour, and an
 * order that was cancelled would never be counted back down. Counting the
 * rows that are actually held is the only figure that stays true, and this
 * runs rarely enough (one order into an unbuilt region) for the query to be
 * irrelevant.
 */
const countWaiting = async (cloud, region) => prisma.deployment.count({
  where: {
    holdKind: 'region',
    cloudProvider: cloud,
    /*
     * Either spelling of the region.
     *
     * ── Why both, and why this is the bug that hid ──
     *
     * There are two namespaces. A deployment stores the PLATFORM region the
     * customer chose (`ap-south`); the provider's own name (`ap-south-1`) is
     * derived from it at launch, and it is the provider's name that keys
     * `awsSettings.regions` and this table's AWS rows.
     *
     * Matching one spelling counts zero orders whenever the caller happens to
     * hold the other — and the failure is silent in the worst direction: the
     * admin's work list reads "nobody is waiting" while orders sit still, so
     * nobody builds the region and the orders never start.
     */
    region: { in: [...new Set([region, ...spellingsOf(cloud, region)])] },
    /*
     * The live statuses only. A deployment is never deleted — it ends as a
     * `terminated` tombstone — so excluding the finished statuses is what
     * stops a region looking wanted because of an order somebody abandoned
     * last week.
     */
    status: { in: ['pending_review', 'approved', 'provisioning'] },
  },
});

/**
 * Record that an order needs this region, and that somebody should build it.
 *
 * Idempotent: called once a minute by the provisioning retry for as long as
 * the order waits. The first call moves the state to `wanted` and stamps
 * `buildWantedAt`; later calls only refresh the waiting count, so "how long
 * has this region been wanted" stays the truth rather than becoming "when did
 * a job last look at it".
 *
 * A region already `building` is left alone — an apply is in flight and
 * nothing here should disturb it.
 */
const want = async ({ cloud, region, deploymentId = null, missing = [] } = {}) => {
  if (!cloud || !region) return { ok: false, reason: 'A cloud and a region are both required.' };

  const row = await rowFor(cloud, region);
  const waiting = await countWaiting(cloud, region);

  // An apply in flight, or a region that already works, is not re-asked for.
  if (row.buildState === STATES.BUILDING || row.buildState === STATES.BUILT) {
    const updated = await prisma.cloudRegionCost.update({
      where: { id: row.id },
      data: { waitingDeployments: waiting },
    });
    return { ok: true, state: updated.buildState, waiting, changed: false };
  }

  const updated = await prisma.cloudRegionCost.update({
    where: { id: row.id },
    data: {
      buildState: STATES.WANTED,
      waitingDeployments: waiting,
      // Stamped once, so the age of the demand is real.
      buildWantedAt: row.buildWantedAt || new Date(),
    },
  });

  if (row.buildState !== STATES.WANTED) {
    // The row's own key, not whatever spelling the caller passed — so a log
    // line and the admin screen name the same region.
    console.log(
      `[RegionDemand] ${cloud}/${row.region} is wanted: ${waiting} order(s) waiting`
      + `${missing.length ? `, missing ${missing.join(', ')}` : ''}`
      + `${deploymentId ? ` (first: ${deploymentId})` : ''}`
    );
  }

  return { ok: true, state: updated.buildState, waiting, changed: row.buildState !== STATES.WANTED };
};

/**
 * Mark that an apply has started.
 *
 * Refuses when one is already running: two `terragrunt apply` runs against one
 * region's state is what the state lock exists to stop, and racing them is how
 * a half-built network gets recorded as finished.
 */
const markBuilding = async ({ cloud, region } = {}) => {
  const row = await rowFor(cloud, region);

  if (row.buildState === STATES.BUILDING) {
    return { ok: false, code: 'ALREADY_BUILDING', startedAt: row.buildStartedAt };
  }
  if (row.buildState === STATES.BUILT) {
    return { ok: false, code: 'ALREADY_BUILT' };
  }

  await prisma.cloudRegionCost.update({
    where: { id: row.id },
    data: {
      buildState: STATES.BUILDING,
      buildStartedAt: new Date(),
      buildFinishedAt: null,
      buildError: '',
    },
  });

  return { ok: true, state: STATES.BUILDING };
};

/**
 * Record that an apply failed, with why — for the admin, never the customer.
 *
 * The state goes to `failed` rather than back to `wanted` so the difference
 * between "nobody has tried" and "it was tried and broke" survives. A held
 * order carries on waiting either way; what changes is what an admin is told.
 */
const markFailed = async ({ cloud, region, error = '' } = {}) => {
  const row = await rowFor(cloud, region);

  await prisma.cloudRegionCost.update({
    where: { id: row.id },
    data: {
      buildState: STATES.FAILED,
      buildFinishedAt: new Date(),
      buildError: String(error).slice(0, 2000),
    },
  });

  console.error(`[RegionDemand] ${cloud}/${region} build failed: ${error}`);
  return { ok: true, state: STATES.FAILED };
};

/**
 * Re-derive every region's build state from what is actually in settings.
 *
 * This is the only thing that concludes `built`, and it concludes it from the
 * ids a launch would use — not from an apply having reported success, and not
 * from an operator saying so. An apply can finish while a transcription step
 * is still missing; a settings row can be edited by hand. Either way the
 * question that matters is the same one: would a launch in this region find a
 * VPC, a subnet, a security group and an image? Only settings can answer it.
 *
 * Also walks the other way: a region recorded as `built` whose ids have been
 * cleared goes back to `unbuilt`, so an order is held with a readable wait
 * rather than failing at AWS.
 */
/**
 * Which Google regions a machine could actually be placed in right now.
 *
 * Asked of Google rather than read from settings, because on Google there is
 * nothing to transcribe: one global network, addressed by name, with a
 * regional subnet that either exists or does not. Settings would answer
 * "built everywhere" the moment the network name was typed in — which is
 * exactly the wrong answer on the day a region's first customer arrives.
 *
 * Returns platform region names, so the caller can compare against rows that
 * are keyed that way. A region Google cannot be asked about is left OUT:
 * saying "built" because the question failed would route an order at a
 * network nobody has confirmed.
 */
const builtGcpRegions = async (settings) => {
  if (!settings?.gcpSettings?.enabled) return [];

  const gcpClient = require('../gcp/gcpClient');
  const gcpRegionMap = require('../gcp/gcpRegionMap');

  const built = [];
  for (const platformRegion of cloudRegions.commonRegions()) {
    const resolved = gcpRegionMap.resolveRegion(platformRegion);
    if (!resolved.ok) continue;

    // eslint-disable-next-line no-await-in-loop
    const ready = await gcpClient.regionReady(resolved.gcpRegion).catch(() => ({ ok: false }));
    if (ready.ok) built.push(platformRegion);
  }

  return built;
};

const sync = async ({ settings = null, cloud = 'aws' } = {}) => {
  const adminSettingsService = require('../admin/adminSettingsService');
  const resolved = settings || await adminSettingsService.getSettings();

  /*
   * ── "Is this region built?" is a different question per cloud ──
   *
   * On AWS the answer lives in settings: a region is built when its VPC,
   * subnets, security group and AMI ids have been saved, because those ids
   * are literally what a launch uses.
   *
   * On Google there is nothing to transcribe. The network is global and
   * addressed by name, and the regional SUBNET is what either exists or does
   * not — so the only honest answer comes from asking Google. Settings cannot
   * answer it: they would say "built" for every region the moment the network
   * name was typed in.
   */
  const configured = new Set(cloud === 'gcp'
    ? await builtGcpRegions(resolved)
    : require('../aws/awsSettingsShape')
      .configuredRegions(resolved?.awsSettings || {})
      .map((r) => keyFor('aws', r)));

  const rows = await prisma.cloudRegionCost.findMany({ where: { cloud } });
  const changes = [];

  for (const row of rows) {
    const isBuilt = configured.has(keyFor(cloud, row.region));

    if (isBuilt && row.buildState !== STATES.BUILT) {
      const waiting = await countWaiting(cloud, row.region);
      await prisma.cloudRegionCost.update({
        where: { id: row.id },
        data: {
          buildState: STATES.BUILT,
          buildFinishedAt: row.buildFinishedAt || new Date(),
          buildError: '',
          waitingDeployments: waiting,
        },
      });
      changes.push({ region: row.region, from: row.buildState, to: STATES.BUILT, waiting });
      console.log(
        `[RegionDemand] ${cloud}/${row.region} is built`
        + `${waiting ? ` — ${waiting} waiting order(s) can start` : ''}`
      );
      continue;
    }

    /*
     * Built, then not. The ids were removed or became invalid, so the claim
     * has to be withdrawn — leaving it as `built` would route orders at a
     * network nothing can find.
     */
    if (!isBuilt && row.buildState === STATES.BUILT) {
      await prisma.cloudRegionCost.update({
        where: { id: row.id },
        data: { buildState: STATES.UNBUILT, buildFinishedAt: null },
      });
      changes.push({ region: row.region, from: STATES.BUILT, to: STATES.UNBUILT });
      console.warn(
        `[RegionDemand] ${cloud}/${row.region} was built and no longer is — the network is gone from `
        + 'settings. Orders there will wait instead of failing.'
      );
    }
  }

  /*
   * A region that is configured but has no row at all. Happens when settings
   * were filled in before anything was costed — the row is created so the
   * region appears in the admin's list and gets costed on the next pass.
   */
  for (const region of configured) {
    if (!rows.some((r) => keyFor(cloud, r.region) === region)) {
      await prisma.cloudRegionCost.create({
        data: {
          cloud,
          region,
          buildState: STATES.BUILT,
          buildFinishedAt: new Date(),
        },
      });
      changes.push({ region, from: null, to: STATES.BUILT });
    }
  }

  return { ok: true, changes };
};

/**
 * The admin's work list: every region, what state it is in, who is waiting.
 *
 * Ordered by what costs money to ignore — regions with orders waiting first,
 * then by how long they have been wanted. A region nobody is waiting on is a
 * plan; a region with three orders on it is revenue sitting still, and the
 * list should not make an admin work that out.
 */
const overview = async ({ cloud = 'aws' } = {}) => {
  const rows = await prisma.cloudRegionCost.findMany({ where: { cloud } });
  const byRegion = new Map(rows.map((r) => [r.region, r]));

  // Every region the platform can serve, not only those with a row — a region
  // that has never been costed or built is exactly the one worth showing.
  const serveable = cloudRegions.commonRegions();

  const out = [];
  for (const region of serveable) {
    const resolved = cloudRegions.resolveOn(cloud, region);
    if (!resolved.ok) continue;

    // Rows may be stored under either spelling — see `spellingsOf`.
    const row = byRegion.get(cloud === 'aws' ? resolved.awsRegion : resolved.gcpRegion)
      || byRegion.get(region);

    /*
     * Counted rather than read from the row.
     *
     * The stored figure is written when a hold is placed, and it is the one
     * thing on this screen that an admin acts on — "three orders are waiting
     * on ap-south-1" is what makes them run the apply. A stale count there
     * sends them to the wrong region, or tells them nobody is waiting while
     * orders sit still. The query is one count per region on a page an admin
     * opens by hand.
     */
    const waiting = await countWaiting(cloud, region);
    out.push({
      region: cloud === 'aws' ? resolved.awsRegion : resolved.gcpRegion,
      platformRegion: region,
      buildState: row?.buildState || STATES.UNBUILT,
      waitingDeployments: waiting,
      buildWantedAt: row?.buildWantedAt || null,
      buildStartedAt: row?.buildStartedAt || null,
      buildFinishedAt: row?.buildFinishedAt || null,
      buildError: row?.buildError || '',
      canBuild: BUILDABLE.includes(row?.buildState || STATES.UNBUILT),
      /*
       * Whether this region has a price at all. A region can be built and
       * still unsellable: the standing cost has to be known before a tier can
       * be priced there, and `ensureCosted` refuses tier creation without it.
       */
      costed: !!row && row.costSource !== 'unknown',
    });
  }

  return out.sort((a, b) => {
    if (b.waitingDeployments !== a.waitingDeployments) return b.waitingDeployments - a.waitingDeployments;
    const at = a.buildWantedAt ? new Date(a.buildWantedAt).getTime() : Infinity;
    const bt = b.buildWantedAt ? new Date(b.buildWantedAt).getTime() : Infinity;
    return at - bt;
  });
};

/**
 * Is a build worker actually running?
 *
 * ── Why the admin screen has to know ──
 *
 * The same button means two different things depending on the answer. With a
 * worker running, asking for a region is the whole job — it gets built and
 * published on its own. Without one, the request is only a note, and somebody
 * has to go and run the commands.
 *
 * A screen that cannot tell the difference leaves an admin watching a region
 * that will never be built, while orders wait behind it. So the worker stamps
 * a heartbeat and this reads it.
 *
 * Deliberately NOT a process check: the worker runs as a different OS user,
 * often on a different schedule, and a platform that could inspect it would
 * have the access over it that this whole design is built to avoid.
 */
const HEARTBEAT_STALE_MINUTES = 5;

const workerSeen = async () => {
  const row = await prisma.cloudRegionCost.findFirst({
    where: { cloud: 'aws', workerSeenAt: { not: null } },
    orderBy: { workerSeenAt: 'desc' },
    select: { workerSeenAt: true },
  }).catch(() => null);

  if (!row?.workerSeenAt) return { running: false, lastSeen: null };

  const minutes = (Date.now() - new Date(row.workerSeenAt).getTime()) / 60000;
  return {
    running: minutes <= HEARTBEAT_STALE_MINUTES,
    lastSeen: row.workerSeenAt,
    minutesAgo: Math.round(minutes),
  };
};

/** The worker saying it is alive. Called by the worker, never by the API. */
const heartbeat = async () => {
  const rows = await prisma.cloudRegionCost.findMany({
    where: { cloud: 'aws' }, select: { id: true }, take: 1,
  });
  if (!rows.length) return { ok: false };

  await prisma.cloudRegionCost.update({
    where: { id: rows[0].id },
    data: { workerSeenAt: new Date() },
  });
  return { ok: true };
};

module.exports = {
  STATES,
  BUILDABLE,
  HEARTBEAT_STALE_MINUTES,
  workerSeen,
  heartbeat,
  want,
  markBuilding,
  markFailed,
  sync,
  overview,
  // Exported for tests and for the admin route.
  countWaiting,
  rowFor,
};
