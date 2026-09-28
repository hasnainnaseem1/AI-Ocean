/**
 * Customer Deployment Routes
 *
 * The gate chain mirrors the platform's existing pattern:
 *   auth + teamContext (parent router)   who, and in which account
 *   → checkFeatureEnabled               admin's global kill-switch
 *   → requirePermission                 what their role in that account allows
 *                                        (services/team/permissions.js)
 */
const express = require('express');
const router = express.Router();
const { checkFeatureEnabled } = require('../../../middleware/security');
const { requirePermission } = require('../../../middleware/auth');
const deploymentController = require('../../../controllers/customer/deploymentController');
const recommendationController = require('../../../controllers/customer/recommendationController');

const deploymentsEnabled = checkFeatureEnabled('enableDeployments');
const view = requirePermission('deployments.view');
const create = requirePermission('deployments.create');
const operate = requirePermission('deployments.operate');

// ── Reads ──
// Literal paths must precede '/:id', or Express matches "questionnaire" and
// "journey" as deployment ids.
router.get('/', deploymentsEnabled, view, deploymentController.getDeployments);
router.get('/questionnaire', deploymentsEnabled, view, deploymentController.getQuestionnaire);
router.get('/journey', deploymentsEnabled, view, recommendationController.getJourney);
router.get('/checkout-options', deploymentsEnabled, create, deploymentController.getCheckoutOptions);
router.get('/:id', deploymentsEnabled, view, deploymentController.getDeployment);
router.get('/:id/usage', deploymentsEnabled, view, deploymentController.getUsage);
router.get('/:id/api-key', deploymentsEnabled, requirePermission('deployments.apiKey'), deploymentController.revealApiKey);

/**
 * Sizing advice. Deliberately NOT behind the funding checks — a customer has
 * to be able to explore what something would cost before committing to
 * anything, and this endpoint writes nothing. Those checks belong on POST
 * '/' below, where the commitment actually happens.
 *
 * POST rather than GET because answers can be arrays and the payload grows.
 */
router.post('/recommend', deploymentsEnabled, view, recommendationController.recommend);

/**
 * The same checkout quote as the GET above, for a machine the customer built
 * themselves — a parts list does not fit in a query string. One handler, so
 * the two can never quote differently.
 */
router.post('/checkout-options', deploymentsEnabled, create, deploymentController.getCheckoutOptions);

// ── Create ──
router.post('/', deploymentsEnabled, create, deploymentController.createDeployment);

// ── Lifecycle ──
router.post('/:id/pause', deploymentsEnabled, operate, deploymentController.pause);
router.post('/:id/resume', deploymentsEnabled, operate, deploymentController.resume);
router.post('/:id/stop', deploymentsEnabled, operate, deploymentController.stop);
// Terminate is checked in the controller: a Developer may terminate only a
// deployment they created, which needs the deployment in hand.
router.post('/:id/terminate', deploymentsEnabled, requirePermission('deployments.terminateOwn'), deploymentController.terminate);
router.post('/:id/billing-method', deploymentsEnabled, requirePermission('deployments.billingMethod'), deploymentController.setBillingMethod);

module.exports = router;
