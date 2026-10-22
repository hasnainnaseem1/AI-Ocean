/**
 * Telling a customer why their order is waiting, and what they can do.
 *
 * ── The problem this exists for ──
 *
 * The platform refuses to build a machine that would earn less than it is set
 * to need. That refusal is correct, and the order is deliberately kept rather
 * than failed — the customer did nothing wrong, and the price is ours to fix.
 *
 * But "kept" was all that happened. The customer saw "Pending review" with no
 * reason attached and no end to it, and the only way out was to give up. A
 * correct decision, delivered as silence, reads as a broken product.
 *
 * ── What is said, and why it is said that way ──
 *
 * Three things, in the customer's own terms:
 *
 *   what happened   in plain words, without blaming them or us
 *   how long        a real figure, because "soon" is what nobody believes
 *   what they can do a second machine they can have right now, if there is one
 *
 * The price almost always fixes itself: the hourly refresh re-reads what the
 * clouds charge and re-prices every tier from it, so a hold placed at 10:05
 * clears at 11:00. That is a promise worth making BECAUSE it is kept by a job
 * rather than by somebody remembering.
 *
 * ── What is deliberately not said ──
 *
 * Never the platform's own cost, margin or floor. What a machine costs us is
 * not the customer's business, and a message that explains our pricing invites
 * an argument about it. "We need to re-check the price for this region" is
 * true, complete from where they stand, and reveals nothing.
 */

/** The kinds of wait, each with its own way forward. */
const KINDS = {
  /** A provider raised its rate between the quote and the build. */
  REPRICING: 'repricing',
  /** The cloud has no room in that region right now. */
  CAPACITY: 'capacity',
  /** The account cannot pay for it yet. */
  FUNDS: 'funds',
  /**
   * The platform sells this region but has not built its network there yet.
   *
   * This is the only kind that is nobody's fault and nothing's error: on AWS a
   * VPC, its subnets, its security group and its NAT gateway are all regional,
   * so the first order in a new region has to wait for them to exist. The
   * price already covered this (the region's standing cost is in every cell of
   * the matrix from the day the region was costed), so the customer is not
   * being asked to fund someone else's setup — only to wait for it.
   */
  REGION: 'region',
};

/** How long the hourly re-price takes, worst case. */
const REPRICE_WINDOW_MINUTES = 60;

/**
 * How long building a region's network takes, worst case.
 *
 * A VPC, three subnets, a security group and a NAT gateway per zone. The NAT
 * gateway is the slow one — AWS takes a few minutes to attach it. 30 is
 * generous on purpose: a promise that is kept early reads as competence, one
 * that slips reads as a broken product, and this number is shown to a paying
 * customer who is watching a spinner.
 */
const REGION_BUILD_WINDOW_MINUTES = 30;

/**
 * The guard codes that mean "waiting on a price", mapped to what to tell the
 * customer. Anything not in here is not a hold a customer should be told
 * about in these words.
 */
const FROM_GUARD_CODE = {
  BELOW_FLOOR: KINDS.REPRICING,
  MARGIN_TOO_LOW: KINDS.REPRICING,
  COST_UNKNOWN: KINDS.REPRICING,
  NOT_FUNDED: KINDS.FUNDS,
  TEAM_CAP_REACHED: KINDS.CAPACITY,
  PLATFORM_CAP_REACHED: KINDS.CAPACITY,
  REGION_CAPACITY: KINDS.CAPACITY,
  REGION_NOT_CONFIGURED: KINDS.REGION,
};

/**
 * What to say for one kind of hold.
 *
 * Written to be read by somebody who has just spent money and wants their
 * machine. It says what is happening, when it will be over, and what they can
 * do instead — in that order, because that is the order they care about.
 */
const messageFor = (kind, { region = '', minutesWaiting = 0, automatic = true } = {}) => {
  const where = region ? ` in ${region}` : '';

  if (kind === KINDS.REPRICING) {
    /*
     * Past the window the job needs, the promise stops being made rather than
     * being repeated. A message that keeps saying "within the hour" into the
     * second hour is worse than one that admits somebody is looking.
     */
    const overdue = minutesWaiting > REPRICE_WINDOW_MINUTES;

    return {
      title: 'We are re-checking the price for this machine',
      body: overdue
        ? `The cloud changed its rates${where} after you ordered, and this is taking longer than `
          + 'it usually does. Someone on our side is looking at it now. You can wait, or pick a '
          + 'different machine and we will start it straight away.'
        : `The cloud changed its rates${where} just after you placed this order, so we are `
          + 'confirming the price before we start the machine. This normally clears within the '
          + 'hour and nothing has been charged. You can wait, or pick a different machine and we '
          + 'will start it straight away.',
      canSwitchMachine: true,
      expectedWithinMinutes: overdue ? null : REPRICE_WINDOW_MINUTES,
    };
  }

  if (kind === KINDS.CAPACITY) {
    return {
      title: 'This machine is not available right now',
      body: `There is no room for this machine${where} at the moment. We are waiting for one to `
        + 'free up. Nothing has been charged, and picking a different machine or another region '
        + 'will usually start right away.',
      canSwitchMachine: true,
      expectedWithinMinutes: null,
    };
  }

  if (kind === KINDS.REGION) {
    /*
     * The one message here that must not sound like an error, because it is
     * not one — it is the first order in a new place.
     *
     * What it deliberately does NOT say: that no VPC exists there, which
     * region folder has to be applied, or that a NAT gateway is being
     * attached. That is our infrastructure's shape, and the previous version
     * of this path put a `infra/aws/live/<env>/...` path in front of the
     * customer. Where our networks live is not something a customer should
     * learn from a status message.
     */
    const overdue = minutesWaiting > REGION_BUILD_WINDOW_MINUTES;

    /*
     * ── Only promise a timeframe something is actually keeping ──
     *
     * "about 30 minutes, it will start on its own" is true when the build
     * worker is running, because that worker picks the region up within the
     * minute and applies it. With no worker running, the same sentence is a
     * promise nobody is keeping — the order waits until a person notices a
     * screen, which could be tomorrow.
     *
     * A missed estimate costs more trust than no estimate, so when nothing is
     * watching, the wait is described honestly and the alternative is led
     * with instead.
     */
    if (automatic === false) {
      return {
        title: 'Setting up this region for you',
        body: `You are the first to use${where || ' this region'}, so it has to be set up before `
          + 'your machine can start. We are on it, and nothing is charged until your machine is '
          + 'running. If you would rather not wait, picking a region we already run in will start '
          + 'straight away.',
        canSwitchMachine: true,
        // Deliberately none: see above.
        expectedWithinMinutes: null,
      };
    }

    return {
      title: 'Setting up this region for you',
      body: overdue
        ? `You are the first to use${where || ' this region'}, and setting it up is taking longer `
          + 'than it should. Someone on our side is on it now. Nothing has been charged, and if '
          + 'you would rather not wait, picking a region we already run in will start straight away.'
        : `You are the first to use${where || ' this region'}, so we are getting it ready before `
          + `your machine starts. This usually takes about ${REGION_BUILD_WINDOW_MINUTES} minutes `
          + 'and nothing is charged until your machine is running. You can wait — it will start on '
          + 'its own — or pick a region we already run in and it will start straight away.',
      canSwitchMachine: true,
      expectedWithinMinutes: overdue ? null : REGION_BUILD_WINDOW_MINUTES,
    };
  }

  if (kind === KINDS.FUNDS) {
    return {
      title: 'Waiting on your balance',
      body: 'This order is ready to go as soon as the account can cover it. Add credit or a '
        + 'payment method and it will start on its own — you do not need to order again.',
      canSwitchMachine: false,
      expectedWithinMinutes: null,
    };
  }

  return {
    title: 'This order is waiting',
    body: 'We are looking into it. Nothing has been charged.',
    canSwitchMachine: true,
    expectedWithinMinutes: null,
  };
};

/**
 * Put an order on hold, with something the customer can read.
 *
 * Idempotent in the way that matters: a hold placed again for the same reason
 * keeps the ORIGINAL `heldAt`, so "how long have I been waiting" is the truth
 * and not "since the last time a job looked at it". The provisioning job runs
 * every minute; without this, the clock would reset sixty times an hour and
 * the message would promise "within the hour" forever.
 */
const place = async (deployment, { kind, reason = '' } = {}) => {
  if (!deployment) return { held: false };

  const sameReason = deployment.holdKind === kind && deployment.holdReason === reason;
  if (sameReason && deployment.heldAt) return { held: false, unchanged: true };

  deployment.holdKind = kind || '';
  deployment.holdReason = reason || '';
  // Only moved when the reason itself changes — a new reason is a new wait.
  if (!sameReason || !deployment.heldAt) deployment.heldAt = new Date();

  await deployment.save();
  return { held: true, at: deployment.heldAt };
};

/**
 * Lift a hold, because the thing that caused it is over.
 *
 * Called on the way to building the machine rather than from a separate
 * sweep: the only proof a hold is finished is that the thing it blocked has
 * gone through.
 */
const clear = async (deployment) => {
  if (!deployment || (!deployment.holdKind && !deployment.holdReason)) return { cleared: false };

  deployment.holdKind = '';
  deployment.holdReason = '';
  deployment.heldAt = null;
  await deployment.save();
  return { cleared: true };
};

/**
 * What the customer should see, built from what is stored.
 *
 * Returns null when there is no hold, so a screen can ask without checking
 * three fields first.
 */
const describe = (deployment, { automatic = true } = {}) => {
  if (!deployment?.holdKind && !deployment?.holdReason) return null;

  const heldAt = deployment.heldAt ? new Date(deployment.heldAt) : null;
  const minutesWaiting = heldAt ? Math.max(0, Math.round((Date.now() - heldAt.getTime()) / 60000)) : 0;

  const copy = messageFor(deployment.holdKind, {
    region: deployment.region && deployment.region !== 'default' ? deployment.region : '',
    minutesWaiting,
    /*
     * Whether anything is actually going to act on this wait. Passed in by the
     * caller because only it can know — the build worker is a separate process
     * and this module has no database. Defaults to true so every existing
     * caller reads exactly as it did.
     */
    automatic,
  });

  return {
    kind: deployment.holdKind || '',
    heldAt,
    minutesWaiting,
    ...copy,
    /*
     * The internal reason is deliberately NOT returned. It names what a
     * machine costs us and what margin we need, which is not the customer's
     * business and invites an argument about our pricing rather than about
     * their machine.
     */
  };
};

/** The admin's view: the internal reason, which the customer never sees. */
const internalReason = (deployment) => deployment?.holdReason || '';

module.exports = {
  KINDS,
  REPRICE_WINDOW_MINUTES,
  REGION_BUILD_WINDOW_MINUTES,
  FROM_GUARD_CODE,
  messageFor,
  place,
  clear,
  describe,
  internalReason,
};
