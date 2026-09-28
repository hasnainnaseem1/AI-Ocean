/**
 * Deployment Controller (customer side)
 *
 * Requesting a model deployment, tracking its status, retrieving the endpoint
 * credentials once an admin has provisioned it, and pausing/stopping to control
 * spend.
 *
 * Pricing is always recomputed server-side from the catalog and frozen onto the
 * deployment — a client can't choose its own rate.
 */
const catalogService = require('../../services/catalog/catalogService');
const machineChoice = require('../../services/catalog/machineChoice');
const { failure } = require('../../utils/helpers/apiError');
const { meta } = require('../../utils/helpers/pagination');
const questionTemplateService = require('../../services/admin/questionTemplateService');
const activityLogService = require('../../services/admin/activityLogService');
const billingModeService = require('../../services/billing/billingModeService');
const fundingService = require('../../services/billing/fundingService');
const { canSeeMoney, canTerminate } = require('../../services/team/permissions');
const creditService = require('../../services/billing/creditService');
const debtService = require('../../services/billing/debtService');
const paymentMethodService = require('../../services/billing/paymentMethodService');
const { daysSince } = require('../../services/billing/collectionSchedule');
const { billingCopy } = require('../../services/billing/copyTemplates');
const deploymentService = require('../../services/deployment/deploymentService');
const deploymentUsageService = require('../../services/deployment/deploymentUsageService');
const { hasLiveAccess } = require('../../services/deployment/deploymentConstants');
const journeyService = require('../../services/deployment/journeyService');
const recommendation = require('../../services/recommendation');
const { cryptoHelper } = require('../../utils/helpers');

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * Why pay-as-you-go is closed to this customer. Two different situations: a
 * customer blocked individually is not helped by being told the platform has
 * it switched off, and vice versa.
 */
const paygUnavailableMessage = (reason) => (reason === 'CUSTOMER_BLOCKED'
  ? 'Pay-as-you-go is not available on your account. Please contact support if you need it.'
  : 'Pay-as-you-go is not available on this platform right now.');

/**
 * The same refusal for a member who may not see the account's money
 * (Developer / Viewer — services/team/permissions.js): what is wrong and who
 * can fix it, without a single figure.
 */
const memberFundingMessage = (code) => {
  switch (code) {
    case 'DISPUTE_HOLD':
      return 'A payment dispute on this account is being reviewed. Please contact support.';
    case 'DEBT_LIMIT_EXCEEDED':
    case 'DEBT_TOO_OLD':
    case 'SETTLE_OUTSTANDING':
      return 'This account has an unpaid balance that has to be settled first. Ask an owner or a billing member of the account.';
    case 'CARD_REQUIRED':
      return 'This account needs a verified card first. Ask an owner or a billing member of the account to add one.';
    case 'PAYG_NOT_ELIGIBLE':
      return 'Pay-as-you-go is not available on this account yet.';
    case 'SPEND_LIMIT_REACHED':
      return 'You have reached your monthly spending limit in this team. Ask an owner or admin to raise it.';
    case 'INSUFFICIENT_CREDIT':
    default:
      return "This account's balance cannot cover this right now. Ask an owner or a billing member of the account to add credit.";
  }
};

/**
 * A plain-language reason for whichever way fundingService.check() said no.
 * `money: false` — the caller may not see the account's figures, so the
 * message names the problem and who can fix it, and nothing else.
 */
const fundingErrorMessage = (funding, settings, { money = true } = {}) => {
  if (!money && funding.code !== 'PAYG_UNAVAILABLE') return memberFundingMessage(funding.code);
  switch (funding.code) {
    case 'DISPUTE_HOLD':
      return 'A payment dispute on your account is being reviewed. Please contact support.';
    case 'DEBT_LIMIT_EXCEEDED':
      return 'Your outstanding balance is too high to start or resume a deployment. Please settle it first.';
    case 'DEBT_TOO_OLD':
      return 'Your outstanding balance has gone unpaid for too long. Please settle it before continuing.';
    case 'SETTLE_OUTSTANDING':
      // Says the amount and both ways out of it, because this is the one
      // refusal a customer can clear themselves in under a minute.
      return (
        `Your deployment's storage has run up an outstanding balance of `
        + `${settings.currency} ${(funding.shortfall || 0).toFixed(2)}. Add credit — it pays this off first — `
        + 'or switch this deployment to pay-as-you-go, which can carry a balance.'
      );
    case 'CARD_REQUIRED':
      // Two different problems wear this code. "Add a card" is useless advice
      // to someone who has one and whose bank just declined it.
      return funding.cardDeclined
        ? `Your saved card was declined when we checked it${funding.cardDeclineReason ? ` (${funding.cardDeclineReason})` : ''}. Please add a working card.`
        : billingCopy(settings, 'checkoutCardRequiredMessage', {}, 'Please add a verified payment method before this can run.');
    case 'PAYG_UNAVAILABLE':
      return paygUnavailableMessage(funding.paygReason);
    case 'SPEND_LIMIT_REACHED':
      return 'You have reached your monthly spending limit in this team. Ask an owner or admin to raise it.';
    case 'PAYG_NOT_ELIGIBLE':
      return billingCopy(settings, 'checkoutPaygIneligibleMessage', {
        currency: settings.currency,
        minLifetimeSpend: settings.payg?.eligibility?.minLifetimeSpend || 0,
        minAccountAgeDays: settings.payg?.eligibility?.minAccountAgeDays || 0,
      }, 'Pay-as-you-go is not available on this account yet.');
    case 'INSUFFICIENT_CREDIT':
    default:
      return (
        `You need at least ${settings.currency} ${(funding.requiredBalance || 0).toFixed(2)} in credit to run this ` +
        `for ${settings.minHoursBalanceToDeploy} hours. Your balance is ${settings.currency} ${(funding.balance || 0).toFixed(2)}.`
      );
  }
};

/**
 * What a deployment cost, and anything that reveals the account's money.
 * Stripped for members who may not see it (canSeeMoney) — by the server, so a
 * Developer or Viewer cannot read it from the API either.
 */
const MONEY_FIELDS = [
  'pricePerHour', 'stoppedPricePerHour', 'planDiscountPercent', 'effectiveRate',
  'totalCost', 'hasUnpaidStorage',
];

const serializeFor = (req, deployment, options) => {
  const out = serialize(deployment, options);
  // Lets the UI show "yours" and decide on terminate without a second call.
  out.createdByMe = String(deployment.userId) === String(req.user.id);
  if (canSeeMoney(req.membership)) return out;
  MONEY_FIELDS.forEach((field) => { delete out[field]; });
  return out;
};

/**
 * Shape a deployment for the customer. Never leaks the encrypted API key or
 * the admin's internal notes. Handlers use `serializeFor`, which also applies
 * the caller's role.
 */
const serialize = (deployment, { full = false } = {}) => {
  const base = {
    id: deployment.id,
    deploymentName: deployment.deploymentName,
    model: deployment.model,
    tier: deployment.tier,
    region: deployment.region,
    status: deployment.status,
    pricePerHour: deployment.pricePerHour,
    stoppedPricePerHour: deployment.stoppedPricePerHour,
    planDiscountPercent: deployment.planDiscountPercent,
    effectiveRate: round4(deployment.pricePerHour * (1 - (deployment.planDiscountPercent || 0) / 100)),
    currency: deployment.currency,
    totalCost: deployment.totalCost,
    totalRuntimeHours: deployment.totalRuntimeHours,
    /**
     * `totalRuntimeHours` and `totalCost` only move when the hourly billing job
     * runs, so both are "billed so far", not "used so far". Without the
     * watermark the customer has no way to tell how stale they are — which is
     * how a machine running for fifty minutes could show less runtime than one
     * started half an hour later whose bill happened to be settled on a stop.
     */
    lastBilledAt: deployment.lastBilledAt || null,
    autoSuspendedForCredit: deployment.autoSuspendedForCredit,
    debtLimitSuspended: !!deployment.debtLimitSuspended,
    cardGateSuspended: !!deployment.cardGateSuspended,
    hasUnpaidStorage: !!deployment.hasUnpaidStorage,
    billingMethod: deployment.billingMethod || 'prepaid',
    paygOfferedAt: deployment.paygOfferedAt || null,
    startedAt: deployment.startedAt,
    stoppedAt: deployment.stoppedAt,
    createdAt: deployment.createdAt,
  };

  if (!full) return base;

  return {
    ...base,
    requirements: deployment.requirements,
    statusHistory: deployment.statusHistory,
    rejectionReason: deployment.rejectionReason,
    provisionedAt: deployment.provisionedAt,
    terminatedAt: deployment.terminatedAt,
    endpoint: {
      url: deployment.endpoint?.url || '',
      // Masked only — the real key comes from the explicit reveal endpoint
      apiKeyMasked: deployment.endpoint?.apiKeyMasked || '',
      hasApiKey: !!deployment.endpoint?.apiKeyEncrypted,
      docsUrl: deployment.endpoint?.docsUrl || '',
      extra: deployment.endpoint?.extra || {},

      /**
       * Whether the key actually works right now, and why not if it doesn't.
       * Without this the UI would keep offering "Reveal API key" on a paused
       * deployment and only discover the refusal after the customer clicked.
       */
      active: hasLiveAccess(deployment),
      suspended: deployment.endpoint?.active === false && !deployment.endpoint?.revokedAt,
      revoked: !!deployment.endpoint?.revokedAt,
      suspendedAt: deployment.endpoint?.suspendedAt || null,
      revokedAt: deployment.endpoint?.revokedAt || null,
      keyVersion: deployment.endpoint?.keyVersion || 1,
    },
  };
};

/**
 * GET /api/v1/customer/deployments/questionnaire?modelId=
 * The admin-defined questions that apply to the chosen model.
 */
const getQuestionnaire = async (req, res) => {
  try {
    const { modelId } = req.query;

    let model = null;
    if (modelId) {
      model = await catalogService.findModelByIdentifier(modelId);
      if (!model) {
        return res.status(404).json({ success: false, message: 'Model not found' });
      }
    }

    const questions = await questionTemplateService.getForModel(model);

    // Shared with the journey endpoint so the two can never disagree about
    // what a question looks like — and so neither leaks the sizing signals.
    res.json({
      success: true,
      questions: questions.map(journeyService.serializeQuestion),
    });
  } catch (error) {
    console.error('Get questionnaire error:', error);
    res.status(500).json({ success: false, message: 'Error fetching questionnaire' });
  }
};

/**
 * GET  /api/v1/customer/deployments/checkout-options?modelId=&tierId=&region=
 * POST /api/v1/customer/deployments/checkout-options   { modelId, customBuild }
 *
 * Everything the checkout modal needs to render before the customer commits:
 * pricing, wallet/affordability, and whether prepaid and pay-as-you-go would
 * each actually be allowed right now. Runs the exact same
 * fundingService.evaluateFunding decision that createDeployment checks again
 * at creation time, so the modal can never promise something creation then
 * refuses — and all the customer-facing wording comes from here too, not
 * duplicated in the frontend.
 *
 * Two verbs for one handler: a catalogue machine is identified by a short id
 * that fits a query string, but a custom machine is a list of parts, which
 * does not. Rather than encode a parts list into a URL, the same handler also
 * answers POST and reads the choice from whichever side carried it.
 */
const getCheckoutOptions = async (req, res) => {
  try {
    const source = { ...req.query, ...req.body };
    const { modelId, tierId, customBuild } = source;
    if (!modelId) {
      return res.status(400).json({ success: false, message: 'modelId is required' });
    }

    const [model, settings] = await Promise.all([
      catalogService.findModelByIdentifier(modelId),
      billingModeService.getBillingSettings(),
    ]);

    if (!model || !model.isActive) {
      return res.status(404).json({ success: false, message: 'Model not found or unavailable' });
    }

    /*
     * Resolved through the one module create also uses, so the price quoted
     * here and the price charged there cannot drift apart. Stock is
     * deliberately not required at quote time — it is transient, and refusing
     * to even price an out-of-stock machine tells the customer nothing.
     */
    const resolved = await machineChoice.resolve({ model, tierId, customBuild, settings });
    if (resolved.error) {
      return res.status(resolved.error.status).json({
        success: false, code: resolved.error.code, message: resolved.error.message,
      });
    }
    const { machine } = resolved;
    const listRate = machine.listRate;

    const discountPercent = await billingModeService.getPlanDiscount(req.user);
    const effectiveRate = round4(listRate * (1 - discountPercent / 100));

    const [wallet, currentBurn, debt, hasVerifiedCard] = await Promise.all([
      creditService.getOrCreateWallet(req.team.id),
      deploymentService.getBurnRate(req.team.id),
      debtService.status(req.team.id, { settings }),
      paymentMethodService.hasVerifiedCard(req.team.id),
    ]);

    const requiredBalance = round4((currentBurn + effectiveRate) * (settings.minHoursBalanceToDeploy || 0));
    // Dispute hold, PAYG access and account age belong to the account that
    // would pay (req.team, read fresh by teamContext on this request).
    const disputeHold = !!req.team?.disputeHold;

    // The platform switch AND this customer's own override — see
    // fundingService.resolvePaygAccess.
    const paygAccess = fundingService.resolvePaygAccess(req.team, settings);

    const paygEligibility = fundingService.evaluatePaygEligibility({
      lifetimeSpend: wallet.lifetimeSpend || 0,
      accountAgeDays: daysSince(req.team?.createdAt, new Date()),
      minLifetimeSpend: settings.payg?.eligibility?.minLifetimeSpend || 0,
      minAccountAgeDays: settings.payg?.eligibility?.minAccountAgeDays || 0,
    });

    // This member's monthly spend limit in the team, if one applies.
    const spendLimit = await require('../../services/team/spendLimitService')
      .limitStatus(req.team.id, req.membership, req.user.id);

    const evalFor = (billingMethod) => fundingService.evaluateFunding({
      debtBlocked: debt.blocked,
      debtReason: debt.reason,
      requireVerifiedCard: !!settings.cardGate?.requireVerifiedCard,
      hasVerifiedCard,
      balance: wallet.balance,
      requiredBalance,
      billingMethod,
      disputeHold,
      paygEligible: billingMethod === 'payg' ? paygEligibility.eligible : true,
      paygEligibleReason: paygEligibility.reason,
      paygAvailable: paygAccess.available,
      spendLimitReached: !!spendLimit?.reached,
    });

    const money = canSeeMoney(req.membership);
    const withMessage = (result) => ({
      ...result,
      ...(money ? {} : { shortfall: undefined }),
      message: result.ok ? null : fundingErrorMessage(
        { code: result.code, requiredBalance, balance: wallet.balance },
        settings,
        { money },
      ),
    });

    const prepaid = withMessage(evalFor('prepaid'));
    const paygAvailable = paygAccess.available;
    // `ok` here means "you could deploy on this method right now" — folding
    // in the platform-wide switch, not just whether funding would clear if
    // it were on, so a reader of this field never has to also check
    // `available` separately to know whether it actually means yes.
    const payg = paygAvailable
      ? withMessage(evalFor('payg'))
      : {
        ok: false, code: 'PAYG_UNAVAILABLE', reason: paygAccess.reason, shortfall: 0,
        message: paygUnavailableMessage(paygAccess.reason),
      };

    res.json({
      success: true,
      currency: machine.currency,
      machine: {
        name: machine.name,
        isCustom: machine.isCustom,
        specs: machine.specs,
        regions: machine.regions,
        bookable: machine.bookable,
      },
      pricing: {
        listRate,
        effectiveRate,
        discountPercent,
        listStoppedRate: machine.listStoppedRate,
      },
      // The account's own money — only for members who may see it. The
      // machine's price above is the public catalog price, shown to everyone.
      ...(money ? {
        wallet: { balance: wallet.balance, currency: wallet.currency },
        requiredBalance,
        affordableHours: effectiveRate > 0 ? Math.floor((wallet.balance / effectiveRate) * 100) / 100 : null,
      } : {}),
      cardGate: {
        required: !!settings.cardGate?.requireVerifiedCard,
        hasVerifiedCard,
      },
      prepaid,
      payg: { ...payg, available: paygAvailable, eligible: paygEligibility.eligible },
    });
  } catch (error) {
    console.error('Get checkout options error:', error);
    res.status(500).json({ success: false, message: 'Error fetching checkout options' });
  }
};

/**
 * POST /api/v1/customer/deployments
 * Submit a deployment request. Lands as 'pending_review' for the admin queue.
 */
const createDeployment = async (req, res) => {
  try {
    const {
      deploymentName, modelId, tierId, customBuild, region, requirements = [],
      billingMethod: requestedBillingMethod, idempotencyKey,
    } = req.body;

    // Either a catalogue machine or a custom one, but there must be a machine.
    const hasMachine = !!tierId || !!(customBuild?.picks || []).length;
    if (!deploymentName || !modelId || !hasMachine) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a deployment name, a model and a machine',
      });
    }

    /**
     * The checkout modal mints one key per attempt and resends it on every
     * retry — a double-click on Deploy, or a request that actually succeeded
     * but whose response never made it back to the browser, must return the
     * SAME deployment rather than create a second one against the same
     * wallet/tier stock.
     */
    if (idempotencyKey) {
      const existing = await deploymentService.findByIdempotencyKey(req.user.id, idempotencyKey, req.team.id);
      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'Deployment already requested.',
          deployment: serializeFor(req, existing, { full: true }),
          idempotent: true,
        });
      }
    }

    const billingMethod = requestedBillingMethod === 'payg' ? 'payg' : 'prepaid';

    const [model, settings] = await Promise.all([
      catalogService.findModelByIdentifier(modelId),
      billingModeService.getBillingSettings(),
    ]);

    if (!model || !model.isActive) {
      return res.status(404).json({ success: false, message: 'Model not found or unavailable' });
    }
    if (model.status === 'coming_soon') {
      return res.status(400).json({
        success: false,
        message: `${model.name} is not available for deployment yet.`,
      });
    }

    /*
     * The machine, resolved and priced by the same module the checkout quote
     * used — including every refusal: a catalogue machine this model is not
     * offered on, one that has gone out of stock, or a custom build with less
     * VRAM than the model needs to load at all. Nothing here trusts a price
     * from the client.
     */
    const resolved = await machineChoice.resolve({
      model, tierId, customBuild, settings, requireBookable: true,
    });
    if (resolved.error) {
      return res.status(resolved.error.status).json({
        success: false, code: resolved.error.code, message: resolved.error.message,
      });
    }
    const { machine } = resolved;
    const listRate = machine.listRate;

    // Required questions must be answered
    const questions = await questionTemplateService.getForModel(model);
    const answerMap = {};
    (requirements || []).forEach((r) => {
      if (r && r.questionKey !== undefined) answerMap[r.questionKey] = r.answer;
    });

    /**
     * Enforce required-ness only for questions the customer was actually
     * asked.
     *
     * The journey decides what appears on screen. If it omits a question the
     * questionnaire marks required — an admin reordering steps, say — then
     * enforcing it here would reject every submission with an error the
     * customer has no way to act on, because the field they are told to fill
     * in is not in the flow. Resolved server-side from `journeyKey` so a
     * client cannot shrink the list by lying about it.
     */
    let askedKeys = null;
    if (req.body.journeyKey) {
      try {
        const resolved = await journeyService.resolveJourney({
          model,
          mode: req.body.journeyKey.includes('requirements') ? 'requirements_first' : 'model_first',
        });
        if (resolved.journey) {
          askedKeys = new Set(
            journeyService.journeyQuestions(resolved.steps).map((q) => q.key)
          );
        }
      } catch (err) {
        // Fall back to enforcing everything rather than enforcing nothing.
        console.error('[Deployment] Journey resolve failed, enforcing all required:', err.message);
      }
    }

    const missing = questions
      .filter((q) => q.required)
      .filter((q) => !askedKeys || askedKeys.has(q.key))
      .filter((q) => {
        const answer = answerMap[q.key];
        if (answer === undefined || answer === null || answer === '') return true;
        if (Array.isArray(answer) && answer.length === 0) return true;
        return false;
      })
      .map((q) => q.question);

    if (missing.length) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_REQUIREMENTS',
        message: 'Please answer all required questions before submitting.',
        missing,
      });
    }

    const discountPercent = await billingModeService.getPlanDiscount(req.user);
    const effectiveRate = round4(listRate * (1 - discountPercent / 100));

    /**
     * What holding this machine costs while it is paused or stopped, frozen
     * alongside the running rate. Repricing the tier later must not change
     * either number for an order already placed.
     */
    const listStoppedRate = machine.listStoppedRate;

    if (billingMethod === 'payg') {
      const paygAccess = fundingService.resolvePaygAccess(req.team, settings);
      if (!paygAccess.available) {
        return res.status(400).json({
          success: false,
          code: 'PAYG_UNAVAILABLE',
          message: paygUnavailableMessage(paygAccess.reason),
        });
      }
    }

    /**
     * Can this account actually fund a deployment at this rate? Plan
     * standing, outstanding debt, the card gate and wallet runway, all
     * through the one place every later resume asks the same question —
     * see services/billing/fundingService.js. Pay-as-you-go skips the
     * runway requirement by design (that's the whole offer), but still has
     * to clear debt and the card gate like anything else.
     */
    const funding = await fundingService.check(req.team.id, {
      actorUserId: req.user.id,
      rate: effectiveRate,
      settings,
      billingMethod,
      // The card is actually put through here, for BOTH billing methods —
      // prepaid needs it because an exhausted wallet leaves storage to collect,
      // pay-as-you-go needs it because collecting later is the whole model.
      liveCardCheck: true,
    });
    if (!funding.ok) {
      const money = canSeeMoney(req.membership);
      return res.status(402).json({
        success: false,
        code: funding.code,
        message: fundingErrorMessage(funding, settings, { money }),
        ...(money ? {
          required: funding.requiredBalance,
          balance: funding.balance,
          topUpRequired: funding.shortfall,
        } : {}),
      });
    }

    const chosenRegion = region || machine.regions[0] || 'default';

    /**
     * What our own engine would have advised, recomputed here rather than
     * accepted from the client so it cannot be tampered with. The value is for
     * the fulfilment queue: `followedRecommendation: false` tells an admin the
     * customer overrode our sizing, which is worth a second look before
     * provisioning expensive hardware.
     *
     * Returns null on any failure — our advice must never be able to block
     * someone's order.
     */
    const sizing = await recommendation.buildSizingSnapshot(
      model.toObject ? model.toObject() : model,
      requirements,
      // A custom machine has no catalogue id to compare against, so the
      // snapshot records what we would have advised with nothing to match it
      // to — which is exactly right: `followedRecommendation` comes back false
      // and the fulfilment queue sees the customer built their own.
      machine.tierId,
      { discountPercent, journeyKey: req.body.journeyKey || '' }
    );

    let deployment;
    try {
      deployment = await deploymentService.createDeployment({
        teamId: req.team.id,
        userId: req.user.id,
        deploymentName: String(deploymentName).trim(),
        idempotencyKey: idempotencyKey || undefined,
        billingMethod,
        billingMethodHistory: [{ method: billingMethod, reason: 'Chosen at deployment creation' }],
        model: {
          modelId: model.id,
          name: model.name,
          slug: model.slug,
          family: model.family,
          version: model.version,
          parameterSize: model.parameterSize,
          contextLength: model.contextLength,
        },
        tier: {
          tierId: machine.tierId,
          name: machine.name,
          categoryName: machine.categoryName,
          ...machine.specs,
          isCustom: machine.isCustom,
          customBuild: machine.customBuild,
        },
        region: chosenRegion,
        pricePerHour: listRate,
        stoppedPricePerHour: listStoppedRate,
        planDiscountPercent: discountPercent,
        currency: machine.currency,
        requirements: questions
          .filter((q) => answerMap[q.key] !== undefined)
          .map((q) => ({
            questionKey: q.key,
            question: q.question,
            type: q.type,
            answer: answerMap[q.key],
          })),
        ...(sizing ? { sizing } : {}),
        status: 'pending_review',
        statusHistory: [{ status: 'pending_review', at: new Date(), by: req.user.id, byName: req.user.name }],
      });
    } catch (err) {
      // Two near-simultaneous requests with the same key can both pass the
      // pre-check above and race to insert — the unique index catches the
      // loser here, which should return the winner's record, not a 500.
      if (err.existing) {
        return res.status(200).json({
          success: true,
          message: 'Deployment already requested.',
          deployment: serializeFor(req, err.existing, { full: true }),
          idempotent: true,
        });
      }
      throw err;
    }

    // Tell the admins there's something in the fulfillment queue
    try {
      const notificationService = require('../../services/notification/notificationService');
      const userService = require('../../services/user/userService');
      const admins = await userService.listActiveAdmins();
      const adminUrl = process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003';

      await notificationService.createMany(
        admins.map((admin) => ({
          recipientId: admin.id,
          recipientType: 'admin',
          type: 'deployment_requested',
          title: 'New deployment request',
          message: `${req.user.name} requested ${model.name} on ${machine.name} (${deployment.currency} ${effectiveRate}/hr)`,
          priority: 'high',
          action: { label: 'Review Request', url: `${adminUrl}/deployments/${deployment.id}` },
          metadata: { deploymentId: deployment.id, customerId: req.user.id },
        }))
      );
    } catch (err) {
      console.error('[Deployment] Failed to notify admins:', err.message);
    }

    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'deployment_requested',
      actionType: 'create',
      targetModel: 'Deployment',
      targetId: deployment.id,
      targetName: deployment.deploymentName,
      description: `Requested ${model.name} on ${machine.name}`,
      metadata: {
        modelId: model.id,
        tierId: machine.tierId,
        customMachine: machine.isCustom,
        pricePerHour: effectiveRate,
      },
      status: 'success',
    });

    res.status(201).json({
      success: true,
      message: 'Deployment requested. Our team will review it shortly.',
      deployment: serializeFor(req, deployment, { full: true }),
    });
  } catch (error) {
    console.error('Create deployment error:', error);
    res.status(500).json({ success: false, message: 'Error creating deployment' });
  }
};

/**
 * GET /api/v1/customer/deployments
 */
const getDeployments = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const [{ deployments, total }, burnRate] = await Promise.all([
      deploymentService.listForTeam(req.team.id, { status, page, limit }),
      deploymentService.getBurnRate(req.team.id),
    ]);

    res.json({
      success: true,
      deployments: deployments.map((d) => serializeFor(req, d)),
      // The account's spend rate — money, so only for those who may see it.
      ...(canSeeMoney(req.membership) ? { burnRatePerHour: burnRate } : {}),
      pagination: meta({ page, limit }, total),
    });
  } catch (error) {
    console.error('Get deployments error:', error);
    res.status(500).json({ success: false, message: 'Error fetching deployments' });
  }
};

/**
 * Load a deployment that belongs to the requesting customer.
 */
const findOwned = async (req) =>
  deploymentService.findOwned(req.params.id, req.team.id);

/**
 * GET /api/v1/customer/deployments/:id
 */
const getDeployment = async (req, res) => {
  try {
    const deployment = await findOwned(req);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }

    const settings = await billingModeService.getBillingSettings();
    res.json({
      success: true,
      deployment: serializeFor(req, deployment, { full: true }),
      storageGrace: await buildStorageGraceInfo(deployment),
      // So the page offers "switch to pay-as-you-go" only to a customer who
      // can actually have it, rather than a button the server then refuses.
      paygAvailable: fundingService.resolvePaygAccess(req.team, settings).available,
    });
  } catch (error) {
    console.error('Get deployment error:', error);
    res.status(500).json({ success: false, message: 'Error fetching deployment' });
  }
};

/**
 * How many days are left before this deployment's unpaid storage is
 * released — the same grace period debtCollection.js counts down, computed
 * here so the customer can see it coming rather than discover it as a
 * termination notice. Grace is tracked account-wide (from `wallet.debtSince`,
 * not per-deployment), so this is null unless the deployment itself is
 * actually carrying unpaid storage right now.
 */
const buildStorageGraceInfo = async (deployment) => {
  if (!deployment.hasUnpaidStorage) return null;

  const [wallet, settings] = await Promise.all([
    creditService.getOrCreateWallet(deployment.teamId),
    billingModeService.getBillingSettings(),
  ]);

  const graceDays = settings.storageGrace?.graceDays ?? 7;
  const debtDays = daysSince(wallet.debtSince, new Date());

  return {
    enabled: !!settings.storageGrace?.enabled,
    daysRemaining: Math.max(0, graceDays - debtDays),
    graceDays,
    message: billingCopy(settings, 'storageDebtMessage', {
      deploymentName: deployment.deploymentName,
      storageGb: deployment.tier?.storageGb || 0,
    }),
  };
};

/**
 * GET /api/v1/customer/deployments/:id/api-key
 * Explicit reveal, logged — so retrieving a credential leaves an audit trail.
 */
const revealApiKey = async (req, res) => {
  try {
    const deployment = await findOwned(req);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }
    /**
     * Access is decided by the deployment's own rule, not by whether a key
     * happens to be stored. A paused or stopped deployment is not being charged
     * for compute, so handing its key back would let the customer keep
     * consuming inference for free — the exact hole this closes.
     *
     * Checked before the "no key issued" case so a suspended deployment gets
     * the accurate reason rather than a misleading 404.
     */
    if (!deployment.hasLiveAccess()) {
      const revoked = !!deployment.endpoint?.revokedAt;
      return res.status(403).json({
        success: false,
        code: revoked ? 'ENDPOINT_REVOKED' : 'ENDPOINT_SUSPENDED',
        status: deployment.status,
        message: revoked
          ? 'This deployment was terminated and its API key was permanently revoked.'
          : `This deployment is ${deployment.status}, so its API key is not active. `
            + 'Resume it to have a key issued.',
      });
    }

    if (!deployment.endpoint?.apiKeyEncrypted) {
      return res.status(404).json({ success: false, message: 'No API key has been issued yet' });
    }

    const apiKey = cryptoHelper.decrypt(deployment.endpoint.apiKeyEncrypted);
    if (apiKey === null) {
      return res.status(500).json({
        success: false,
        message: 'The stored API key could not be read. Please contact support to have it reissued.',
      });
    }

    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'deployment_endpoint_set',
      actionType: 'read',
      targetModel: 'Deployment',
      targetId: deployment.id,
      targetName: deployment.deploymentName,
      description: `Revealed API key for "${deployment.deploymentName}"`,
      status: 'success',
    });

    res.json({ success: true, apiKey, endpointUrl: deployment.endpoint.url });
  } catch (error) {
    console.error('Reveal API key error:', error);
    res.status(500).json({ success: false, message: 'Error retrieving API key' });
  }
};

/**
 * GET /api/v1/customer/deployments/:id/usage
 */
const getUsage = async (req, res) => {
  try {
    const deployment = await findOwned(req);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }

    const { days = 30 } = req.query;
    const [trend, recent] = await Promise.all([
      deploymentUsageService.getDailyTrend(deployment.id, parseInt(days)),
      deploymentUsageService.listRecent(deployment.id, 50),
    ]);

    /**
     * The same billed-versus-used gap the billing page has: `totalRuntimeHours`
     * and `totalCost` stop at the watermark, so time on the clock since then is
     * reported separately rather than being quietly missing from the page.
     */
    const rate = deployment.currentRate();
    const since = deployment.lastBilledAt || deployment.startedAt;
    const elapsedHours = since
      ? Math.max(0, (Date.now() - new Date(since).getTime()) / (60 * 60 * 1000))
      : 0;
    const accruing = rate > 0 && elapsedHours > 0;

    /*
     * Hours only, for a member who may not see money: the runtime is theirs to
     * know, what it cost is the account's.
     */
    if (!canSeeMoney(req.membership)) {
      return res.json({
        success: true,
        trend: trend.map(({ date, hours }) => ({ date, hours })),
        recent: recent.map(({
          amount, rate: _rate, toWallet, toDebt, transactionId, debtTransactionId, ...rest
        }) => rest),
        totals: {
          hours: deployment.totalRuntimeHours,
          billedThrough: since || null,
          unbilled: accruing
            ? {
              kind: deployment.status === 'running' ? 'running' : 'storage',
              hours: Math.round(elapsedHours * 10000) / 10000,
            }
            : null,
        },
      });
    }

    res.json({
      success: true,
      trend,
      recent,
      totals: {
        hours: deployment.totalRuntimeHours,
        cost: deployment.totalCost,
        currency: deployment.currency,
        billedThrough: since || null,
        unbilled: accruing
          ? {
            kind: deployment.status === 'running' ? 'running' : 'storage',
            hours: Math.round(elapsedHours * 10000) / 10000,
            rate,
            cost: Math.round(rate * elapsedHours * 100) / 100,
          }
          : null,
      },
    });
  } catch (error) {
    console.error('Get deployment usage error:', error);
    res.status(500).json({ success: false, message: 'Error fetching usage' });
  }
};

/**
 * Customer-initiated lifecycle actions. The transition rules and all the side
 * effects live in deploymentService.
 */
const ACTIONS = {
  pause: { to: 'paused', note: 'Paused by customer' },
  resume: { to: 'running', note: 'Resumed by customer' },
  stop: { to: 'stopped', note: 'Stopped by customer' },
  terminate: { to: 'terminated', note: 'Terminated by customer' },
};

const changeStatus = (action) => async (req, res) => {
  try {
    const config = ACTIONS[action];
    const deployment = await findOwned(req);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }

    // A Developer may terminate only what they created; Owner/Admin anything.
    if (action === 'terminate' && !canTerminate(req.membership, deployment, req.user.id)) {
      return res.status(403).json({
        success: false,
        code: 'TEAM_PERMISSION_DENIED',
        message: 'You can only terminate deployments you created.',
      });
    }

    /**
     * Resuming is funded the same way running it the first time was —
     * transition() itself asks fundingService before it will actually flip
     * the status to running, so there is nothing to duplicate here. This
     * used to be a much weaker check done only for `resume` (`balance >
     * graceBalance`, a far lower bar than order time ever required), which
     * is exactly how a resume could succeed moments before the hourly job
     * paused the same deployment right back.
     */
    await deploymentService.transition(deployment, config.to, {
      actor: req.user,
      note: config.note,
      silent: true, // the customer did this themselves; no need to email them
    });

    res.json({
      success: true,
      message: `Deployment ${config.to}`,
      deployment: serializeFor(req, deployment, { full: true }),
    });
  } catch (error) {
    if (error.status === 400) {
      return failure(res, error, 'Something went wrong. Please try again.');
    }
    if (error.status === 402) {
      const money = canSeeMoney(req.membership);
      return res.status(402).json({
        success: false,
        code: error.code,
        message: money ? error.message : memberFundingMessage(error.code),
        ...(money ? {
          balance: error.balance,
          required: error.requiredBalance,
          topUpRequired: error.shortfall,
        } : {}),
      });
    }
    console.error(`Deployment ${action} error:`, error);
    res.status(500).json({ success: false, message: `Error trying to ${action} deployment` });
  }
};

/**
 * POST /api/v1/customer/deployments/:id/billing-method
 *
 * Switch between prepaid and pay-as-you-go. This is the "Haan" side of the
 * offer a prepaid deployment gets when it auto-pauses for lack of credit
 * (see jobs/hourlyBilling.js's offerPayg) — but it works at any time, on any
 * deployment, not only in response to that offer.
 */
const setBillingMethod = async (req, res) => {
  try {
    const { method } = req.body;
    if (!['prepaid', 'payg'].includes(method)) {
      return res.status(400).json({ success: false, message: 'method must be "prepaid" or "payg"' });
    }

    const deployment = await findOwned(req);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }

    if (deployment.billingMethod === method) {
      return res.json({
        success: true,
        message: `Already on ${method === 'payg' ? 'pay-as-you-go' : 'prepaid'}`,
        deployment: serializeFor(req, deployment, { full: true }),
      });
    }

    const settings = await billingModeService.getBillingSettings();
    if (method === 'payg') {
      const paygAccess = fundingService.resolvePaygAccess(req.team, settings);
      if (!paygAccess.available) {
        return res.status(400).json({
          success: false,
          code: 'PAYG_UNAVAILABLE',
          message: paygUnavailableMessage(paygAccess.reason),
        });
      }
    }

    /**
     * The switch itself lives in deploymentService, because two things have to
     * happen around it that a route must not be trusted to remember: the hours
     * already run are settled under the OLD method first, and moving onto
     * pay-as-you-go is put through the same funding gate as starting a
     * deployment on it. See changeBillingMethod for what went wrong without
     * each of them.
     */
    try {
      await deploymentService.changeBillingMethod(deployment, method, {
        actor: req.user,
        reason: `Customer switched to ${method}`,
      });
    } catch (err) {
      if (err.status === 402 || err.status === 400) {
        const money = canSeeMoney(req.membership);
        return res.status(err.status).json({
          success: false,
          code: err.code || null,
          message: err.code ? fundingErrorMessage(err, settings, { money }) : err.message,
          ...(money ? { shortfall: err.shortfall, balance: err.balance } : {}),
        });
      }
      throw err;
    }

    /**
     * The whole point of the offer is not to make the customer separately
     * press Resume afterward — if this is exactly the paused-for-credit
     * deployment the offer was about, try to bring it back immediately,
     * funded the new way. transition() itself asks fundingService, so a
     * missing verified card or a blocked debt still refuses correctly here;
     * this only attempts it and reports what happened rather than assuming
     * it will succeed.
     */
    let resumeAttempted = false;
    let resumed = false;
    let resumeError = null;

    if (method === 'payg' && deployment.status === 'paused' && deployment.autoSuspendedForCredit) {
      resumeAttempted = true;
      try {
        await deploymentService.transition(deployment, 'running', { actor: req.user, silent: true });
        resumed = true;
      } catch (err) {
        resumeError = { code: err.code || null, message: err.message };
      }
    }

    res.json({
      success: true,
      message: `Billing method switched to ${method === 'payg' ? 'pay-as-you-go' : 'prepaid'}`,
      deployment: serializeFor(req, deployment, { full: true }),
      resumeAttempted,
      resumed,
      resumeError,
    });
  } catch (error) {
    console.error('Set billing method error:', error);
    res.status(500).json({ success: false, message: 'Error switching billing method' });
  }
};

module.exports = {
  getQuestionnaire,
  getCheckoutOptions,
  createDeployment,
  getDeployments,
  getDeployment,
  revealApiKey,
  getUsage,
  pause: changeStatus('pause'),
  resume: changeStatus('resume'),
  stop: changeStatus('stop'),
  terminate: changeStatus('terminate'),
  setBillingMethod,
  serialize,
};
