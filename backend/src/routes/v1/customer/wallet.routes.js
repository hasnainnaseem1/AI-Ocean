/**
 * Customer Wallet Routes
 *
 * Prepaid credit balance, ledger and top-ups.
 */
const express = require('express');
const router = express.Router();
const walletController = require('../../../controllers/customer/walletController');
const { requirePermission } = require('../../../middleware/auth');

const view = requirePermission('billing.view');
const manage = requirePermission('billing.manage');

// auth + teamContext are applied by the parent router
router.get('/', view, walletController.getWallet);
router.get('/transactions', view, walletController.getTransactions);
router.post('/topup', manage, walletController.createTopUp);
router.post('/topup/instant', manage, walletController.createInstantTopUp);
router.put('/auto-topup', manage, walletController.updateAutoTopUp);

module.exports = router;
