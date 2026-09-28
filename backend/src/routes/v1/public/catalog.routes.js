/**
 * Public Catalog Routes
 *
 * Unauthenticated catalog + pricing for the marketing website. Same shape as
 * the customer routes but always at list price — there's no signed-in customer
 * to apply a plan discount for.
 */
const express = require('express');
const router = express.Router();
const catalogService = require('../../../services/catalog/catalogService');
const adminSettingsService = require('../../../services/admin/adminSettingsService');
const { buildTierOptions, serializeModel } = require('../../../controllers/customer/catalogController');

/**
 * The catalog is hidden entirely when the admin turns the feature off.
 */
const catalogEnabled = async (req, res, next) => {
  try {
    const settings = await adminSettingsService.getSettings();
    if (settings.features?.enableModelCatalog === false) {
      return res.status(403).json({
        success: false,
        message: 'The model catalog is currently unavailable.',
      });
    }
    next();
  } catch (err) {
    // Fail open, matching featureGate.js
    next();
  }
};

/**
 * GET /api/v1/public/catalog/models
 */
router.get('/models', catalogEnabled, async (req, res) => {
  try {
    const { family, modality } = req.query;

    const [models, tiers] = await Promise.all([
      catalogService.listActiveModels({ family, modality }),
      catalogService.listActiveTiers(),
    ]);

    res.json({
      success: true,
      models: models.map((model) => serializeModel(model, buildTierOptions(model, tiers, 0))),
      total: models.length,
    });
  } catch (err) {
    console.error('Public catalog models error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch models' });
  }
});

/**
 * GET /api/v1/public/catalog/tiers
 */
router.get('/tiers', catalogEnabled, async (req, res) => {
  try {
    const [tiers, categories] = await Promise.all([
      catalogService.listActiveTiers({ orderByPrice: true }),
      catalogService.listActiveTierCategories(),
    ]);

    const byId = new Map(categories.map((c) => [String(c.id), c]));

    res.json({
      success: true,
      tiers: tiers.map(({ categoryId, ...t }) => {
        const category = categoryId && byId.get(String(categoryId));
        return {
          ...t,
          category: category
            ? { name: category.name, slug: category.slug, color: category.color }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error('Public tiers error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch tiers' });
  }
});

/**
 * GET /api/v1/public/catalog/use-cases
 *
 * The same vocabulary the deployment questionnaire and the model form both
 * draw on, so the "what can you build" section of the marketing site can never
 * drift from what the catalogue actually supports — an admin adding a use case
 * gets a new card here without anyone editing a page.
 *
 * `modelCount` is resolved here rather than in the browser so the marketing
 * site makes one request instead of fetching the whole model list to count.
 */
router.get('/use-cases', catalogEnabled, async (req, res) => {
  try {
    const [tags, models] = await Promise.all([
      catalogService.listActiveUseCaseTags(),
      catalogService.listActiveModels(),
    ]);

    const counts = new Map();
    for (const model of models) {
      for (const uc of model.useCases || []) {
        if (!uc?.key) continue;
        counts.set(uc.key, (counts.get(uc.key) || 0) + 1);
      }
    }

    res.json({
      success: true,
      useCases: tags.map((t) => ({ ...t, modelCount: counts.get(t.key) || 0 })),
    });
  } catch (err) {
    console.error('Public use cases error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch use cases' });
  }
});

/**
 * GET /api/v1/public/catalog/models/:slug
 */
router.get('/models/:slug', catalogEnabled, async (req, res) => {
  try {
    const model = await catalogService.findActiveModelBySlug(req.params.slug);
    if (!model) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }

    const [tiers, categories] = await Promise.all([
      catalogService.listActiveTiers(),
      catalogService.listActiveTierCategories(),
    ]);
    const byId = new Map(categories.map((c) => [String(c.id), c]));

    res.json({
      success: true,
      model: serializeModel(model, buildTierOptions(model, tiers, 0, byId), { full: true }),
    });
  } catch (err) {
    console.error('Public catalog model error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch model' });
  }
});

module.exports = router;
