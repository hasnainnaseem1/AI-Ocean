/**
 * Customer Payment Method Routes
 *
 * Saved cards. Stripe cards are verified through SetupIntents (setup-intent +
 * the POST below); Polar cards are saved on Polar's own hosted Customer
 * Portal instead (polar-portal), since Polar's card management is a
 * redirect, not an embedded form — see paymentMethodService.js/
 * polarService.js. Not gated by billing mode the way wallet routes are — a
 * card can be needed for pay-as-you-go even in a platform that also runs
 * subscriptions.
 */
const express = require('express');
const router = express.Router();
const controller = require('../../../controllers/customer/paymentMethodController');
const { requirePermission } = require('../../../middleware/auth');

const view = requirePermission('billing.view');
const manage = requirePermission('billing.manage');

// auth + teamContext are applied by the parent router
router.get('/', view, controller.getPaymentMethods);
router.post('/setup-intent', manage, controller.createSetupIntent);
router.post('/polar-portal', manage, controller.createPolarPortalSession);
router.post('/', manage, controller.attachPaymentMethod);
router.put('/:id/default', manage, controller.setDefaultPaymentMethod);
router.delete('/:id', manage, controller.removePaymentMethod);

module.exports = router;
