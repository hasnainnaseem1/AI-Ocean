/**
 * Customer Billing Routes
 *
 * Endpoints for customers to view their payment history and download
 * invoices — shared by every payment type (wallet top-ups).
 */
const express = require('express');
const router = express.Router();
const billingController = require('../../../controllers/customer/billingController');
const { requirePermission } = require('../../../middleware/auth');

// Every figure on these routes is the account's money — Owner, Admin and
// Billing only (services/team/permissions.js).
const view = requirePermission('billing.view');
const manage = requirePermission('billing.manage');

// @route   GET /api/v1/customer/billing/payments
// @desc    Get customer's payment history
// @access  Private (Customer)
// @route   GET /api/v1/customer/billing/usage
// @desc    This month's charges per deployment, split into compute-while-running
//          and storage-while-stopped
// @access  Private (Customer)
router.get('/usage', view, billingController.getUsageSummary);

router.get('/payments', view, billingController.getPayments);

// @route   GET /api/v1/customer/billing/invoices
// @desc    Usage statements + top-up receipts — real data, replacing the old
//          frontend-only localStorage mock
// @access  Private (Customer)
router.get('/invoices', view, billingController.getInvoices);

// @route   POST /api/v1/customer/billing/verify-session
// @desc    Verify a completed Stripe Checkout session for a credit top-up
//          (fallback for when webhooks are delayed / not running in local dev)
// @access  Private (Customer)
router.post('/verify-session', manage, billingController.verifyCheckoutSession);

// @route   GET /api/v1/customer/billing/invoice/:paymentId
// @desc    Download a branded PDF invoice for a specific payment
// @access  Private (Customer)
router.get('/invoice/:paymentId', view, billingController.downloadInvoice);

module.exports = router;
