/**
 * Payment Method Service
 *
 * Owns the whole life of a saved card: starting verification, recording a
 * verified card, listing/switching/removing them, and charging one off-session
 * later for pay-as-you-go and debt collection.
 *
 * Ported to Prisma as part of the billing domain (see the migration plan).
 * `wrapPaymentMethod` attaches `_id` = `id` onto every record, so
 * `jobs/debtCollection.js`'s card-expiry scan calls `pm.isExpired()` and
 * mirror) keeps calling `pm.isExpired()`/`pm.daysUntilExpiry()` on real
 * `pm.daysUntilExpiry()` on the records this file returns, which is why those
 * two are attached as methods rather than exported as free functions.
 *
 * ── Why a SetupIntent, not a Checkout Session ──
 *
 * A Checkout Session is for taking a payment right now. What this needs is
 * different: prove a card is real and gets the customer's consent to be
 * charged later, with no money moving yet — Stripe's SetupIntent with
 * `usage: 'off_session'`.
 *
 * ── Whose card ──
 *
 * A card belongs to an ACCOUNT (a Team — personal or shared) and pays for that
 * account only; the row also records which member added it (`userId`). Every
 * function takes the team (or its id). The gateway customer the card is saved
 * under is the team's (`team.stripeCustomerId` / `team.polarCustomerId`).
 *
 * ── "Verified" has one meaning ──
 *
 * A card is verified when, and only when, its SetupIntent status is
 * `succeeded`. Nothing is written here before that — there is no "pending"
 * row to half-trust by accident.
 */
const prisma = require('../../lib/prismaClient');
const stripeService = require('../stripe/stripeService');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');

// ── Response shape builders ─────────

const toPaymentMethodDoc = (row, teamId) => ({
  teamId: teamId || row.teamId,
  addedByUserId: row.userId,
  gateway: row.gateway,
  providerCustomerId: row.providerCustomerId,
  providerPaymentMethodId: row.providerPaymentMethodId,
  fingerprint: row.fingerprint,
  brand: row.brand,
  last4: row.last4,
  expMonth: row.expMonth,
  expYear: row.expYear,
  isDefault: row.isDefault,
  status: row.status,
  verifiedAt: row.verifiedAt,
  lastLiveCheckAt: row.lastLiveCheckAt,
  lastUsedAt: row.lastUsedAt,
  lastFailure: {
    code: row.lastFailureCode,
    message: row.lastFailureMessage,
    at: row.lastFailureAt,
  },
  lastExpiryWarningDays: row.lastExpiryWarningDays,
  removedAt: row.removedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
/** Has this card's expiry already passed (or does it pass this month)? */
const isExpired = (pm, asOf = new Date()) => {
  if (!pm.expMonth || !pm.expYear) return false;
  const expiry = new Date(pm.expYear, pm.expMonth, 1);
  return asOf >= expiry;
};

/** Days until this card's stated expiry — negative once it has passed. */
const daysUntilExpiry = (pm, asOf = new Date()) => {
  if (!pm.expMonth || !pm.expYear) return null;
  const expiry = new Date(pm.expYear, pm.expMonth, 1);
  return Math.round((expiry.getTime() - asOf.getTime()) / (24 * 60 * 60 * 1000));
};

/**
 * `jobs/debtCollection.js`'s card-expiry scan calls `pm.isExpired(now)`/
 * `pm.daysUntilExpiry(now)` as methods on the doc — the same
 * instance-method-on-a-plain-object trick as `wrapDeployment`/`wrapUser`, so
 * that job's own logic didn't need to change when this domain moved to
 * Postgres.
 */
const wrapPaymentMethod = (row, teamId) => {
  if (!row) return null;
  const wrapped = { id: row.id, ...toPaymentMethodDoc(row, teamId) };
  wrapped.isExpired = (asOf) => isExpired(wrapped, asOf);
  wrapped.daysUntilExpiry = (asOf) => daysUntilExpiry(wrapped, asOf);
  return wrapped;
};

/** The team's database id, or a clause that matches nothing for a bad id. */
const teamKey = (teamId) => byPublicId(teamId).id;

/**
 * Start verifying a new card. Returns the client secret the frontend's Stripe
 * Elements form needs to confirm the SetupIntent — no card data passes through
 * our server at any point.
 */
const createSetupIntent = async (team, actor) => {
  await stripeService.initialize();
  const customer = await stripeService.getOrCreateCustomer(team);

  const setupIntent = await stripeService.stripe.setupIntents.create({
    customer: customer.id,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata: { teamId: String(team.id), userId: String(actor.id) },
  });

  return { clientSecret: setupIntent.client_secret, customerId: customer.id };
};

/** Shape a Stripe PaymentMethod object into what we store and display. */
const cardFields = (stripePaymentMethod) => {
  const card = stripePaymentMethod.card || {};
  return {
    fingerprint: card.fingerprint || '',
    brand: card.brand || '',
    last4: card.last4 || '',
    expMonth: card.exp_month || null,
    expYear: card.exp_year || null,
  };
};

/**
 * ── One card cannot carry a debt from one account into another ──
 *
 * With teams, the same person can open a fresh account at any time. If the
 * card of an account that is over its debt limit, or under a dispute hold,
 * could simply be saved on a new account, the new account would be a clean
 * slate funded by the very card the platform is already waiting on (plan
 * loophole #3). The card's fingerprint (the same physical card, whatever
 * account saved it) is checked against every other account holding it.
 *
 * Polar reports no fingerprint, so Polar cards cannot be matched this way —
 * the owner-level hold in teamLifecycleService still applies to them.
 */
const assertCardNotHeldElsewhere = async (fingerprint, teamId) => {
  if (!fingerprint) return;
  const others = await prisma.paymentMethod.findMany({
    where: { fingerprint, teamId: { not: teamId }, status: { in: ['active', 'expired'] } },
    select: { teamId: true, team: { select: { disputeHold: true } } },
  });
  const debtService = require('./debtService');
  for (const other of others) {
    const held = other.team.disputeHold || (await debtService.status(other.teamId)).blocked;
    if (held) {
      const err = new Error(
        'This card is linked to another account with an unpaid balance or a payment dispute. '
        + 'Settle that account first, or use a different card.'
      );
      err.code = 'CARD_HELD_ELSEWHERE';
      err.status = 402;
      throw err;
    }
  }
};

/**
 * Record a card whose SetupIntent has succeeded. Refuses anything short of
 * `succeeded` — there is no partial-credit state for "the customer started
 * entering a card".
 */
const attachFromSetupIntent = async (team, actor, setupIntentId) => {
  await stripeService.initialize();

  const setupIntent = await stripeService.stripe.setupIntents.retrieve(setupIntentId);

  if (setupIntent.status !== 'succeeded') {
    const err = new Error(`Card verification is not complete (status: ${setupIntent.status}).`);
    err.code = 'SETUP_INCOMPLETE';
    throw err;
  }

  /*
   * The SetupIntent must have been made for THIS account's gateway customer.
   * Without the check, a member of two teams could start verification in one
   * and attach the card to the other by replaying the intent id.
   */
  if (!team.stripeCustomerId || setupIntent.customer !== team.stripeCustomerId) {
    const err = new Error('This card verification belongs to a different account.');
    err.code = 'SETUP_ACCOUNT_MISMATCH';
    throw err;
  }

  const stripePM = await stripeService.stripe.paymentMethods.retrieve(setupIntent.payment_method);
  const fields = cardFields(stripePM);
  await assertCardNotHeldElsewhere(fields.fingerprint, team.id);

  const existingCount = await prisma.paymentMethod.count({ where: { teamId: team.id, status: 'active' } });

  const existing = await prisma.paymentMethod.findUnique({
    where: { providerCustomerId_providerPaymentMethodId: { providerCustomerId: setupIntent.customer, providerPaymentMethodId: stripePM.id } },
  });

  const data = {
    teamId: team.id,
    userId: actor.id,
    gateway: 'stripe',
    providerCustomerId: setupIntent.customer,
    providerPaymentMethodId: stripePM.id,
    ...fields,
    status: 'active',
    verifiedAt: new Date(),
    removedAt: null,
    // The first card a customer ever saves becomes their default by
    // construction — there is otherwise a moment where a verified card
    // exists but nothing is chargeable because nothing is marked default.
    isDefault: existingCount === 0,
  };

  const record = existing
    ? await prisma.paymentMethod.update({ where: { id: existing.id }, data })
    : await prisma.paymentMethod.create({ data: { ...data } });

  return wrapPaymentMethod(record, team.id);
};

/** Shape a Polar payment-method-list item into what we store and display. */
const polarCardFields = (pm) => {
  const meta = pm.method_metadata || {};
  return {
    fingerprint: '', // Polar's payment-method-list response has no card fingerprint field.
    brand: meta.brand || '',
    last4: meta.last4 || '',
    expMonth: meta.exp_month || null,
    expYear: meta.exp_year || null,
  };
};

/**
 * Pull in a card the customer already attached to their Stripe customer
 * through some other flow (a top-up Checkout session, most commonly),
 * without making them re-enter it.
 */
const syncFromStripe = async (team, actor) => {
  if (!team.stripeCustomerId) return [];

  await stripeService.initialize();

  let stripePMs;
  try {
    stripePMs = await stripeService.stripe.paymentMethods.list({
      customer: team.stripeCustomerId,
      type: 'card',
    });
  } catch (err) {
    console.error('[PaymentMethod] syncFromStripe list failed:', err.message);
    return [];
  }

  const existingCount = await prisma.paymentMethod.count({ where: { teamId: team.id, status: 'active' } });
  const synced = [];
  let createdCount = 0;

  for (let i = 0; i < stripePMs.data.length; i += 1) {
    const stripePM = stripePMs.data[i];
    const fields = cardFields(stripePM);
    // A card held against another account is not imported here either.
    if (await assertCardNotHeldElsewhere(fields.fingerprint, team.id).then(() => false, () => true)) continue;

    const existing = await prisma.paymentMethod.findUnique({
      where: { providerCustomerId_providerPaymentMethodId: { providerCustomerId: team.stripeCustomerId, providerPaymentMethodId: stripePM.id } },
    });

    // A card the customer explicitly removed through our UI stays removed
    // even if it (or the detach that should have taken it off Stripe's side
    // too) still shows up here — a sync must never undo a remove().
    if (existing?.status === 'removed') continue;

    const record = existing
      ? await prisma.paymentMethod.update({ where: { id: existing.id }, data: { ...fields, status: 'active', removedAt: null } })
      : await prisma.paymentMethod.create({
        data: {
          teamId: team.id,
          userId: actor.id,
          gateway: 'stripe',
          providerCustomerId: team.stripeCustomerId,
          providerPaymentMethodId: stripePM.id,
          verifiedAt: new Date(),
          isDefault: existingCount === 0 && createdCount === 0,
          ...fields,
          status: 'active',
        },
      });
    if (!existing) createdCount += 1;

    synced.push(wrapPaymentMethod(record, team.id));
  }

  return synced;
};

/**
 * Pull in a card the customer saved through Polar's hosted Customer Portal —
 * Polar's equivalent of syncFromStripe above. There is no dedicated "payment
 * method saved" webhook event, so this list-and-diff on every read is how a
 * portal-saved card becomes visible here at all (see polarService.js's
 * listPaymentMethods for why).
 */
const syncFromPolar = async (team, actor) => {
  if (!team.polarCustomerId) return [];

  const polarService = require('../polar/polarService');

  let polarPMs;
  try {
    polarPMs = await polarService.listPaymentMethods(team.polarCustomerId);
  } catch (err) {
    console.error('[PaymentMethod] syncFromPolar list failed:', err.message);
    return [];
  }

  const existingCount = await prisma.paymentMethod.count({ where: { teamId: team.id, status: 'active' } });
  const synced = [];
  let createdCount = 0;

  for (let i = 0; i < polarPMs.length; i += 1) {
    const polarPM = polarPMs[i];
    const fields = polarCardFields(polarPM);

    const existing = await prisma.paymentMethod.findUnique({
      where: { providerCustomerId_providerPaymentMethodId: { providerCustomerId: team.polarCustomerId, providerPaymentMethodId: polarPM.id } },
    });

    // A card the customer explicitly removed through our UI stays removed —
    // Polar still lists it (our org token can't detach one; see
    // polarService.js's createPortalSession comment), so a sync must not
    // resurrect what remove() marked gone.
    if (existing?.status === 'removed') continue;

    const record = existing
      ? await prisma.paymentMethod.update({ where: { id: existing.id }, data: { ...fields, status: 'active', removedAt: null } })
      : await prisma.paymentMethod.create({
        data: {
          teamId: team.id,
          userId: actor.id,
          gateway: 'polar',
          providerCustomerId: team.polarCustomerId,
          providerPaymentMethodId: polarPM.id,
          verifiedAt: new Date(),
          isDefault: existingCount === 0 && createdCount === 0,
          ...fields,
          status: 'active',
        },
      });
    if (!existing) createdCount += 1;

    synced.push(wrapPaymentMethod(record, team.id));
  }

  return synced;
};

/**
 * Pull in any card the customer already attached on the active gateway's own
 * side through some other flow (a top-up checkout, the Polar Customer
 * Portal) without making them re-enter it here. Runs both gateways'
 * syncs — not just whichever is active right now — sequentially (not in
 * parallel) so an account with cards under both `stripeCustomerId` and
 * `polarCustomerId` (e.g. the admin switched gateways at some point) can't
 * have two cards both computed as "the first card, mark it default" at once;
 * running the second sync after the first has committed means its own
 * existingCount already reflects what the first one just wrote.
 */
const syncFromGateway = async (team, actor) => {
  const stripeSynced = await syncFromStripe(team, actor);
  const polarSynced = await syncFromPolar(team, actor);
  return [...stripeSynced, ...polarSynced];
};

/** Every active card on file, newest verification first. */
const list = async (teamId) => {
  const rows = await prisma.paymentMethod.findMany({
    where: { teamId: teamKey(teamId), status: { not: 'removed' } },
    orderBy: [{ isDefault: 'desc' }, { verifiedAt: 'desc' }],
  });
  return rows.map((row) => wrapPaymentMethod(row, teamId));
};

/** The display-safe shape shared by the customer's own view and the admin's. */
const serialize = (pm) => ({
  id: pm.id,
  brand: pm.brand,
  last4: pm.last4,
  expMonth: pm.expMonth,
  expYear: pm.expYear,
  isDefault: pm.isDefault,
  status: pm.status,
  isExpired: isExpired(pm),
  daysUntilExpiry: daysUntilExpiry(pm),
  verifiedAt: pm.verifiedAt,
  lastUsedAt: pm.lastUsedAt,
});

const getDefault = async (teamId) => {
  const row = await prisma.paymentMethod.findFirst({ where: { teamId: teamKey(teamId), isDefault: true, status: 'active' } });
  return wrapPaymentMethod(row, teamId);
};

/** Whether this account has at least one usable, non-expired card. */
const hasVerifiedCard = async (teamId) => {
  const key = teamKey(teamId);
  const card = await prisma.paymentMethod.findFirst({ where: { teamId: key, isDefault: true, status: 'active' } })
    || await prisma.paymentMethod.findFirst({ where: { teamId: key, status: 'active' } });
  return !!card && !isExpired(card);
};

const setDefault = async (teamId, paymentMethodId) => {
  const key = teamKey(teamId);

  const target = await prisma.paymentMethod.findFirst({
    where: { ...byPublicId(paymentMethodId), teamId: key, status: 'active' },
  });
  if (!target) {
    const err = new Error('Payment method not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const [, updated] = await prisma.$transaction([
    prisma.paymentMethod.updateMany({ where: { teamId: key }, data: { isDefault: false } }),
    prisma.paymentMethod.update({ where: { id: target.id }, data: { isDefault: true } }),
  ]);

  return wrapPaymentMethod(updated, teamId);
};

/**
 * Remove a card — refusing when it is the customer's only one, since that
 * would silently make debt collection uncollectible.
 */
const remove = async (teamId, paymentMethodId) => {
  const key = teamKey(teamId);

  const target = await prisma.paymentMethod.findFirst({
    where: { ...byPublicId(paymentMethodId), teamId: key, status: 'active' },
  });
  if (!target) {
    const err = new Error('Payment method not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const activeCount = await prisma.paymentMethod.count({ where: { teamId: key, status: 'active' } });
  if (activeCount <= 1) {
    const err = new Error(
      'This is your only card on file. Add another card before removing this one.'
    );
    err.code = 'LAST_CARD';
    throw err;
  }

  const wasDefault = target.isDefault;

  /*
   * Removing the card and promoting its replacement are one change. Run
   * separately, a failure on the promotion leaves the customer with active
   * cards but no default — and the code that charges them reads the default,
   * so the next off-session charge finds nothing and the account looks
   * unfunded despite having a usable card on file.
   *
   * The Stripe detach deliberately stays outside: it is a network call that
   * cannot be rolled back, and holding a database transaction open across it
   * would tie a row lock to a third party's latency.
   */
  const removed = await prisma.$transaction(async (tx) => {
    const updated = await tx.paymentMethod.update({
      where: { id: target.id },
      data: { status: 'removed', isDefault: false, removedAt: new Date() },
    });

    if (wasDefault) {
      const next = await tx.paymentMethod.findFirst({
        where: { teamId: key, status: 'active' }, orderBy: { verifiedAt: 'desc' },
      });
      if (next) {
        await tx.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }

    return updated;
  });

  // Best-effort — gateway-side detachment is cleanup, not the security
  // boundary (our own row is already marked removed above either way).
  // Polar has no such call for us to make: detaching a saved payment method
  // requires a customer-session token that only exists inside a live portal
  // session, and our backend only holds the organization access token — see
  // polarService.js's createPortalSession comment. The customer can still
  // remove the card from Polar's own side via "Manage payment methods"; it
  // just won't be a side effect of clicking remove here.
  if (target.gateway === 'stripe') {
    try {
      await stripeService.initialize();
      await stripeService.stripe.paymentMethods.detach(target.providerPaymentMethodId);
    } catch (err) {
      console.error('[PaymentMethod] Stripe detach failed (non-fatal):', err.message);
    }
  }

  return wrapPaymentMethod(removed, teamId);
};

/**
 * ── Prove the card still works, right now ──
 *
 * `verifiedAt` only says the card was successfully tokenized once. Cards get
 * cancelled, frozen, reported lost and emptied long after that, and none of it
 * changes a single field we hold: the brand, the last four digits and the
 * expiry all stay exactly as valid-looking as the day they were saved. So the
 * card gate was really only checking that a card had been typed in at some
 * point, which is not the same thing as being able to collect money — and
 * collecting money later is the entire reason the gate exists. A customer
 * could start a pay-as-you-go deployment, and the platform would only discover
 * the card was dead when debt collection tried it, days and one unpaid bill
 * later.
 *
 * So before anything that commits the platform to future money — a new
 * deployment, a resume, a move onto pay-as-you-go — the card is actually put
 * through a small authorisation and released again.
 *
 * On a gateway that supports manual capture (Stripe) this is a true hold: the
 * authorisation is placed and immediately cancelled, so nothing is ever
 * captured and the customer is never out of pocket — their bank may briefly
 * show a pending line, which is the normal, expected shape of this check.
 *
 * Polar has no manual-capture call to make, so the same assurance costs a real
 * charge. Rather than keep the customer's money, the amount is credited
 * straight back to their wallet, so they end up with exactly what they paid,
 * as credit they can spend on the thing they were about to do anyway.
 *
 * Held to a freshness window rather than run on every check, so a customer
 * creating three deployments in a row is not authorised three times.
 *
 * @returns {Promise<{ok: boolean, checked: boolean, reason?: string, code?: string}>}
 *   `checked: false` means the gateway could not perform the check at all —
 *   never a silent pass, the caller decides what that is worth.
 */
const verifyCardIsLive = async (teamId, options = {}) => {
  const amount = Number(options.amount) > 0 ? Number(options.amount) : 1;
  const currency = (options.currency || 'usd').toLowerCase();
  const maxAgeHours = Number(options.maxAgeHours) >= 0 ? Number(options.maxAgeHours) : 24;

  const card = await getDefault(teamId);
  if (!card) return { ok: false, checked: true, code: 'NO_CARD', reason: 'No card on file.' };

  // Still inside the freshness window — the last authorisation stands.
  if (card.lastLiveCheckAt && maxAgeHours > 0) {
    const ageHours = (Date.now() - new Date(card.lastLiveCheckAt).getTime()) / 3600000;
    if (ageHours < maxAgeHours) return { ok: true, checked: true, cached: true };
  }

  const stamp = () => prisma.paymentMethod.update({
    where: byPublicId(card.id),
    data: { lastLiveCheckAt: new Date(), lastFailureCode: '', lastFailureMessage: '', lastFailureAt: null },
  });

  const recordFailure = (err) => prisma.paymentMethod.update({
    where: byPublicId(card.id),
    data: {
      lastFailureCode: err.code || err.declineCode || 'card_check_failed',
      lastFailureMessage: err.message,
      lastFailureAt: new Date(),
    },
  }).catch(() => {});

  if (card.gateway === 'stripe') {
    await stripeService.initialize();
    let intent = null;
    try {
      intent = await stripeService.stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency,
        customer: card.providerCustomerId,
        payment_method: card.providerPaymentMethodId,
        capture_method: 'manual',
        off_session: true,
        confirm: true,
        description: 'AI Ocean — card verification hold',
        metadata: { teamId: String(teamId), purpose: 'card_gate_auth_hold' },
      });
    } catch (err) {
      await recordFailure(err);
      return {
        ok: false,
        checked: true,
        code: err.code === 'authentication_required' ? 'AUTHENTICATION_REQUIRED' : 'CARD_DECLINED',
        reason: err.message,
      };
    }

    /*
     * Release it whatever happens next. A hold left uncancelled sits on the
     * customer's statement for days and is indistinguishable, to them, from
     * having been charged — so the cancel is best-effort but never skipped,
     * and its failure is never allowed to fail the check that already passed.
     */
    try {
      await stripeService.stripe.paymentIntents.cancel(intent.id);
    } catch (err) {
      console.error(`[PaymentMethod] Could not release the verification hold ${intent.id}: ${err.message}`);
    }

    await stamp();
    return { ok: true, checked: true, holdId: intent.id };
  }

  if (card.gateway === 'polar') {
    let charge;
    try {
      charge = await chargeOffSessionViaPolar(teamId, card, amount, {
        currency,
        description: 'AI Ocean — card verification',
        metadata: { purpose: 'card_gate_auth_hold' },
      });
    } catch (err) {
      /**
       * "This organization is not enabled for off-session charges" is a fact
       * about the platform's own Polar account, not about the customer's card.
       * Read as a decline it would refuse every single customer on the
       * platform — which is exactly what happened the first time this ran
       * against a Polar sandbox org that had not been opted in. Reported as
       * "could not check", so the caller logs it and falls back to the stored
       * verification instead of locking everybody out over a setting only the
       * platform owner can change.
       */
      const orgNotEnabled = err.status === 403
        || /off-session charges are not enabled/i.test(err.message || '');
      if (orgNotEnabled) {
        return {
          ok: false,
          checked: false,
          code: 'GATEWAY_NOT_ENABLED',
          reason: `${card.gateway} has not enabled off-session charging for this account, so cards cannot be verified.`,
        };
      }
      await recordFailure(err);
      return { ok: false, checked: true, code: err.code || 'CARD_DECLINED', reason: err.message };
    }

    /*
     * Give it straight back as credit. If this write fails the customer is
     * genuinely a dollar down, so it is loud rather than swallowed — but the
     * card did demonstrably work, which is what was being asked.
     */
    try {
      await require('./creditService').topUp(teamId, amount, {
        type: 'adjustment',
        source: 'system',
        description: 'Card verification — refunded to your credit balance',
        metadata: { purpose: 'card_gate_auth_hold', paymentIntentId: charge.paymentIntentId },
      });
    } catch (err) {
      console.error(
        `[PaymentMethod] Card verification charged ${currency} ${amount} for account ${teamId} but could not `
        + `credit it back: ${err.message}`
      );
    }

    await stamp();
    return { ok: true, checked: true, holdId: charge.paymentIntentId };
  }

  // A gateway that can neither hold nor charge off-session cannot answer the
  // question. Reported honestly so the caller can decide, never passed off as
  // a successful check.
  return { ok: false, checked: false, code: 'UNSUPPORTED_GATEWAY', reason: `${card.gateway} cannot verify a card off-session.` };
};

/**
 * Charge a saved card without the customer present — pay-as-you-go billing
 * and debt collection both go through here. Branches on which gateway the
 * customer's default card was actually saved under — not the currently
 * active gateway — so a card keeps working for charging even if the admin
 * later switches which gateway is active for new checkouts.
 */
const chargeOffSession = async (teamId, amount, meta = {}) => {
  const card = await getDefault(teamId);
  if (!card) {
    const err = new Error('No verified payment method on file.');
    err.code = 'NO_CARD';
    throw err;
  }

  if (card.gateway === 'polar') {
    return chargeOffSessionViaPolar(teamId, card, amount, meta);
  }

  await stripeService.initialize();

  try {
    const intent = await stripeService.stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: (meta.currency || 'usd').toLowerCase(),
      customer: card.providerCustomerId,
      payment_method: card.providerPaymentMethodId,
      off_session: true,
      confirm: true,
      description: meta.description || 'AI Ocean — pay-as-you-go charge',
      metadata: { teamId: String(teamId), ...(meta.metadata || {}) },
    });

    await prisma.paymentMethod.update({
      where: byPublicId(card.id),
      data: {
        lastUsedAt: new Date(), lastFailureCode: '', lastFailureMessage: '', lastFailureAt: null,
      },
    });

    return { ok: true, paymentIntentId: intent.id, amount, gateway: 'stripe' };
  } catch (err) {
    await prisma.paymentMethod.update({
      where: byPublicId(card.id),
      data: {
        lastFailureCode: err.code || err.decline_code || 'charge_failed',
        lastFailureMessage: err.message,
        lastFailureAt: new Date(),
      },
    });

    const requiresAction = err.code === 'authentication_required';
    const wrapped = new Error(err.message);
    wrapped.code = requiresAction ? 'AUTHENTICATION_REQUIRED' : 'CHARGE_FAILED';
    wrapped.declineCode = err.decline_code || null;
    wrapped.stripeCode = err.code || null;
    throw wrapped;
  }
};

/**
 * Polar branch of chargeOffSession. Kept as its own function rather than
 * inlined so the Stripe path above — live, tested, unchanged — reads exactly
 * as it did before Polar existed.
 */
const chargeOffSessionViaPolar = async (teamId, card, amount, meta) => {
  const polarService = require('../polar/polarService');

  try {
    const { order } = await polarService.chargeOffSession({
      customerId: card.providerCustomerId,
      paymentMethodId: card.providerPaymentMethodId,
      amount,
      currency: meta.currency || 'usd',
      description: meta.description || 'AI Ocean — pay-as-you-go charge',
    });

    if (order.status !== 'paid') {
      // finalize responded without throwing but didn't actually charge —
      // treat it the same as a declined card rather than reporting success.
      await prisma.paymentMethod.update({
        where: byPublicId(card.id),
        data: { lastFailureCode: order.status || 'not_paid', lastFailureMessage: 'Charge did not complete', lastFailureAt: new Date() },
      });
      const err = new Error('The card could not be charged.');
      err.code = 'CHARGE_FAILED';
      throw err;
    }

    await prisma.paymentMethod.update({
      where: byPublicId(card.id),
      data: {
        lastUsedAt: new Date(), lastFailureCode: '', lastFailureMessage: '', lastFailureAt: null,
      },
    });

    return { ok: true, paymentIntentId: order.id, amount, gateway: 'polar' };
  } catch (err) {
    if (err.code === 'CHARGE_FAILED') throw err;

    await prisma.paymentMethod.update({
      where: byPublicId(card.id),
      data: {
        lastFailureCode: err.status ? String(err.status) : 'charge_failed',
        lastFailureMessage: err.message,
        lastFailureAt: new Date(),
      },
    });

    // Polar's 402 covers declined / no-payment-method / 3DS-required all
    // under one status — unlike Stripe's decline_code, there's nothing here
    // to split into a separate AUTHENTICATION_REQUIRED case.
    const wrapped = new Error(err.message);
    wrapped.code = 'CHARGE_FAILED';
    throw wrapped;
  }
};

/** Used by jobs/debtCollection.js's card-expiry scan — see the class comment. */
const markExpired = async (paymentMethodId) => {
  const existing = await prisma.paymentMethod.findUnique({ where: byPublicId(paymentMethodId) });
  if (!existing) return null;

  const updated = await prisma.paymentMethod.update({ where: { id: existing.id }, data: { status: 'expired' } });
  return wrapPaymentMethod(updated, updated.teamId);
};

/** Used by jobs/debtCollection.js's card-expiry scan — see the class comment. */
const markExpiryWarned = async (paymentMethodId, days) => {
  const existing = await prisma.paymentMethod.findUnique({ where: byPublicId(paymentMethodId) });
  if (!existing) return null;

  const updated = await prisma.paymentMethod.update({ where: { id: existing.id }, data: { lastExpiryWarningDays: days } });
  return wrapPaymentMethod(updated, updated.teamId);
};

/** jobs/debtCollection.js's card-expiry scan: every active saved card, platform-wide. */
const listActive = async () => {
  const rows = await prisma.paymentMethod.findMany({ where: { status: 'active' } });
  return rows.map((row) => wrapPaymentMethod(row, row.teamId));
};

/** The "permanently delete customer" cascade — the cards of their personal account. */
const deleteAllForTeams = async (teamIds, db = prisma) => {
  const ids = byPublicIds(teamIds).id.in;
  if (!ids.length) return;

  await db.paymentMethod.deleteMany({ where: { teamId: { in: ids } } });
};

module.exports = {
  createSetupIntent,
  attachFromSetupIntent,
  syncFromGateway,
  list,
  serialize,
  getDefault,
  hasVerifiedCard,
  verifyCardIsLive,
  setDefault,
  remove,
  chargeOffSession,
  markExpired,
  markExpiryWarned,
  listActive,
  deleteAllForTeams,
  /*
   * Exported for the loophole sweep only. Every real caller reaches it through
   * attachFromSetupIntent / syncFromGateway, which need a live gateway — so
   * the one check that decides whether a held card may follow its owner to a
   * fresh account would otherwise be the one thing no test could try.
   */
  assertCardNotHeldElsewhere,
};
