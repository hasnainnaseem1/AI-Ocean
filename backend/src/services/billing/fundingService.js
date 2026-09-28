/**
 * Funding Service
 *
 * The one place that answers "can this deployment actually run right now?" —
 * plan standing, outstanding debt, the card gate, and wallet runway, in that
 * order, as a single decision.
 *
 * Before this existed, that question was answered four different ways in
 * four different places, and three of them didn't answer it at all:
 *
 *   - order time (creating a deployment)   — checked balance/runway
 *   - transition() → running (admin approve, resume, credit-suspended
 *     auto-resume)                          — checked NOTHING
 *   - customer's own "resume" button        — checked only `balance > 0`,
 *                                             a far weaker bar than order time
 *   - a trial expiring                      — flipped a field on the user,
 *                                             never touched their deployments
 *
 * That gap is exactly how a deployment ordered against a healthy wallet kept
 * running for free after an admin approved it five days later against an
 * empty one, how a resume button worked long after the balance had fallen
 * below what order time would ever have allowed, and how a lapsed trial
 * never actually stopped anything. Routing all four through this one
 * function means there is exactly one rule to get right, and every place
 * that asks gets the same, current answer.
 */
const teamService = require('../team/teamService');
const billingModeService = require('./billingModeService');
const creditService = require('./creditService');
const debtService = require('./debtService');
const paymentMethodService = require('./paymentMethodService');
const { daysSince } = require('./collectionSchedule');

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * ── May this customer use pay-as-you-go at all? ──
 *
 * The platform switch (`billingSettings.payg.enabled`) decides it for
 * everyone, and `team.paygAccess` lets an admin override it for one account:
 * 'allowed' opens it even while the platform switch is off, 'blocked' closes
 * it even while the switch is on, 'default' (every account unless an admin
 * says otherwise) follows the switch.
 *
 * This is only the door. Everything else about PAYG — the eligibility bar
 * below, the card gate, the debt limits, a dispute hold — still applies to an
 * 'allowed' customer exactly as it does to anyone else.
 *
 * The one answer every PAYG path asks: checkout, placing an order, switching
 * a deployment onto PAYG, resuming a PAYG deployment, the hourly job's "switch
 * to PAYG?" offer, and enforcePaygAccessNow, which moves a customer who has
 * lost access off PAYG. A path that checked the platform switch directly
 * would silently disagree with an admin's per-customer decision.
 *
 * @returns {{available: boolean, reason: 'CUSTOMER_BLOCKED'|'PLATFORM_DISABLED'|null,
 *            source: 'customer'|'platform'}}
 */
const PAYG_ACCESS_VALUES = ['default', 'allowed', 'blocked'];

const resolvePaygAccess = (team, settings) => {
  const override = team?.paygAccess || 'default';
  if (override === 'allowed') return { available: true, reason: null, source: 'customer' };
  if (override === 'blocked') return { available: false, reason: 'CUSTOMER_BLOCKED', source: 'customer' };
  return settings?.payg?.enabled
    ? { available: true, reason: null, source: 'platform' }
    : { available: false, reason: 'PLATFORM_DISABLED', source: 'platform' };
};

/**
 * The extra bar an admin can set before pay-as-you-go is offered at all, on
 * top of the card gate (schema doc: AdminSettings.billingSettings.payg.eligibility).
 * Both thresholds are "at least"; 0 on either means no requirement. Pure by
 * construction, like every other decision in this file.
 */
const evaluatePaygEligibility = ({
  lifetimeSpend = 0, accountAgeDays = 0, minLifetimeSpend = 0, minAccountAgeDays = 0,
}) => {
  if (lifetimeSpend < minLifetimeSpend) {
    return { eligible: false, reason: 'MIN_SPEND_NOT_MET' };
  }
  if (accountAgeDays < minAccountAgeDays) {
    return { eligible: false, reason: 'MIN_AGE_NOT_MET' };
  }
  return { eligible: true, reason: null };
};

/**
 * ── The decision, with no I/O in it ──
 *
 * Pure by construction, the same way `planCharge`, `decideEndpointAction` and
 * `evaluateDebtStatus` are: every input is a plain value the caller already
 * resolved, so every combination — debt blocked, card missing, balance short
 * — can be asserted directly without a database.
 *
 * Checked in this order deliberately: debt and the card gate are
 * account-wide problems that block regardless of which deployment is
 * asking; the balance/runway check is specific to the rate being tested, so
 * it runs last, against whatever headroom is left once the account-wide
 * questions are settled — and it is skipped entirely for pay-as-you-go,
 * which by design does not need pre-funded runway at all: a shortfall
 * becomes debt instead (see deploymentBilling.planCharge), so demanding
 * hours of balance upfront would defeat the entire point of offering it.
 * Debt and the card gate still apply — those are what keep pay-as-you-go
 * from being a free-for-all.
 *
 * @returns {{ok: boolean, code: string|null, reason: string|null, shortfall: number}}
 */
const evaluateFunding = ({
  debtBlocked,
  debtReason,
  outstanding = 0,
  requireVerifiedCard,
  hasVerifiedCard,
  balance,
  requiredBalance,
  billingMethod = 'prepaid',
  disputeHold = false,
  paygEligible = true,
  paygEligibleReason = null,
  paygAvailable = true,
  spendLimitReached = false,
}) => {
  const ok = { ok: true, code: null, reason: null, shortfall: 0 };

  /*
   * Whether PAYG is open to this customer at all — before everything else,
   * because none of the other answers matter for a door that is shut, and
   * "add a card" or "settle your balance" would send the customer off to fix
   * something that still would not let them in. Only for PAYG: prepaid is
   * never gated on this.
   */
  if (billingMethod === 'payg' && !paygAvailable) {
    return {
      ok: false,
      code: 'PAYG_UNAVAILABLE',
      reason: 'Pay-as-you-go is not available on this account.',
      shortfall: 0,
    };
  }

  // Checked before anything else: a chargeback is a fraud/trust signal, not a
  // funding shortfall.
  if (disputeHold) {
    return {
      ok: false,
      code: 'DISPUTE_HOLD',
      reason: 'A payment dispute on this account is being reviewed.',
      shortfall: 0,
    };
  }

  if (debtBlocked) {
    return {
      ok: false,
      code: debtReason === 'CREDIT_LIMIT_EXCEEDED' ? 'DEBT_LIMIT_EXCEEDED' : 'DEBT_TOO_OLD',
      reason: 'An outstanding balance is blocking further usage until it is settled.',
      shortfall: 0,
    };
  }

  if (requireVerifiedCard && !hasVerifiedCard) {
    return {
      ok: false,
      code: 'CARD_REQUIRED',
      reason: 'A verified payment method is required before this can run.',
      shortfall: 0,
    };
  }

  /*
   * A team's own rule, not the platform's: this Developer has used their
   * monthly limit of the team's money (services/team/spendLimitService). It
   * blocks starting anything new, for both billing methods; the team can raise
   * the limit, or the month turns.
   */
  if (spendLimitReached) {
    return {
      ok: false,
      code: 'SPEND_LIMIT_REACHED',
      reason: "You have reached your monthly spending limit in this team.",
      shortfall: 0,
    };
  }

  // An admin-set bar on top of the card gate — e.g. new accounts or accounts
  // that have never spent anything can't jump straight to running a tab.
  if (billingMethod === 'payg' && !paygEligible) {
    return {
      ok: false,
      code: 'PAYG_NOT_ELIGIBLE',
      reason: paygEligibleReason === 'MIN_SPEND_NOT_MET'
        ? 'This account has not yet reached the lifetime spend required for pay-as-you-go.'
        : 'This account is too new for pay-as-you-go yet.',
      shortfall: 0,
    };
  }

  /**
   * ── Prepaid must be square before it starts again ──
   *
   * A prepaid deployment that ran its owner out of credit is stopped, but its
   * disk stays allocated and keeps billing, and that unpaid storage lands on
   * the outstanding balance. The customer then has two ways back, and this is
   * what separates them: move the deployment to pay-as-you-go (which is
   * allowed to carry a balance, and is gated on the card instead — see the
   * pay-as-you-go branch above), or top the wallet up, in which case the
   * top-up pays the storage bill off first (creditService.topUp calls
   * debtService.settleFromWallet before returning) and only what is left over
   * counts toward running the machine again.
   *
   * Without this, topping up by less than the storage owed would restart the
   * deployment on money that was already spoken for, and the unpaid storage
   * would simply keep growing underneath it. `debtBlocked` above does not
   * cover this: that only trips once the debt passes the platform's limit or
   * its age, which is a ceiling for pay-as-you-go, not a bar for prepaid.
   */
  if (billingMethod !== 'payg' && outstanding > 0) {
    return {
      ok: false,
      code: 'SETTLE_OUTSTANDING',
      reason: 'An outstanding balance has to be paid off before a prepaid deployment can run again.',
      shortfall: round4(outstanding),
    };
  }

  if (billingMethod !== 'payg' && balance < requiredBalance) {
    return {
      ok: false,
      code: 'INSUFFICIENT_CREDIT',
      reason: 'Your balance does not cover the required runway.',
      shortfall: round4(requiredBalance - balance),
    };
  }

  return ok;
};

/**
 * Resolve every input `evaluateFunding` needs and apply it.
 *
 * @param {string} teamId  the account that would pay
 * @param {object} [options]
 * @param {number} [options.rate]               $/hr this deployment would run at
 * @param {string} [options.excludeDeploymentId] leave this deployment's own
 *   current contribution out of the burn-rate sum — see
 *   Deployment.getBurnRate's doc comment for why that matters when checking
 *   whether IT can afford to become the thing being tested
 * @param {object} [options.settings]            re-read if omitted
 * @param {'prepaid'|'payg'} [options.billingMethod] defaults to 'prepaid'
 * @param {string} [options.actorUserId]  the customer member starting this —
 *   their monthly spend limit in this account is checked. Omitted for the
 *   platform's own actions (an admin approving, an auto-resume after payment),
 *   which are not a member spending the team's money.
 * @returns {Promise<{ok, code, reason, shortfall, balance, requiredBalance}>}
 */
const check = async (teamId, options = {}) => {
  const settings = options.settings || (await billingModeService.getBillingSettings());
  const rate = options.rate || 0;
  const billingMethod = options.billingMethod || 'prepaid';

  // `disputeHold` is a fraud-hold flag, so it is read fresh through
  // the account row rather than trusted from whatever the caller passed in.
  // Dispute hold, PAYG access and account age all belong to the account.
  const team = await teamService.findById(teamId);
  const disputeHold = !!team?.disputeHold;

  // deploymentService is required lazily — it requires this file, so a
  // top-level require on both sides would hand one of them a still-empty
  // `module.exports` (same reasoning as creditService.js's getBurnRate).
  const [wallet, currentBurn, debt, cardOnFile] = await Promise.all([
    creditService.getOrCreateWallet(teamId),
    require('../deployment/deploymentService').getBurnRate(teamId, options.excludeDeploymentId || null),
    debtService.status(teamId, { settings }),
    paymentMethodService.hasVerifiedCard(teamId),
  ]);

  const requiredBalance = round4((currentBurn + rate) * (settings.minHoursBalanceToDeploy || 0));

  /**
   * ── Two admin settings that were written but never read here ──
   *
   * `grandfatherUntil` exempts customers who predate the card gate from it.
   * `enforceCardGateNow` has always honoured it when deciding whom to pause,
   * but this function — which decides who may start or resume — did not. So an
   * admin who turned the gate on with a grandfather date got exactly half of
   * what they asked for: the old customers were left running, and then could
   * not resume or deploy again, which is the opposite of being grandfathered.
   *
   * `whenGatewayCannotStoreCards` is the answer to "the active gateway cannot
   * save a card at all, so nobody can possibly satisfy the gate". It was read
   * only by the marketing endpoint, to decide what to render. The backend
   * enforced nothing, so with a gateway like LemonSqueezy active the gate
   * refused every customer regardless of which policy the admin had chosen —
   * including `prepaid_only`, the default, which is supposed to keep prepaid
   * deployments working and only withhold pay-as-you-go.
   */
  const gatewayCanStoreCards = require('../payments/gatewayRegistry')
    .canStoreCards(settings.activePaymentGateway);

  const grandfatherUntil = settings.cardGate?.grandfatherUntil
    ? new Date(settings.cardGate.grandfatherUntil)
    : null;
  const grandfathered = !!(grandfatherUntil && team?.createdAt
    && new Date(team.createdAt) < grandfatherUntil);

  let requireVerifiedCard = !!settings.cardGate?.requireVerifiedCard && !grandfathered;

  if (requireVerifiedCard && !gatewayCanStoreCards) {
    if (settings.cardGate?.whenGatewayCannotStoreCards === 'block_all_deployments') {
      return {
        ok: false,
        code: 'CARD_REQUIRED',
        reason: 'Card-backed deployments are unavailable while the current payment provider cannot store cards.',
        shortfall: 0,
        balance: wallet.balance,
        requiredBalance,
      };
    }
    // 'prepaid_only' — pay-as-you-go is the thing that genuinely needs a
    // chargeable card, so only it is withheld. Prepaid is money already taken
    // and needs no card to be safe.
    if (billingMethod === 'payg') {
      return {
        ok: false,
        code: 'CARD_REQUIRED',
        reason: 'Pay-as-you-go is unavailable while the current payment provider cannot store cards.',
        shortfall: 0,
        balance: wallet.balance,
        requiredBalance,
      };
    }
    requireVerifiedCard = false;
  }

  /**
   * ── The card is only actually proven when money is about to be committed ──
   *
   * `hasVerifiedCard` answers "is there a card row that looks usable", which is
   * a database question, not a payments one — a cancelled, frozen or emptied
   * card looks identical to a live one here. When the admin has turned on
   * `cardGate.verifyWithAuthHold`, the card is put through a small
   * authorisation and released (see paymentMethodService.verifyCardIsLive).
   *
   * Only for `liveCardCheck` callers, and deliberately so: this function also
   * renders the checkout screen and the resume button's enabled state, and a
   * page load must never move money or leave a hold on someone's card. The
   * three callers that pass it are the three that commit the platform to
   * collecting later — creating a deployment, taking one live, and moving one
   * onto pay-as-you-go.
   */
  let hasVerifiedCard = cardOnFile;
  let liveCheck = null;
  if (cardOnFile && options.liveCardCheck && requireVerifiedCard
      && settings.cardGate?.verifyWithAuthHold) {
    liveCheck = await paymentMethodService.verifyCardIsLive(teamId, {
      amount: settings.cardGate.authHoldAmount,
      maxAgeHours: settings.cardGate.authHoldMaxAgeHours,
      currency: settings.currency,
    }).catch((err) => ({ ok: false, checked: true, code: 'CARD_CHECK_FAILED', reason: err.message }));

    /*
     * A gateway that cannot perform the check at all is not a failed card, and
     * refusing every customer over it would take the whole platform down on a
     * gateway switch. It is logged, and the stored verification stands.
     */
    if (!liveCheck.checked) {
      console.warn(`[Funding] Card live-check unavailable for account ${teamId}: ${liveCheck.reason}`);
    } else if (!liveCheck.ok) {
      hasVerifiedCard = false;
    }
  }

  const paygEligibility = evaluatePaygEligibility({
    lifetimeSpend: wallet.lifetimeSpend || 0,
    accountAgeDays: daysSince(team?.createdAt, new Date()),
    minLifetimeSpend: settings.payg?.eligibility?.minLifetimeSpend || 0,
    minAccountAgeDays: settings.payg?.eligibility?.minAccountAgeDays || 0,
  });

  const paygAccess = resolvePaygAccess(team, settings);

  let spendLimit = null;
  if (options.actorUserId) {
    const found = await teamService.findMembership(teamId, options.actorUserId);
    spendLimit = found
      ? await require('../team/spendLimitService').limitStatus(teamId, found.membership, options.actorUserId)
      : null;
  }

  const plan = evaluateFunding({
    debtBlocked: debt.blocked,
    debtReason: debt.reason,
    outstanding: debt.outstanding,
    requireVerifiedCard,
    hasVerifiedCard,
    balance: wallet.balance,
    requiredBalance,
    billingMethod,
    disputeHold,
    paygEligible: paygEligibility.eligible,
    paygEligibleReason: paygEligibility.reason,
    // Read from the account row fetched fresh above, never from a caller's copy —
    // an admin blocking a customer must take effect on the very next check.
    paygAvailable: paygAccess.available,
    spendLimitReached: !!spendLimit?.reached,
  });

  return {
    ...plan,
    balance: wallet.balance,
    requiredBalance,
    outstanding: debt.outstanding,
    // Which door is shut when code is PAYG_UNAVAILABLE — the platform's or
    // this customer's — so the message can say the right one.
    paygReason: paygAccess.reason,
    // Distinguishes "no card on file" from "the card we hold was declined just
    // now" — the same CARD_REQUIRED code, two very different things to tell a
    // customer, and only one of them is fixed by adding a card.
    cardDeclined: !!(liveCheck && liveCheck.checked && !liveCheck.ok && cardOnFile),
    cardDeclineReason: liveCheck?.reason || null,
  };
};

/**
 * Raise `check`'s result as an error the way the rest of this codebase
 * expects — `.status`/`.code` that a route's catch block already knows how
 * to turn into the right HTTP response, matching how `creditService.charge`
 * signals `INSUFFICIENT_BALANCE` today.
 */
const assertFunded = async (teamId, options = {}) => {
  const result = await check(teamId, options);
  if (result.ok) return result;

  const err = new Error(result.reason || 'This deployment cannot run right now.');
  err.status = 402;
  err.code = result.code;
  err.shortfall = result.shortfall;
  err.balance = result.balance;
  err.requiredBalance = result.requiredBalance;
  err.paygReason = result.paygReason;
  throw err;
};

/**
 * The moment an admin turns the card gate on, pause every currently RUNNING
 * deployment whose owner has no verified card — "kabhi bhi bina card na
 * chale" means a deployment already running when the gate flips is not
 * grandfathered in just because it started earlier. Ordinarily the gate is
 * only checked at a transition boundary (order, approve, resume); this is
 * the one place it also applies retroactively to what's already live.
 *
 * `grandfatherUntil` is the one deliberate exemption — a deployment created
 * before that date is left alone. Leaving it unset (the default) exempts
 * nothing, matching a platform that wants the rule enforced everywhere,
 * starting now.
 */
const enforceCardGateNow = async ({ settings, actor = null } = {}) => {
  // Required lazily — deploymentService itself requires this file at
  // module-load time, so a top-level require here would be a circular
  // import and deploymentService's exports would still be empty when this
  // file finishes loading.
  const deploymentService = require('../deployment/deploymentService');

  const grandfatherUntil = settings.cardGate?.grandfatherUntil
    ? new Date(settings.cardGate.grandfatherUntil)
    : null;

  // Deployment's real source of truth is Postgres now (see the migration
  // plan) — this must go through deploymentService rather than querying the
  // model directly, whose write would only ever reach the
  // mirror and leave Postgres (and therefore billing) still showing 'running'.
  const running = await deploymentService.listByStatuses(['running']);
  if (!running.length) return { checked: 0, paused: 0 };

  const teamIds = [...new Set(running.map((d) => String(d.teamId)))];
  const hasCard = new Map();
  await Promise.all(teamIds.map(async (tid) => {
    hasCard.set(tid, await paymentMethodService.hasVerifiedCard(tid));
  }));

  let paused = 0;
  for (const deployment of running) {
    if (grandfatherUntil && new Date(deployment.createdAt) < grandfatherUntil) continue;
    if (hasCard.get(String(deployment.teamId))) continue;

    try {
      await deploymentService.transition(deployment, 'paused', {
        actor,
        note: 'Paused — a verified card is now required before any deployment can run.',
        cardGateSuspended: true,
        enforcement: true,
      });
      paused += 1;
    } catch (err) {
      console.error(`[CardGate] Could not pause deployment ${deployment.id}:`, err.message);
    }
  }

  return { checked: running.length, paused };
};

/**
 * ── Take pay-as-you-go away from whoever no longer has it ──
 *
 * The retroactive half of resolvePaygAccess, the same way enforceCardGateNow
 * is for the card gate. Every other check only runs when something is
 * started, resumed or switched, so without this a customer who lost PAYG —
 * the platform switch turned off, or an admin blocking them — kept every
 * PAYG deployment they already had, running and running up debt, which is
 * precisely what taking PAYG away was meant to stop.
 *
 * Each such deployment is moved to prepaid through changeBillingMethod, which
 * bills everything up to now under PAYG first (those hours were run on PAYG
 * and are owed as such), then switches. From there the ordinary prepaid rules
 * take over: the wallet pays as it goes, and when it cannot, the hourly job
 * pauses the machine and its disk keeps billing. Nothing is paused here and
 * nothing is forgiven — the existing debt stays owed.
 *
 * Called when an admin blocks a customer, when the platform switch is turned
 * off, and at the start of every hourly billing run as the safety net that
 * catches anything the first two missed (a race with a customer switching
 * onto PAYG at the same moment, a failure part-way through, a settings change
 * made some other way).
 *
 * @param {object} [options]
 * @param {string} [options.teamId]  limit to one account
 * @param {object} [options.settings]
 * @param {object} [options.actor]   admin who caused it (null = system)
 * @returns {Promise<{checked: number, switched: number}>}
 */
const enforcePaygAccessNow = async ({ teamId = null, settings = null, actor = null } = {}) => {
  const deploymentService = require('../deployment/deploymentService');
  const resolved = settings || (await billingModeService.getBillingSettings());

  const payg = await deploymentService.listPaygActive(teamId);
  if (!payg.length) return { checked: 0, switched: 0 };

  const access = new Map();
  for (const tid of new Set(payg.map((d) => String(d.teamId)))) {
    access.set(tid, resolvePaygAccess(await teamService.findById(tid), resolved));
  }

  let switched = 0;
  for (const deployment of payg) {
    const verdict = access.get(String(deployment.teamId));
    if (verdict.available) continue;

    try {
      await deploymentService.changeBillingMethod(deployment, 'prepaid', {
        actor,
        reason: verdict.reason === 'CUSTOMER_BLOCKED'
          ? 'Pay-as-you-go access removed for this customer'
          : 'Pay-as-you-go turned off on the platform',
      });
      await deploymentService.notifyCustomer(deployment, {
        type: 'deployment_status_changed',
        contentKey: 'deployment.movedToPrepaid',
        // A decision about the account's money — its money handlers hear it.
        money: true,
        title: 'Deployment moved to prepaid',
        message: `Pay-as-you-go is no longer available on your account, so "${deployment.deploymentName}" `
          + 'now runs on your prepaid balance. Usage up to now was billed as pay-as-you-go. '
          + 'Keep credit in your wallet to keep it running.',
        priority: 'high',
      });
      switched += 1;
    } catch (err) {
      console.error(`[PaygAccess] Could not move deployment ${deployment.id} to prepaid:`, err.message);
    }
  }

  return { checked: payg.length, switched };
};

module.exports = {
  check,
  resolvePaygAccess,
  PAYG_ACCESS_VALUES,
  enforcePaygAccessNow,
  assertFunded,
  enforceCardGateNow,
  // Exported purely for testing — see the doc comment above its definition.
  evaluateFunding,
  // Exported so checkout-options can show PAYG eligibility without
  // duplicating this rule or re-deriving it from a whole `check()` call.
  evaluatePaygEligibility,
};
