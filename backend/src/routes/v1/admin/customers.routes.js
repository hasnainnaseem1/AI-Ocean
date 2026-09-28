const express = require('express');
const { paginate } = require('../../../utils/helpers/pagination');
const router = express.Router();
const prisma = require('../../../lib/prismaClient');
const userService = require('../../../services/user/userService');
const activityLogService = require('../../../services/admin/activityLogService');
const notificationService = require('../../../services/notification/notificationService');
const deploymentService = require('../../../services/deployment/deploymentService');
const creditService = require('../../../services/billing/creditService');
const paymentMethodService = require('../../../services/billing/paymentMethodService');
const paymentService = require('../../../services/billing/paymentService');
const fundingService = require('../../../services/billing/fundingService');
const billingModeService = require('../../../services/billing/billingModeService');
const teamService = require('../../../services/team/teamService');
const customerNoteService = require('../../../services/admin/customerNoteService');
const userDeletionService = require('../../../services/user/userDeletionService');
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission, checkRole } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const { notifyCustomerStatusChange } = require('../../../services/notification/adminNotifier');
const { byPublicIds } = require('../../../utils/helpers/publicId');

// @route   GET /api/admin/customers
// @desc    Get all customers with detailed info
// @access  Private (Admin with customers.view permission)
router.get('/', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = 'createdAt',
      order = 'desc',
      isEmailVerified
    } = req.query;
    const { page: safePage, limit: safeLimit } = paginate({ page, limit });

    const { customers, total, stats } = await userService.listCustomersAdmin({
      status, search, isEmailVerified, sortBy, order, page, limit,
    });

    res.json({
      success: true,
      customers: customers.map(customer => ({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        status: customer.status,
        isEmailVerified: customer.isEmailVerified,
        lastLogin: customer.lastLogin,
        createdAt: customer.createdAt
      })),
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalItems: total,
        itemsPerPage: safeLimit
      },
      stats
    });

  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customers'
    });
  }
});

// @route   GET /api/admin/customers/export/csv
// @desc    Export customers to CSV
// @access  Private (Admin with customers.view permission)
router.get('/export/csv', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const {
      status,
      search,
      isEmailVerified
    } = req.query;

    const customers = await userService.listCustomersForExport({ status, search, isEmailVerified });

    // Build CSV
    const headers = [
      'Name', 'Email', 'Status',
      'Email Verified', 'Last Login', 'Created At'
    ];

    const rows = customers.map((customer) => [
      customer.name || '',
      customer.email || '',
      customer.status || '',
      customer.isEmailVerified ? 'Yes' : 'No',
      customer.lastLogin ? new Date(customer.lastLogin).toISOString() : '',
      customer.createdAt ? new Date(customer.createdAt).toISOString() : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))
    ].join('\n');

    const fileName = `customers-export-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csvContent);

  } catch (error) {
    console.error('Export customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting customers'
    });
  }
});
// @route   GET /api/admin/customers/:id/activity
// @desc    Get customer activity logs with pagination and date filtering
// @access  Private (Admin with customers.view permission)
router.get('/:id/activity', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const { page = 1, limit = 50, startDate, endDate } = req.query;
    const { page: safePage, limit: safeLimit } = paginate({ page, limit });

    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const { logs: activityLogs, total } = await activityLogService.list(
      { userId: customer.id, startDate, endDate },
      { page, limit }
    );

    res.json({
      success: true,
      activityLogs,
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalItems: total,
        itemsPerPage: safeLimit
      }
    });
  } catch (error) {
    console.error('Get customer activity error:', error);
    res.status(500).json({ success: false, message: 'Error fetching customer activity' });
  }
});

// @route   GET /api/admin/customers/:id/login-history
// @desc    Get customer login history
// @access  Private (Admin with customers.view permission)
router.get('/:id/login-history', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Get login-related activity logs
    const loginHistory = await activityLogService.listLoginHistory(customer.id, { limit });

    res.json({
      success: true,
      loginHistory,
      customerName: customer.name,
      customerEmail: customer.email
    });
  } catch (error) {
    console.error('Get customer login history error:', error);
    res.status(500).json({ success: false, message: 'Error fetching login history' });
  }
});

// @route   GET /api/admin/customers/:id/activity/export
// @desc    Export customer activity logs to CSV
// @access  Private (Admin with customers.view permission)
router.get('/:id/activity/export', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const activityLogs = await activityLogService.listForExport({ userId: customer.id, startDate, endDate });

    // Generate CSV
    const headers = ['Action', 'Description', 'IP Address', 'User Agent', 'Status', 'Created At'];
    const csvRows = [headers.join(',')];

    activityLogs.forEach((log) => {
      const row = [
        log.action || '',
        `"${(log.description || '').replace(/"/g, '""')}"`,
        log.ipAddress || '',
        `"${(log.userAgent || '').replace(/"/g, '""')}"`,
        log.status || '',
        new Date(log.createdAt).toISOString()
      ];
      csvRows.push(row.join(','));
    });

    const csv = csvRows.join('\n');
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `customer_${ customer.name.replace(/\s+/g, '_')}_activity_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('Export customer activity error:', error);
    res.status(500).json({ success: false, message: 'Error exporting customer activity' });
  }
});

// @route   GET /api/admin/customers/:id/payments
// @desc    Get payment history & billing stats for a specific customer
// @access  Private (Admin with customers.view permission)
router.get('/:id/payments', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const { page: safePage, limit: safeLimit } = paginate({ page, limit });

    // Verify customer exists
    const customer = await userService.findById(id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const validStatus = ['succeeded', 'pending', 'failed', 'refunded', 'cancelled'].includes(status) ? status : undefined;

    // The customer's personal account. (Team accounts get their own admin
    // pages; this customer page shows what is theirs individually.)
    const account = await teamService.findPersonal(customer.id);

    // Monthly spending trend (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const [{ payments, total: totalCount }, stats, monthlyTrend] = await Promise.all([
      paymentService.listForTeamAdmin(account?.id, { page, limit, status: validStatus }),
      paymentService.getBillingStats(account?.id),
      paymentService.getMonthlyTrend(account?.id, twelveMonthsAgo),
    ]);

    res.json({
      success: true,
      payments: payments.map((p) => ({
        id: p.id,
        amount: parseFloat(p.amount.toFixed(2)),
        currency: p.currency,
        status: p.status,
        description: p.description,
        receiptUrl: p.receiptUrl,
        invoiceUrl: p.invoiceUrl,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
      pagination: {
        page: safePage,
        limit: safeLimit,
        totalCount,
        totalPages: Math.ceil(totalCount / safeLimit),
      },
      stats: {
        totalSpent: parseFloat((stats?.totalSpent || 0).toFixed(2)),
        totalPayments: stats?.totalPayments || 0,
        totalRefunded: parseFloat((stats?.totalRefunded || 0).toFixed(2)),
        refundCount: stats?.refundCount || 0,
        failedPayments: stats?.failedPayments || 0,
        pendingPayments: stats?.pendingPayments || 0,
        lastPaymentDate: stats?.lastPaymentDate || null,
        firstPaymentDate: stats?.firstPaymentDate || null,
        avgPaymentAmount: parseFloat((stats?.avgPaymentAmount || 0).toFixed(2)),
        netRevenue: parseFloat(((stats?.totalSpent || 0) - (stats?.totalRefunded || 0)).toFixed(2)),
      },
      monthlyTrend,
    });
  } catch (error) {
    console.error('Get customer payments error:', error);
    res.status(500).json({ success: false, message: 'Error fetching customer payments' });
  }
});

// @route   GET /api/admin/customers/:id
// @desc    Get single customer with detailed analytics
// @access  Private (Admin with customers.view permission)
router.get('/:id', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get customer's recent deployments and wallet — their personal account.
    const account = await teamService.findPersonal(customer.id);
    const [{ deployments: recentDeployments, total: totalDeployments }, wallet] = await Promise.all([
      deploymentService.listForTeam(account?.id, { page: 1, limit: 10 }),
      creditService.findWallet(account?.id),
    ]);
    const deployments = recentDeployments;

    // Get current user's permissions to check if they can view logs
    const currentUser = await userService.findById(req.userId);
    let currentUserPermissions = [];
    if (currentUser.role === 'super_admin') {
      currentUserPermissions = ['*'];
    } else if (currentUser.role === 'custom' && currentUser.customRole) {
      currentUserPermissions = currentUser.customRole.permissions || [];
    } else {
      const builtInPerms = {
        admin: [
          'users.view', 'users.create', 'users.edit', 'users.delete',
          'customers.view', 'customers.edit',
          'analytics.view', 'logs.view', 'settings.edit'
        ],
        moderator: [
          'users.view', 'customers.view', 'customers.edit',
          'analytics.view'
        ],
        viewer: [
          'users.view', 'customers.view', 'analytics.view'
        ]
      };
      currentUserPermissions = builtInPerms[currentUser.role] || [];
    }

    // Get customer's activity logs - only if user has logs.view permission
    let recentActivity = [];
    const canViewLogs = currentUserPermissions.includes('*') || currentUserPermissions.includes('logs.view');
    if (canViewLogs) {
      recentActivity = (await activityLogService.listForUser(customer.id, { limit: 10 })).logs;
    }

    const billingSettings = await billingModeService.getBillingSettings();

    // Build customer response with conditional activity information
    const customerResponse = {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      timezone: customer.timezone,
      avatar: customer.avatar,
      status: customer.status,
      stripeCustomerId: account?.stripeCustomerId || null,
      isEmailVerified: customer.isEmailVerified,
      disputeHold: account?.disputeHold || false,
      // This customer's own PAYG setting plus what it resolves to right now,
      // so the admin sees the result ("uses PAYG: yes, because the platform
      // switch is on") and not just the override.
      paygAccess: account?.paygAccess || 'default',
      paygEffective: fundingService.resolvePaygAccess(account, billingSettings),
      paygPlatformEnabled: !!billingSettings.payg?.enabled,
      // Always include these for UI display
      lastLogin: customer.lastLogin,
      lastLoginIP: customer.lastLoginIP,
      loginAttempts: customer.loginAttempts,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };

    res.json({
      success: true,
      customer: customerResponse,
      analytics: {
        totalDeployments,
        recentDeployments: deployments,
        wallet: wallet
          ? { balance: wallet.balance, currency: wallet.currency, lifetimeTopUp: wallet.lifetimeTopUp, lifetimeSpend: wallet.lifetimeSpend }
          : null
      },
      recentActivity
    });

  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customer'
    });
  }
});

// @route   PUT /api/admin/customers/:id/payg-access
// @desc    Allow or block pay-as-you-go for one customer, or return them to
//          the platform default. Only the door — every PAYG rule still applies
//          (see fundingService.resolvePaygAccess).
// @access  Private (Admin with billing.manage permission)
// @route   GET /api/v1/admin/customers/:id/teams
// @desc    The organizations this person belongs to, and their role in each —
//          so an operator looking at a customer can see the other accounts
//          their work is billed to.
router.get('/:id/teams', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const all = await teamService.listForUser(customer.id);
    res.json({ success: true, teams: all.filter((t) => t.kind === 'team') });
  } catch (error) {
    console.error('Customer teams error:', error);
    res.status(500).json({ success: false, message: 'Could not load the organizations this customer belongs to' });
  }
});

router.put('/:id/payg-access', adminAuth, checkPermission('billing.manage'), async (req, res) => {
  try {
    const { access, reason } = req.body || {};
    if (!fundingService.PAYG_ACCESS_VALUES.includes(access)) {
      return res.status(400).json({
        success: false,
        message: `access must be one of: ${fundingService.PAYG_ACCESS_VALUES.join(', ')}`,
      });
    }

    const existing = await userService.findById(req.params.id);
    if (!existing || existing.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // PAYG access belongs to the account; from the customer page that is
    // their personal account.
    const account = await teamService.findPersonal(existing.id);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Customer has no account' });
    }
    const customer = existing;
    const settings = await billingModeService.getBillingSettings();
    const oldAccess = account.paygAccess || 'default';
    const updated = oldAccess === access ? account : await teamService.update(account, { paygAccess: access });
    const effective = fundingService.resolvePaygAccess(updated, settings);

    /*
     * If this leaves them without PAYG, move what they already have on it to
     * prepaid now — otherwise it keeps running up debt until the next hourly
     * run. Always run when access is off, even if the setting did not change,
     * so saving again heals a previous attempt that failed part-way.
     */
    let enforcement = null;
    if (!effective.available) {
      enforcement = await fundingService.enforcePaygAccessNow({
        teamId: account.id, settings, actor: req.user,
      });
    }

    const note = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'customer_payg_access_changed',
      actionType: 'update',
      targetModel: 'User',
      targetId: customer.id,
      targetName: customer.name,
      description: `Pay-as-you-go access for ${customer.email}: ${oldAccess} → ${access}`
        + ` (now ${effective.available ? 'available' : 'unavailable'})`
        + (enforcement?.switched ? `; ${enforcement.switched} deployment(s) moved to prepaid` : '')
        + (note ? ` - Reason: ${note}` : ''),
      metadata: { oldAccess, newAccess: access, effective, enforcement, reason: note || null },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      paygAccess: access,
      paygEffective: effective,
      enforcement,
    });
  } catch (error) {
    console.error('Update PAYG access error:', error);
    res.status(500).json({ success: false, message: 'Error updating pay-as-you-go access' });
  }
});

// @route   POST /api/admin/customers/:id/verify-email
// @desc    Manually verify customer's email
// @access  Private (Admin with customers.verify permission)
router.post('/:id/verify-email', adminAuth, checkPermission('customers.verify'), async (req, res) => {
  try {
    const clientIP = getClientIP(req);

    const existing = await userService.findById(req.params.id);

    if (!existing || existing.accountType !== 'customer') {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    if (existing.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Keep the verification token so the email link still works
    // (it will return "already verified" instead of "invalid")
    const customer = await userService.updateUser(existing, { isEmailVerified: true, status: 'active' });

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'customer_verified',
      actionType: 'update',
      targetModel: 'User',
      targetId: customer.id,
      targetName: customer.name,
      description: `Manually verified email for customer: ${customer.email}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    // Notify customer
    await notificationService.createNotification({
      recipientId: customer.id,
      type: 'email_verification',
      contentKey: 'account.emailVerified',
      title: 'Email Verified',
      message: 'Your email has been verified by admin. You can now access all features.',
      priority: 'high'
    });

    res.json({
      success: true,
      message: 'Customer email verified successfully'
    });

  } catch (error) {
    console.error('Verify customer email error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying customer email'
    });
  }
});

// @route   GET /api/admin/customers/:id/deployments
// @desc    Get all deployments for a specific customer
// @access  Private (Admin with customers.view permission)
router.get('/:id/deployments', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const { page: safePage, limit: safeLimit } = paginate({ page, limit });

    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const account = await teamService.findPersonal(customer.id);
    const { deployments, total } = await deploymentService.listForTeam(account?.id, { page, limit });

    res.json({
      success: true,
      deployments: deployments.map(d => ({
        id: d.id,
        deploymentName: d.deploymentName,
        modelName: d.model?.name,
        tierName: d.tier?.name,
        status: d.status,
        pricePerHour: d.pricePerHour,
        totalCost: d.totalCost,
        totalRuntimeHours: d.totalRuntimeHours,
        createdAt: d.createdAt
      })),
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalItems: total,
        itemsPerPage: safeLimit
      }
    });

  } catch (error) {
    console.error('Get customer deployments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customer deployments'
    });
  }
});

// @route   GET /api/admin/customers/:id/payment-methods
// @desc    Get a customer's saved cards (same shape the customer sees for their own)
// @access  Private (Admin with customers.view permission)
router.get('/:id/payment-methods', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const customer = await userService.findById(req.params.id);

    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const account = await teamService.findPersonal(customer.id);
    const cards = await paymentMethodService.list(account?.id);

    res.json({
      success: true,
      paymentMethods: cards.map(paymentMethodService.serialize)
    });
  } catch (error) {
    console.error('Get customer payment methods error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment methods'
    });
  }
});

// @route   GET /api/admin/customers/:id/notifications
// @desc    Every notification this customer has been sent
// @access  Private (Admin with customers.view permission)
router.get('/:id/notifications', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    const { page = 1, limit = 15 } = req.query;
    const { page: safePage, limit: safeLimit } = paginate({ page, limit });

    const customer = await userService.findById(req.params.id);

    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const { notifications, total } = await notificationService.listForRecipientWithFilter(customer.id, { page, limit });

    res.json({
      success: true,
      notifications,
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalItems: total,
        itemsPerPage: safeLimit
      }
    });
  } catch (error) {
    console.error('Get customer notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications'
    });
  }
});

// @route   GET /api/admin/customers/:id/notes
// @desc    Internal admin notes on this customer — never shown to the customer
// @access  Private (Admin with customers.view permission)
router.get('/:id/notes', adminAuth, checkPermission('customers.view'), async (req, res) => {
  try {
    // 404 when the customer doesn't exist, rather than an empty list that a
    // client can't tell apart from "this customer simply has no notes".
    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const notes = await customerNoteService.listForCustomer(req.params.id);

    res.json({ success: true, notes });
  } catch (error) {
    console.error('Get customer notes error:', error);
    res.status(500).json({ success: false, message: 'Error fetching notes' });
  }
});

// @route   POST /api/admin/customers/:id/notes
// @desc    Leave an internal note on this customer's account
// @access  Private (Admin with customers.edit permission)
router.post('/:id/notes', adminAuth, checkPermission('customers.edit'), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Note text is required' });
    }

    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const note = await customerNoteService.create({
      customerId: customer.id,
      authorId: req.userId,
      authorName: req.user.name,
      text: text.trim(),
    });

    res.json({ success: true, note });
  } catch (error) {
    console.error('Create customer note error:', error);
    res.status(500).json({ success: false, message: 'Error saving note' });
  }
});

// @route   DELETE /api/admin/customers/:id/notes/:noteId
// @access  Private (Admin with customers.edit permission)
router.delete('/:id/notes/:noteId', adminAuth, checkPermission('customers.edit'), async (req, res) => {
  try {
    const note = await customerNoteService.deleteOne(req.params.noteId, req.params.id);

    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    res.json({ success: true, message: 'Note deleted' });
  } catch (error) {
    console.error('Delete customer note error:', error);
    res.status(500).json({ success: false, message: 'Error deleting note' });
  }
});

// @route   PUT /api/admin/customers/:id/status
// @desc    Update customer status (activate/suspend)
// @access  Private (Admin with customers.edit permission)
router.put('/:id/status', adminAuth, checkPermission('customers.edit'), async (req, res) => {
  try {
    const { status, reason } = req.body;
    const clientIP = getClientIP(req);

    if (!status || !['active', 'suspended', 'pending_verification'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Valid values: active, suspended, pending_verification'
      });
    }

    const existing = await userService.findById(req.params.id);

    if (!existing || existing.accountType !== 'customer') {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const oldStatus = existing.status;
    if (oldStatus === status) {
      return res.status(400).json({
        success: false,
        message: `Customer is already ${status}`
      });
    }

    const customer = await userService.updateUser(existing, { status });

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'customer_status_changed',
      actionType: 'update',
      targetModel: 'User',
      targetId: customer.id,
      targetName: customer.name,
      description: `Changed customer status from ${oldStatus} to ${status}${reason ? ` - Reason: ${reason}` : ''}`,
      metadata: { oldStatus, newStatus: status, reason },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    // Notify customer
    let notificationMessage = '';
    if (status === 'suspended') {
      notificationMessage = 'Your account has been suspended. Please contact support for assistance.';
    } else if (status === 'active') {
      notificationMessage = 'Your account has been activated. You can now access all features.';
    }

    if (notificationMessage) {
      await notificationService.createNotification({
        recipientId: customer.id,
        type: status === 'suspended' ? 'account_suspended' : 'account_activated',
        contentKey: status === 'suspended' ? 'account.statusSuspended' : 'account.statusActivated',
        title: 'Account Status Updated',
        message: notificationMessage,
        action: { label: 'View Dashboard', url: '/dashboard' },
        priority: 'high',
      });
    }

    // Notify all admins about customer status change
    notifyCustomerStatusChange({
      customer,
      oldStatus,
      newStatus: status,
      changedBy: req.user.name,
      reason,
    }).catch(() => {});

    res.json({
      success: true,
      message: `Customer status changed to ${status} successfully`,
      customer: {
        id: customer.id,
        status: customer.status,
        name: customer.name,
        email: customer.email,
      },
    });
  } catch (error) {
    console.error('Update customer status error:', error);
    res.status(500).json({ success: false, message: 'Error updating customer status' });
  }
});

// @route   DELETE /api/admin/customers/:id
// @desc    Delete a customer permanently
// @access  Private (Super Admin ONLY — no role/permission override)
router.delete('/:id', adminAuth, checkRole('super_admin'), async (req, res) => {
  try {
    // Hard super_admin check — not permission-based
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can delete customers' });
    }

    const customer = await userService.findById(req.params.id);
    if (!customer || customer.accountType !== 'customer') {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const custName = customer.name;
    const custEmail = customer.email;

    // Clears every Restrict-guarded reference first, then the user row itself.
    await userDeletionService.deleteUsersCompletely([customer]);

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'customer_deleted',
      actionType: 'delete',
      targetModel: 'User',
      targetId: req.params.id,
      targetName: custName,
      description: `Permanently deleted customer: ${custEmail}`,
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    // A refusal with a reason (the customer has records in a team account)
    // goes back to the admin as-is; anything else is a server fault.
    if (error.status === 409) {
      return res.status(409).json({ success: false, code: error.code, message: error.message });
    }
    console.error('Delete customer error:', error);
    res.status(500).json({ success: false, message: 'Error deleting customer' });
  }
});

// @route   POST /api/admin/customers/bulk-delete
// @desc    Delete multiple customers permanently
// @access  Private (Super Admin ONLY)
router.post('/bulk-delete', adminAuth, checkRole('super_admin'), async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can delete customers' });
    }

    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide customer IDs to delete' });
    }

    const prismaCustomers = await prisma.user.findMany({ where: { ...byPublicIds(ids), accountType: 'customer' } });
    const customers = prismaCustomers.map(u => userService.wrapUser(u));
    if (customers.length === 0) {
      return res.status(404).json({ success: false, message: 'No customers found with provided IDs' });
    }

    await userDeletionService.deleteUsersCompletely(customers);

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'customers_bulk_deleted',
      actionType: 'delete',
      targetModel: 'User',
      description: `Bulk deleted ${customers.length} customers`,
      metadata: { deletedCount: customers.length, emails: customers.map(c => c.email) },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({ success: true, message: `${customers.length} customer(s) deleted successfully`, deletedCount: customers.length });
  } catch (error) {
    // A refusal with a reason (the customer has records in a team account)
    // goes back to the admin as-is; anything else is a server fault.
    if (error.status === 409) {
      return res.status(409).json({ success: false, code: error.code, message: error.message });
    }
    console.error('Bulk delete customers error:', error);
    res.status(500).json({ success: false, message: 'Error deleting customers' });
  }
});

module.exports = router;
