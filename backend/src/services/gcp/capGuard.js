/**
 * Cap Guard
 *
 * The answer to one question, asked immediately before any machine is created:
 * **may this deployment have a real VM right now?**
 *
 * ── Why this file carries so much weight ──
 *
 * Everywhere else on this platform, an admin sees a deployment before hardware
 * exists for it. That step is gone: a customer clicks deploy and a machine is
 * built. Nobody is watching, so every limit that used to be "an admin would
 * have noticed" has to become a refusal in code, and it has to live in one
 * place that can be read top to bottom and tested exhaustively.
 *
 * There is also a gap in the existing money guarantees that only shows up on
 * this path. `deploymentService.transition()` asserts funding when a deployment
 * becomes `running` — that was the single door onto hardware, so one check
 * covered everything. With automatic provisioning the machine starts costing
 * money while the deployment is still `provisioning`, and the compute clock
 * starts there. So `transition()`'s check never fires before the spending
 * starts. This guard is where that assert moves to.
 *
 * ── Pure decision, resolved inputs ──
 *
 * `decide()` takes numbers and booleans and returns a verdict. It does no I/O,
 * reads no clock and throws nothing, which is the same split as
 * `evaluateFunding` in fundingService.js and `planCharge` in
 * deploymentBilling.js — every branch below can be asserted directly instead of
 * only being reachable through a live database.
 *
 * `evaluate()` is the thin async shell that gathers those inputs.
 *
 * ── Order is part of the design ──
 *
 * The first failing rule is the one reported, so the order decides what an
 * operator is told to fix. It runs from "this is not even our job" through
 * "the platform is not set up" to "this specific customer cannot have this
 * specific machine" — so the message is never about a customer when the real
 * problem is a switch nobody turned on.
 */

/** Every refusal has a stable code; nothing reads the prose. */
/**
 * The clouds this guard can judge. Read from the router rather than listed
 * again here, so adding a cloud is one edit and not a hunt for every list.
 */
const KNOWN_CLOUDS = require('../cloud/cloudRouter').CLOUDS;

/**
 * The tier's disk, from whichever shape the caller handed over.
 *
 * `tier_storage_type` is a column on the deployment, but the wrapped document
 * `deploymentService` returns groups it under `tier` — so reading the flat
 * name alone found `undefined` on every real call. The cost model then had no
 * disk type, reported the machine as unpriceable, and the guard refused:
 * every Google deployment held with COST_UNKNOWN while the live price sat one
 * field away.
 *
 * Both spellings are read because both shapes genuinely reach here. Nothing
 * is guessed when neither is present — a wrong disk rate is invisible, a
 * refusal is not.
 */
const readStorage = (deployment) => ({
  storageType: deployment?.tier?.storageType || deployment?.tierStorageType || '',
  storageGb: deployment?.tier?.storageGb || deployment?.tierStorageGb || 0,
});

const CODES = {
  NOT_A_CLOUD: 'NOT_A_CLOUD',
  GCP_DISABLED: 'GCP_DISABLED',
  GCP_NOT_CONFIGURED: 'GCP_NOT_CONFIGURED',
  ACCOUNT_ON_MANUAL_REVIEW: 'ACCOUNT_ON_MANUAL_REVIEW',
  ALREADY_HAS_INSTANCE: 'ALREADY_HAS_INSTANCE',
  NOT_FUNDED: 'NOT_FUNDED',
  TEAM_CAP_REACHED: 'TEAM_CAP_REACHED',
  PLATFORM_CAP_REACHED: 'PLATFORM_CAP_REACHED',
  COST_UNKNOWN: 'COST_UNKNOWN',
  /** Costs more than it sells for. The platform pays to run it. */
  MARGIN_TOO_LOW: 'MARGIN_TOO_LOW',
  /**
   * Above cost, but under the margin this platform is set to earn.
   * Separate from MARGIN_TOO_LOW because the two need different answers: one
   * is a mispriced tier, the other is usually a provider rate that moved since
   * the order was quoted.
   */
  BELOW_FLOOR: 'BELOW_FLOOR',
};

const deny = (code, reason, extra = {}) => ({ ok: false, code, reason, ...extra });
const allow = (extra = {}) => ({ ok: true, code: null, reason: null, ...extra });

/**
 * @param {object} input
 * @param {string}  input.cloud            the cloud cloudRouter chose, or "manual"
 * @param {object}  input.gcp              the gcpSettings block
 * @param {boolean} input.accountAutoDeploy  the account's own switch. Default
 *                                            true; an admin turns it off to
 *                                            review that account's requests
 * @param {boolean} input.hasLiveInstance  this deployment already has a machine
 *                                         that is not terminated
 * @param {object}  input.funding          a fundingService.check() result
 * @param {number}  input.teamInstances    the team's current live machines
 * @param {number}  input.platformInstances live machines across every customer
 * @param {number}  input.sellPricePerHour what the customer pays for this one
 * @param {number|null} input.costPerHour  what Google charges us, or null if
 *                                         nobody has recorded it
 * @param {string}  input.machineType      only used to name the thing in a message
 * @returns {{ok: boolean, code: string|null, reason: string|null}}
 */
const decide = (input) => {
  const {
    cloud,
    gcp = {},
    accountAutoDeploy = true,
    hasLiveInstance = false,
    funding = { ok: true },
    teamInstances = 0,
    platformInstances = 0,
    sellPricePerHour = 0,
    costPerHour = null,
    costSource = 'unknown',
    floorPrice = null,
    /**
     * How far under its floor a price may sit before this refuses.
     *
     * The same figure the price matrix uses when deciding whether a cell is
     * sellable. Both halves have to read it, or the catalogue could offer
     * something this then refuses to build — and nothing on either screen
     * would explain why.
     */
    floorTolerancePercent = 0,
    machineType = 'the requested machine',
  } = input || {};

  /*
   * ── Is this even our job? ──
   *
   * Not a failure. The router decided this deployment belongs on the manual
   * queue — because no cloud is switched on, because its model is pinned to a
   * cloud that is off, or because the platform-wide kill switch is down.
   * Saying so plainly is what lets the caller fall through to a human instead
   * of logging an error on every deployment any platform ever creates.
   *
   * `cloud` is whatever `cloudRouter` returned, so this single check covers
   * every reason a deployment is not being built automatically.
   */
  if (!KNOWN_CLOUDS.includes(cloud)) {
    return deny(
      CODES.NOT_A_CLOUD,
      cloud === 'manual' || !cloud
        ? 'This deployment goes to the manual fulfilment queue, not to a cloud.'
        : `"${cloud}" is not a cloud this platform can build on.`
    );
  }

  /*
   * The settings in `gcp` belong to whichever cloud this deployment was routed
   * to — the argument keeps its old name because this guard predates the
   * second cloud. The messages name the right one so an operator reading a
   * refusal is sent to the screen that can fix it.
   */
  const label = cloud === 'aws' ? 'AWS' : 'Google Cloud';
  const where = cloud === 'aws' ? 'Cloud → AWS' : 'Cloud → Google Cloud';

  if (!gcp.enabled) {
    return deny(CODES.GCP_DISABLED, `${label} provisioning is switched off in Admin → ${where}.`);
  }

  /*
   * Credentials. Skipped in dry run on purpose — exercising the whole chain
   * before an account exists is the entire reason dry run is the default.
   */
  const dryRun = gcp.dryRun !== false;
  if (!dryRun) {
    if (cloud === 'aws') {
      /*
       * AWS needs an account and a key; the per-region network is checked at
       * build time by `awsSettingsShape`, where the region is known and the
       * message can name it.
       */
      if (!gcp.accountId) {
        return deny(CODES.GCP_NOT_CONFIGURED, `No AWS account is configured. Add it in Admin → ${where}.`);
      }
      if (!gcp.secretAccessKeyEncrypted) {
        return deny(CODES.GCP_NOT_CONFIGURED, `No AWS credential is stored. Add it in Admin → ${where}.`);
      }
      if (!gcp.instanceProfile) {
        return deny(
          CODES.GCP_NOT_CONFIGURED,
          'No customer instance profile is configured. Without it a machine would be built outside '
          + 'the rules that keep customers apart.'
        );
      }
    } else {
      if (!gcp.projectId) {
        return deny(CODES.GCP_NOT_CONFIGURED, 'No Google Cloud project is configured.');
      }
      if (!gcp.serviceAccountKeyEncrypted) {
        return deny(CODES.GCP_NOT_CONFIGURED, 'No Google Cloud service-account key is stored.');
      }
      if (!gcp.customerServiceAccount) {
        return deny(
          CODES.GCP_NOT_CONFIGURED,
          'No customer VM service account is configured. Without it a machine would be built outside the '
          + 'firewall rules that keep customers apart.'
        );
      }
    }
  }

  /*
   * ── The account's own switch ──
   *
   * Default on. An admin turns it off for one account when they want to look
   * at that account's requests before any hardware exists.
   *
   * "Off" is not a refusal, it is a deferral: the caller leaves the deployment
   * in `pending_review` and an admin approving it runs this same path again.
   * That is why the message says reviewed rather than blocked — an operator
   * reading a log should not go hunting for a problem that is not there.
   *
   * Applies in dry run too. It is tempting to exempt dry run, since nothing is
   * created — but a dry-run instance does report RUNNING (that is what
   * `dryRunRunningAfterSeconds` is for, exercising the money path without GCP),
   * and a clock that starts bills a real customer for a machine that does not
   * exist. Charging for nothing is worse than charging for something unusable.
   */
  if (accountAutoDeploy === false) {
    return deny(
      CODES.ACCOUNT_ON_MANUAL_REVIEW,
      'This account is set to manual review, so its deployments wait for an admin to approve them.'
    );
  }

  /*
   * Idempotency's last line. The instance name is derived from the deployment
   * id so GCP itself refuses a duplicate, and the instance table has a unique
   * index on `deployment_id` — this check is the cheap one that keeps a retry
   * from making a pointless API call at all.
   */
  if (hasLiveInstance) {
    return deny(CODES.ALREADY_HAS_INSTANCE, 'This deployment already has a machine.');
  }

  /*
   * ── Money, before metal ──
   *
   * The check `transition()` performs on the way to `running` cannot help here:
   * the clock starts in `provisioning`. This is where it happens instead.
   */
  if (!funding.ok) {
    return deny(
      CODES.NOT_FUNDED,
      funding.reason || 'This account cannot currently fund a new deployment.',
      { fundingCode: funding.code || null, shortfall: funding.shortfall || 0 }
    );
  }

  // ── Ceilings ─────────────────────────────────────────────────────────
  //
  // `0` means zero machines, not "no limit". A cap read as unlimited because
  // somebody typed 0 is the exact failure these exist to prevent, so the
  // comparison is against the number as given.
  const teamCap = Number(gcp.maxConcurrentInstancesPerTeam);
  if (Number.isFinite(teamCap) && teamInstances >= teamCap) {
    return deny(
      CODES.TEAM_CAP_REACHED,
      `This account already has ${teamInstances} machine${teamInstances === 1 ? '' : 's'} running, `
      + `and its limit is ${teamCap}.`
    );
  }

  const platformCap = Number(gcp.maxConcurrentInstancesPlatform);
  if (Number.isFinite(platformCap) && platformInstances >= platformCap) {
    return deny(
      CODES.PLATFORM_CAP_REACHED,
      `The platform is at its limit of ${platformCap} machines (${platformInstances} running).`
    );
  }

  /*
   * ── The margin guard ──
   *
   * Without a review step, a tier priced below what Google charges does not
   * lose money once — it loses money on every deployment, forever, and the
   * loss grows with the product's success. That is the one failure a human
   * would have caught by eye, so it has to be caught here.
   *
   * An unknown cost is a refusal, not an assumption. The alternative —
   * building it and hoping — is how a mispriced tier reaches production, and
   * the fix is a single number in the admin screen. Turning the guard off is
   * also available and is an explicit, logged choice.
   */
  if (gcp.enforceMarginGuard !== false) {
    /*
     * `Number('') === 0`, so a blank entry in the cost table would otherwise
     * pass this check as "costs nothing" and make every machine look
     * profitable. Blank is unknown, and unknown is a refusal — the one case
     * where a falsy-but-valid 0 and an absent value must not be conflated.
     */
    const blank = costPerHour === null || costPerHour === undefined
      || (typeof costPerHour === 'string' && costPerHour.trim() === '');
    if (blank || !Number.isFinite(Number(costPerHour))) {
      return deny(
        CODES.COST_UNKNOWN,
        `No hourly cost could be worked out for "${machineType}". Either connect the provider so `
        + 'prices are read automatically, record the cost for this machine type under Admin → '
        + 'Integrations → Google Cloud, or turn the margin guard off to build it anyway.'
      );
    }
    const cost = Number(costPerHour);
    const sell = Number(sellPricePerHour) || 0;

    /*
     * ── Losing money ──
     *
     * Checked first and said in its own words. "Below the floor" and "below
     * cost" are both refusals, but only one of them is the platform paying a
     * cloud for a machine a customer is paying us less for — and an operator
     * reading the alert has to be able to tell which they are looking at.
     */
    if (cost >= sell) {
      return deny(
        CODES.MARGIN_TOO_LOW,
        `"${machineType}" costs us ${cost}/hr and this deployment sells for ${sell}/hr, so every hour `
        + 'it runs loses money. Re-price the tier or record a lower cost before building it.',
        { costPerHour: cost, sellPricePerHour: sell, floorPrice, belowCost: true }
      );
    }

    /*
     * ── Above cost, but under the margin this platform needs ──
     *
     * The guard used to stop here, at break-even: a machine costing $1.0000
     * and sold at $1.0001 was built, earning a hundredth of a cent. The target
     * margin was computed, reported, and never enforced.
     *
     * ── Why this is normally a no-op, and why it still has to exist ──
     *
     * Prices come from the matrix, where each cell is its own floor, so a
     * sellable cell is already at or above it. This only fires in the gap
     * between a provider raising a rate and the hourly refresh noticing — a
     * window of up to an hour, in which a machine would otherwise be built at
     * yesterday's price.
     *
     * The tolerance is the SAME one the matrix uses. Without that, a cell the
     * catalogue calls sellable could be refused here, and the two halves of
     * the platform would be disagreeing about the same number — which reads,
     * from the outside, as the order simply not working.
     */
    const floor = Number(floorPrice);
    if (Number.isFinite(floor) && floor > 0) {
      const tolerance = Number(floorTolerancePercent);
      const slack = Number.isFinite(tolerance) && tolerance > 0 ? floor * (tolerance / 100) : 0;

      if (sell < floor - slack) {
        return deny(
          CODES.BELOW_FLOOR,
          `"${machineType}" costs us ${cost}/hr and needs to sell for at least ${floor.toFixed(4)}/hr `
          + `to earn the margin this platform is set to, but this deployment sells for ${sell}/hr. `
          + 'It would make money, just less than intended — most likely the cloud raised its price '
          + 'since this order was quoted. Re-price the tier, or lower the target margin.',
          { costPerHour: cost, sellPricePerHour: sell, floorPrice: floor, belowCost: false }
        );
      }
    }

    return allow({
      costPerHour: cost,
      costSource,
      floorPrice,
      sellPricePerHour: Number(sellPricePerHour) || 0,
      dryRun,
    });
  }

  return allow({ costPerHour: costPerHour === null ? null : Number(costPerHour), dryRun });
};

/**
 * How many live machines does a set of deployments have?
 *
 * "Live" is anything not yet known to be gone: a machine being created counts,
 * because it is about to cost money, and `failed` does not, because nothing is
 * running. Counting only `running` would let a retry storm sit in `creating`
 * and sail straight past both caps.
 */
const LIVE_PHASES = ['planned', 'creating', 'running', 'stopping', 'stopped'];

/**
 * Gather what `decide` needs and apply it.
 *
 * Every read here is one the caller would otherwise have to do itself, and all
 * of them are allowed to be slow — this runs once per deployment, not per
 * request.
 *
 * @param {object} deployment  a wrapped deployment
 * @param {object} [options]
 * @param {object} [options.settings]   admin settings, re-read if omitted
 * @param {string} [options.cloud] the cloud the router chose. Read off the
 *   deployment's own frozen field when omitted.
 * @param {object} [options.plan]       the spec mapper's plan, for the machine type
 * @param {boolean} [options.overrideAccountSwitch] skip the account's own
 *   `autoDeploy` switch. Passed only when an admin has just approved this
 *   deployment by hand: that switch exists to make a human look, and a human
 *   has looked. Nothing else about the guard is skipped — the funding assert,
 *   both caps and the margin guard all still apply, because an admin clicking
 *   approve is not a decision to lose money.
 */
const evaluate = async (deployment, options = {}) => {
  const adminSettingsService = require('../admin/adminSettingsService');
  const fundingService = require('../billing/fundingService');
  const prisma = require('../../lib/prismaClient');

  const settings = options.settings || (await adminSettingsService.getSettings());

  /*
   * The cloud this deployment is going to.
   *
   * Taken from the caller when it has already routed (the normal path, so the
   * decision is made once), and otherwise read off the deployment's own frozen
   * field. Never re-derived from the model's current assignment — that is how
   * a terminate ends up at the wrong provider.
   */
  const cloud = options.cloud || require('../cloud/cloudRouter').cloudOf(deployment);

  /*
   * That cloud's own settings block. Read by name rather than hardcoded, so
   * the caps, the kill switch and the margin guard are the ones belonging to
   * the cloud this machine is actually going on — not Google's, applied to an
   * AWS instance.
   */
  const gcp = settings?.[`${cloud}Settings`] || {};

  // Cheap refusals before any database work. A platform with its cloud
  // switched off must not pay for three queries on every deployment anyone
  // creates.
  const early = decide({ cloud, gcp });
  if (!early.ok && [CODES.NOT_A_CLOUD, CODES.GCP_DISABLED, CODES.GCP_NOT_CONFIGURED]
    .includes(early.code)) {
    return early;
  }

  const machineType = options.plan?.machineType || '';

  /*
   * ── What this machine costs ──
   *
   * Asked of the pricing engine rather than read out of a settings table, so
   * the guard judges against the provider's live prices where they are
   * available and against a figure an operator typed where they are not.
   *
   * The engine also adds what no price list contains — the platform's share of
   * NAT, egress and its own infrastructure, plus tax — because the question
   * here is not "what does Google charge" but "does this machine make money".
   * Those are different numbers, and the difference is the whole business.
   *
   * Never allowed to break provisioning: a pricing failure comes back as an
   * unknown cost, and an unknown cost is a refusal, which is the safe way to
   * be wrong.
   */
  const cloudPricing = require('../cloud/cloudPricing');
  const pricing = await cloudPricing.costFor({
    provider: cloud,
    /*
     * The region, handed over by the caller rather than derived from the zone
     * here. The two clouds spell it differently — GCP's "europe-west4-a" has a
     * hyphen before the zone letter and AWS's "eu-west-1a" does not — so one
     * regex cannot strip both, and the one that was here silently failed to
     * strip AWS availability zones at all.
     */
    region: options.region,
    machineType,
    components: {
      vcpu: options.plan?.vcpu,
      ramGb: options.plan?.ramGb,
      gpuModel: options.plan?.acceleratorLabel || options.plan?.accelerator,
      gpuCount: options.plan?.acceleratorCount,
      storageGb: options.plan?.bootDisk?.sizeGb || readStorage(deployment).storageGb,
      /*
       * `tier.storageType`, not `tierStorageType`.
       *
       * The column is `tier_storage_type`, but the wrapped document this is
       * handed groups the tier's snapshot under `tier` — so the flat name is
       * `undefined` here even though the row has "SSD" in it. The cost model
       * then found no disk rate, reported the whole machine as unpriceable,
       * and the guard refused: every Google deployment was held with
       * `COST_UNKNOWN` while the live price sat one field away.
       *
       * Both spellings are read because the raw row is also passed in some
       * paths, and either one alone is a silent refusal.
       */
      storageType: readStorage(deployment).storageType,
    },
    settings,
  }).catch((err) => {
    console.error('[CapGuard] Could not price the machine:', err.message);
    return { ok: false, source: 'unknown', cost: null, reason: err.message };
  });

  const [account, own, teamInstances, platformInstances, funding] = await Promise.all([
    /*
     * The account's own switch. A row that cannot be read is treated as
     * `false` below rather than as the default `true`: not knowing whether an
     * account is on manual review is not a reason to spend money on it.
     */
    prisma.team.findUnique({
      where: { id: deployment.teamId },
      select: { autoDeploy: true },
    }).catch(() => null),
    prisma.deploymentInstance.findUnique({
      where: { deploymentId: deployment.id },
      select: { phase: true },
    }),
    prisma.deploymentInstance.count({
      where: { phase: { in: LIVE_PHASES }, deployment: { teamId: deployment.teamId } },
    }),
    prisma.deploymentInstance.count({ where: { phase: { in: LIVE_PHASES } } }),
    /*
     * The rate passed is this deployment's own, and its own id is excluded from
     * the burn sum — otherwise a deployment that has already been counted into
     * the team's burn rate is tested against a requirement that includes
     * itself twice. Same reasoning as the `running` check in transition().
     *
     * `actorUserId` is deliberately omitted: a member's monthly spend limit was
     * already applied when they created the deployment, and re-applying it here
     * would refuse the machine for an order the platform has already accepted.
     */
    fundingService.check(deployment.teamId, {
      rate: deployment.effectiveRate ? deployment.effectiveRate() : (deployment.pricePerHour || 0),
      excludeDeploymentId: deployment.id,
      billingMethod: deployment.billingMethod || 'prepaid',
    }).catch((err) => ({
      // A funding read that fails must not be read as "funded".
      ok: false,
      code: 'FUNDING_CHECK_FAILED',
      reason: `Could not confirm this account can fund the machine (${err.message}).`,
      shortfall: 0,
    })),
  ]);

  return decide({
    cloud,
    gcp,
    accountAutoDeploy: options.overrideAccountSwitch
      ? true
      : (account ? account.autoDeploy !== false : false),
    hasLiveInstance: !!own && LIVE_PHASES.includes(own.phase),
    funding,
    teamInstances,
    platformInstances,
    sellPricePerHour: deployment.effectiveRate ? deployment.effectiveRate() : (deployment.pricePerHour || 0),
    // The platform's true cost, not the provider's sticker price.
    costPerHour: pricing.ok ? pricing.cost.totalCost : null,
    costSource: pricing.source,
    floorPrice: pricing.ok ? pricing.floorPrice : null,
    // Read from the same setting the price matrix uses, so the catalogue and
    // this guard cannot disagree about whether a price clears its floor.
    floorTolerancePercent: Number(settings?.cloudPricingSettings?.floorTolerancePercent) || 0,
    machineType: machineType || 'the requested machine',
  });
};

module.exports = {
  // Exported for tests: which shape the tier snapshot arrives in.
  readStorage,
  CODES,
  LIVE_PHASES,
  decide,
  evaluate,
};
