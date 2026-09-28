/**
 * Customer Catalog Routes
 *
 * Browsing the AI model catalog and the machine tiers, with prices already
 * adjusted for the customer's plan discount.
 */
const express = require('express');
const router = express.Router();
const { checkFeatureEnabled } = require('../../../middleware/security');
const catalogController = require('../../../controllers/customer/catalogController');

// auth is applied by the parent router
router.get('/models', checkFeatureEnabled('enableModelCatalog'), catalogController.getModels);
router.get('/tiers', checkFeatureEnabled('enableModelCatalog'), catalogController.getTiers);
// The feature gate is per-route in this file, not router-level — a new route
// that forgets it silently escapes the flag.
router.get('/tiers/:identifier', checkFeatureEnabled('enableModelCatalog'), catalogController.getTier);
// Building your own machine rather than picking one — gated on deployments,
// not the catalogue, because that is the only thing it leads to.
router.get('/custom-build', checkFeatureEnabled('enableDeployments'), catalogController.getCustomBuildOptions);
router.post('/custom-build/quote', checkFeatureEnabled('enableDeployments'), catalogController.quoteCustomBuild);
router.get('/models/:slug', checkFeatureEnabled('enableModelCatalog'), catalogController.getModel);

module.exports = router;
