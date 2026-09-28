/**
 * Admin Wallet Routes
 *
 * View customer credit balances and make manual adjustments (goodwill credit,
 * a correction, a refund). Every adjustment goes through creditService so it
 * lands in the ledger like any other transaction.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const { meta } = require('../../../utils/helpers/pagination');
const router = express.Router();
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security');
const { validate } = require('../../../middleware/validation');
const schemas = require('../../../middleware/validation/schemas');
const userService = require('../../../services/user/userService');
const creditService = require('../../../services/billing/creditService');
const debtService = require('../../../services/billing/debtService');
const billingModeService = require('../../../services/billing/billingModeService');
const deploymentService = require('../../../services/deployment/deploymentService');
const teamService = require('../../../services/team/teamService');
const notificationService = require('../../../services/notification/notificationService');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

// @route   GET /api/v1/admin/wallets/debt
// @desc    Receivables — every customer currently carrying an unpaid balance.
//          A literal path, so it must be registered before '/:userId' below.
router.get('/debt', checkPermission('billing.view'), async (req, res) => {
  try {
    const {
      search, page = 1, limit = 50, sortBy = 'outstandingBalance', order = 'desc',
    } = req.query;

    const [{ wallets, total, totals }, settings] = await Promise.all([
      creditService.listWalletsAdmin({
        search, debtOnly: true, page, limit, sortBy, order,
      }),
      billingModeService.getBillingSettings(),
    ]);

    const now = new Date();
    const receivables = wallets.map((w) => ({
      ...w,
      debtStatus: debtService.evaluateDebtStatus({
        outstanding: w.outstandingBalance,
        debtSince: w.debtSince,
        now,
        creditLimit: settings.payg?.creditLimit ?? 0,
        maxDebtDays: settings.payg?.maxDebtDays ?? 0,
      }),
    }));

    res.json({
      success: true,
      wallets: receivables,
      summary: {
        totalOutstanding: Math.round((totals.totalOutstanding || 0) * 100) / 100,
        count: totals.count,
      },
      pagination: meta({ page, limit }, total),
    });
  } catch (error) {
    console.error('List receivables error:', error);
    res.status(500).json({ success: false, message: 'Error fetching receivables' });
  }
});

// @route   POST /api/v1/admin/wallets/:userId/collect
// @desc    Attempt to collect the outstanding balance from the customer's
//          saved card right now, rather than waiting for the daily job.
router.post('/:userId/collect', checkPermission('billing.manage'), async (req, res) => {
  try {
    const customer = await userService.findById(req.params.userId);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const account = await teamService.findPersonal(customer.id);
    if (!account) return res.status(404).json({ success: false, message: 'Customer has no account' });
    const wallet = await creditService.getOrCreateWallet(account.id);
    if ((wallet.outstandingBalance || 0) <= 0) {
      return res.status(400).json({ success: false, message: 'This customer has no outstanding balance' });
    }

    let result;
    try {
      result = await debtService.settleFromCard(account.id, wallet.outstandingBalance, {
        description: `Manual collection attempt by ${req.user.name}`,
      });
    } catch (err) {
      return res.status(402).json({
        success: false,
        code: err.code || 'CHARGE_FAILED',
        message: err.message || 'Could not charge the saved card',
      });
    }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'debt_collected',
      actionType: 'update',
      targetModel: 'CreditWallet',
      targetId: result.wallet.id,
      targetName: customer.email,
      description: `Collected ${result.settled} ${result.wallet.currency} of outstanding balance from ${customer.email}`,
      metadata: { settled: result.settled, outstandingAfter: result.wallet.outstandingBalance },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: result.settled > 0
        ? `Collected ${result.wallet.currency} ${result.settled.toFixed(2)}`
        : 'Nothing was collected',
      settled: result.settled,
      wallet: { outstandingBalance: result.wallet.outstandingBalance, currency: result.wallet.currency },
    });
  } catch (error) {
    console.error('Collect debt error:', error);
    res.status(500).json({ success: false, message: 'Error attempting collection' });
  }
});

// @route   POST /api/v1/admin/wallets/:userId/write-off
// @desc    Erase an outstanding balance without collecting it. Requires a
//          reason — the only way debt is ever forgiven on this platform, and
//          only ever as a deliberate, logged admin action.
router.post('/:userId/write-off', checkPermission('billing.manage'), validate(schemas.writeOff), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required to write off a debt' });
    }

    const customer = await userService.findById(req.params.userId);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const account = await teamService.findPersonal(customer.id);
    if (!account) return res.status(404).json({ success: false, message: 'Customer has no account' });
    const result = await debtService.writeOff(account.id, { reason, actor: req.user });
    if (result.written === 0) {
      return res.status(400).json({ success: false, message: 'This customer has no outstanding balance' });
    }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'debt_written_off',
      actionType: 'update',
      targetModel: 'CreditWallet',
      targetId: result.wallet.id,
      targetName: customer.email,
      description: `Wrote off ${result.written} ${result.wallet.currency} owed by ${customer.email}: ${reason.trim()}`,
      metadata: { written: result.written, reason: reason.trim() },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: `Wrote off ${result.wallet.currency} ${result.written.toFixed(2)}`,
      wallet: { outstandingBalance: result.wallet.outstandingBalance, currency: result.wallet.currency },
    });
  } catch (error) {
    console.error('Write off debt error:', error);
    failure(res, error, 'Error writing off debt');
  }
});

// @route   GET /api/v1/admin/wallets
// @desc    All customer wallets, with the platform totals
router.get('/', checkPermission('billing.view'), async (req, res) => {
  try {
    const {
      search, page = 1, limit = 20, sortBy = 'balance', order = 'desc',
    } = req.query;

    const { wallets, total, totals } = await creditService.listWalletsAdmin({
      search, page, limit, sortBy, order,
    });

    res.json({
      success: true,
      wallets,
      summary: {
        // Outstanding balance is a liability — money taken but not yet earned
        outstandingBalance: Math.round((totals.totalBalance || 0) * 100) / 100,
        lifetimeTopUp: Math.round((totals.totalTopUp || 0) * 100) / 100,
        lifetimeSpend: Math.round((totals.totalSpend || 0) * 100) / 100,
      },
      pagination: meta({ page, limit }, total),
    });
  } catch (error) {
    console.error('List wallets error:', error);
    res.status(500).json({ success: false, message: 'Error fetching wallets' });
  }
});

// @route   GET /api/v1/admin/wallets/:userId
// @desc    One customer's wallet, ledger and current burn
router.get('/:userId', checkPermission('billing.view'), async (req, res) => {
  try {
    const customer = await userService.findById(req.params.userId);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // The customer's personal account — see customers.routes.js.
    const account = await teamService.findPersonal(customer.id);
    if (!account) return res.status(404).json({ success: false, message: 'Customer has no account' });

    const [summary, { transactions }, ledgerTotal, activeDeployments] = await Promise.all([
      creditService.getWalletSummary(account.id),
      creditService.listTransactions(account.id, { limit: 100 }),
      creditService.reconcileLedger(account.id),
      deploymentService.countActiveForTeam(account.id),
    ]);

    res.json({
      success: true,
      customer: {
        name: customer.name, email: customer.email, status: customer.status,
      },
      wallet: summary,
      transactions,
      activeDeployments,
      // Surfaces any drift between the cached balance and the ledger
      reconciliation: {
        ledgerTotal,
        walletBalance: summary.balance,
        matches: Math.abs(ledgerTotal - summary.balance) < 0.01,
      },
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({ success: false, message: 'Error fetching wallet' });
  }
});

// @route   POST /api/v1/admin/wallets/:userId/adjust
// @desc    Manual credit or debit. `amount` is signed.
router.post('/:userId/adjust', checkPermission('billing.manage'), validate(schemas.walletAdjust), async (req, res) => {
  try {
    const { amount, description, type } = req.body;
    const value = Number(amount);

    if (!value || !Number.isFinite(value)) {
      return res.status(400).json({ success: false, message: 'Please enter a non-zero amount' });
    }

    /**
     * Bound the magnitude in both directions. Without this, `1e308` reached
     * Prisma and came back as a 500 carrying the raw exception, and a
     * mistyped `-999999` silently put a customer $999,489 in debt — a
     * thousand times the configured pay-as-you-go credit limit.
     */
    const billingSettings = await billingModeService.getBillingSettings();
    const maxAdjustment = Number(billingSettings.maxManualAdjustment) || 10000;
    if (Math.abs(value) > maxAdjustment) {
      return res.status(400).json({
        success: false,
        message: `A single adjustment cannot exceed ${billingSettings.currency} ${maxAdjustment}. `
          + 'Raise the limit in Settings → Billing if this is intended.',
      });
    }

    const customer = await userService.findById(req.params.userId);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const account = await teamService.findPersonal(customer.id);
    if (!account) return res.status(404).json({ success: false, message: 'Customer has no account' });
    const { wallet, transaction } = await creditService.adjust(account.id, value, {
      type: type === 'refund' ? 'refund' : type === 'bonus' ? 'bonus' : 'adjustment',
      description: description || `Manual ${value > 0 ? 'credit' : 'debit'} by ${req.user.name}`,
      createdBy: req.userId,
    });

    // Adding credit should immediately un-suspend anything paused for non-payment
    if (value > 0) {
      await deploymentService.resumeCreditSuspended(account.id);
      await deploymentService.resumeDebtLimitSuspended(account.id);
    }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'credit_adjusted',
      actionType: 'update',
      targetModel: 'CreditWallet',
      targetId: wallet.id,
      targetName: customer.email,
      description: `${value > 0 ? 'Credited' : 'Debited'} ${Math.abs(value)} ${wallet.currency} ${value > 0 ? 'to' : 'from'} ${customer.email}${description ? ` — ${description}` : ''}`,
      metadata: { amount: value, balanceAfter: wallet.balance },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    // Let the customer know their balance changed
    try {
      await notificationService.createNotification({
        recipientId: customer.id,
        recipientType: 'customer',
        type: 'credit_adjusted',
        contentKey: value > 0 ? 'credit.adjustedUp' : 'credit.adjustedDown',
        title: value > 0 ? 'Credit added to your account' : 'Account balance adjusted',
        message: `${value > 0 ? '+' : ''}${value} ${wallet.currency}. New balance: ${wallet.balance} ${wallet.currency}.${description ? ` ${description}` : ''}`,
        // `note` carries the admin's own description verbatim, including the
        // leading space, so the sentence reads the same with or without one.
        metadata: {
          amount: String(value),
          currency: wallet.currency,
          balance: String(wallet.balance),
          note: description ? ` ${description}` : '',
        },
        priority: 'medium',
      });
    } catch (err) {
      console.error('[Wallets] Failed to notify customer:', err.message);
    }

    res.json({
      success: true,
      message: `Balance adjusted to ${wallet.balance} ${wallet.currency}`,
      wallet: { balance: wallet.balance, currency: wallet.currency },
      transaction,
    });
  } catch (error) {
    console.error('Adjust wallet error:', error);
    failure(res, error, 'Error adjusting wallet');
  }
});

module.exports = router;
