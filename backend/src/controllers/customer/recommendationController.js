/**
 * Recommendation Controller (customer side)
 *
 * Sizing advice for the guided deploy journey. Read-only and stateless — these
 * endpoints compute and return, they never write, so the frontend can call
 * them freely as the customer answers.
 *
 * Note what is NOT here: there is no error path for "your requirements are
 * impossible". An unaffordable budget or an undersized catalogue comes back as
 * HTTP 200 with a warning reason attached. Constraints rank and warn; they
 * never reject.
 */
const recommendation = require('../../services/recommendation');
const journeyService = require('../../services/deployment/journeyService');
const billingModeService = require('../../services/billing/billingModeService');
const catalogService = require('../../services/catalog/catalogService');
// `buildTierOptions` is already shared this way — the public catalogue routes
// import it from the same place. Reusing it is what keeps the price a customer
// is quoted identical to the one createDeployment charges.
const catalogController = require('./catalogController');

const MAX_ANSWERS = 100;
const MAX_MATCH_LIMIT = 25;

/** Strip the internal profile before anything leaves the process. */
const publicResult = (result) => {
  const { _profile, ...rest } = result;
  return rest;
};

/**
 * POST /api/v1/customer/deployments/recommend
 *
 * Body: { modelId?, answers: [{ questionKey, answer }], limit? }
 *
 * With a modelId  → sizes hardware for that model and judges its suitability.
 * Without one     → ranks the catalogue and suggests a model as well.
 */
const recommend = async (req, res) => {
  try {
    const { modelId, answers = [], limit } = req.body;

    if (!Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: 'answers must be an array of { questionKey, answer }',
      });
    }

    // Sanity caps — this route is behind auth, so this is about bounding work
    // per call rather than defending against an attacker.
    const trimmed = answers.slice(0, MAX_ANSWERS);
    const matchLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), MAX_MATCH_LIMIT);

    const discountPercent = await billingModeService.getPlanDiscount(req.user);

    if (modelId) {
      const model = await recommendation.findModelById(modelId);
      if (!model) {
        return res.status(404).json({
          success: false,
          code: 'MODEL_NOT_FOUND',
          message: 'Model not found',
        });
      }

      const result = await recommendation.sizeForModel(model, trimmed, discountPercent);

      return res.json({
        success: true,
        ...publicResult(result),
        model: {
          id: model.id,
          name: model.name,
          slug: model.slug,
          family: model.family,
          shortDescription: model.shortDescription,
          logoUrl: model.logoUrl,
          modalities: model.modalities,
          parameterSize: model.parameterSize,
          contextLength: model.contextLength,
          minVramGb: model.minVramGb,
          status: model.status,
          strengths: model.strengths || [],
          limitations: model.limitations || [],
        },
      });
    }

    const result = await recommendation.matchModels(trimmed, {
      discountPercent,
      limit: matchLimit,
    });

    return res.json({ success: true, ...publicResult(result) });
  } catch (error) {
    console.error('Recommend error:', error);
    res.status(500).json({ success: false, message: 'Error computing a recommendation' });
  }
};

/**
 * The machine a customer already picked, in the shape the recommendation step
 * would otherwise have produced — so the journey can drop that step and the
 * review screen and checkout still have a tier to work with.
 *
 * Built with `buildTierOptions`, deliberately, and never with the catalogue's
 * own tier serializer. There are two tier shapes in this codebase and they
 * quote DIFFERENT prices: the catalogue's is the machine's own rate, while
 * this one is the machine's rate × the model's `priceMultiplier` — which is
 * what `rateForTier` charges at create time. Two links in the catalogue
 * currently carry a multiplier above 1, so the wrong one would show a customer
 * a rate 10-15% below what they are actually billed, on the very screen where
 * they commit.
 *
 * Returns null when the machine is unknown, inactive, or not offered for this
 * model — `buildTierOptions` already applies the first two, and produces no row
 * at all for a model/tier pair that has no link.
 */
const chosenMachine = async (model, identifier, discountPercent) => {
  if (!model || !identifier) return null;

  const tier = await catalogService.findTierByIdentifier(identifier);
  const [option] = catalogController.buildTierOptions(model, tier ? [tier] : [], discountPercent);
  if (!option) return null;

  return {
    ...option,
    currency: tier.currency,
    // Stock is transient, so it is reported rather than enforced here;
    // createDeployment stays the single authority and answers 409 if it has
    // gone by the time they commit.
    bookable: catalogService.isBookable(tier),
  };
};

/**
 * GET /api/v1/customer/deployments/journey?modelId=&mode=&machine=
 *
 * The admin-authored flow, with its question references hydrated.
 *
 * `machine` is set when the customer came from the machine catalogue and has
 * already chosen their hardware. It accepts a slug or an id.
 */
const getJourney = async (req, res) => {
  try {
    const { modelId, mode, machine: machineIdentifier } = req.query;

    const resolvedMode = mode === 'requirements_first' ? 'requirements_first' : 'model_first';

    let model = null;
    if (modelId) {
      model = await journeyService.findModel(modelId);
      if (!model) {
        return res.status(404).json({
          success: false,
          code: 'MODEL_NOT_FOUND',
          message: 'Model not found',
        });
      }
    }

    /*
     * A machine only means anything alongside a model — it is the pair that is
     * priced and validated, never the machine alone.
     *
     * An unusable one is ignored rather than refused: these identifiers travel
     * in URLs customers bookmark and share, and a machine that was retired or
     * unlinked since should still let them deploy, just via the full journey
     * with its recommendation step back in place.
     */
    let machine = null;
    if (model && machineIdentifier) {
      const discountPercent = await billingModeService.getPlanDiscount(req.user);
      machine = await chosenMachine(model, machineIdentifier, discountPercent);
      if (!machine) {
        console.warn(
          `[Journey] Ignoring machine "${machineIdentifier}" for model "${model.slug}" — `
          + 'unknown, inactive, or not offered on it.'
        );
      }
    }

    const resolved = await journeyService.resolveJourney({
      model,
      // Without a model there is nothing to be "model first" about.
      mode: model ? resolvedMode : 'requirements_first',
      machineChosen: !!machine,
    });

    res.json({ success: true, ...resolved, machine });
  } catch (error) {
    console.error('Get journey error:', error);
    res.status(500).json({ success: false, message: 'Error loading the deployment journey' });
  }
};

module.exports = { recommend, getJourney };
