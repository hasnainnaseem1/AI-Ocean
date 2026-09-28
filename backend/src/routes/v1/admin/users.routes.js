const express = require('express');
const router = express.Router();
const { isPublicId } = require('../../../utils/helpers/publicId');
const { paginate } = require('../../../utils/helpers/pagination');
const prisma = require('../../../lib/prismaClient');
const userService = require('../../../services/user/userService');
const customRoleService = require('../../../services/user/customRoleService');
const activityLogService = require('../../../services/admin/activityLogService');
const notificationService = require('../../../services/notification/notificationService');
const userDeletionService = require('../../../services/user/userDeletionService');
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const { formatUserResponse } = require('../../../utils/helpers/userFormatter');
const { validatePassword } = require('../../../utils/helpers/securityHelper');
const { byPublicIds } = require('../../../utils/helpers/publicId');

/**
 * Shape a CustomRole for the API.
 *
 * Previously the raw Prisma row went out whole, which exposed internal columns
 * no other endpoint reveals — `createdById`/`updatedById` (Postgres UUIDs) and
 * `id` as a field name rather than mapped to `_id`. Only the fields
 * a client actually needs are returned now, with both id forms provided since
 * existing frontend code reads `._id` off a populated role.
 */
const withIdAlias = (record) => (record ? {

  id: record.id,
  name: record.name,
  description: record.description,
  permissions: record.permissions,
  isActive: record.isActive,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
} : record);

/**
 * Whitelist for `?sortBy=`. Without it an arbitrary query-string value was
 * being used as a column name: `?sortBy=password` really did order by the
 * bcrypt hash, and an unknown column returned a 500. The customers list
 * (userService.listCustomersAdmin) has always done this; these routes had not.
 */
const SORT_FIELDS = ['createdAt', 'name', 'email', 'status', 'lastLogin', 'role', 'accountType'];
const sortField = (requested) => (SORT_FIELDS.includes(requested) ? requested : 'createdAt');

/** Ceiling on a CSV export, which is assembled entirely in memory. */
const EXPORT_MAX_ROWS = 50000;

const buildUserFilter = ({ accountType, role, status, search }) => {
  const where = {};
  if (accountType) where.accountType = accountType;
  if (role) {
    const roles = role.includes(',') ? role.split(',') : [role];
    where.role = { in: roles };
  }
  if (status) {
    const statuses = status.includes(',') ? status.split(',') : [status];
    where.status = { in: statuses };
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
};

// @route   GET /api/admin/users
// @desc    Get all users (customers + admins) with pagination and filters
// @access  Private (Admin with users.view permission)
router.get('/', adminAuth, checkPermission('users.view'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      accountType,
      role,
      status,
      search,
      sortBy = 'createdAt',
      order = 'desc'
    } = req.query;

    const where = buildUserFilter({ accountType, role, status, search });
    const { page: safePage, limit: safeLimit, skip, take } = paginate({ page, limit });

    const [users, total, totalUsers, totalCustomers, totalAdmins, activeUsers, suspendedUsers, pendingVerification] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { customRole: true, assignedBy: true },
        orderBy: { [sortField(sortBy)]: order === 'desc' ? 'desc' : 'asc' },
        take,
        skip,
      }),
      prisma.user.count({ where }),
      prisma.user.count(),
      prisma.user.count({ where: { accountType: 'customer' } }),
      prisma.user.count({ where: { accountType: 'admin' } }),
      prisma.user.count({ where: { status: 'active' } }),
      prisma.user.count({ where: { status: 'suspended' } }),
      prisma.user.count({ where: { status: 'pending_verification' } }),
    ]);

    const wrapped = users.map((u) => {
      const w = userService.wrapUser(u);
      w.assignedBy = userService.sanitizeUserRef(w.assignedBy);
      return w;
    });

    res.json({
      success: true,
      users: wrapped.map(user => formatUserResponse(user)),
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalItems: total,
        itemsPerPage: safeLimit
      },
      stats: {
        totalUsers, totalCustomers, totalAdmins, activeUsers, suspendedUsers, pendingVerification
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

// @route   GET /api/admin/users/export/csv
// @desc    Export users to CSV with filters
// @access  Private (Admin with users.view permission)
router.get('/export/csv', adminAuth, checkPermission('users.view'), async (req, res) => {
  try {
    const {
      accountType,
      role,
      status,
      search,
      sortBy = 'createdAt',
      order = 'desc'
    } = req.query;

    const where = buildUserFilter({ accountType, role, status, search });

    const users = await prisma.user.findMany({
      where,
      include: { customRole: true, assignedBy: true },
      orderBy: { [sortField(sortBy)]: order === 'desc' ? 'desc' : 'asc' },
      // A deliberate export is allowed to be large, but not unbounded — the
      // whole file is built in memory before it is sent.
      take: EXPORT_MAX_ROWS,
    });

    // Build CSV
    const headers = [
      'ID',
      'Name',
      'Email',
      'Account Type',
      'Role',
      'Status',
      'Department',
      'Email Verified',
      'Last Login',
      'Last Login IP',
      'Assigned By',
      'Created At'
    ];

    const csvRows = [headers.join(',')];

    users.forEach(user => {
      const formatDate = (date) => {
        if (!date) return 'Never';
        const d = new Date(date);
        return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      };

      const baseRow = [
        user.id,
        `"${user.name}"`,
        user.email,
        user.accountType,
        user.customRole ? user.customRole.name : user.role,
        user.status,
        user.department || 'N/A',
        user.isEmailVerified ? 'Yes' : 'No',
        formatDate(user.lastLogin),
        user.lastLoginIP || 'N/A',
        user.assignedBy ? `"${user.assignedBy.name}"` : 'N/A',
        formatDate(user.createdAt)
      ];

      csvRows.push(baseRow.join(','));
    });

    const csv = csvRows.join('\n');
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `users-export-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error('Export users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting users'
    });
  }
});

// @route   GET /api/admin/users/:id/login-history
// @desc    Get login history for a specific user
// @access  Private (Admin with logs.view permission OR viewing own profile)
router.get('/:id/login-history', adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const { limit = 20 } = req.query;

    // Allow access if the current user has logs.view permission or is
    // viewing their own profile — req.user already has customRole included
    // (see adminAuth), so this goes through the same getPermissions() logic
    // as everywhere else instead of re-deriving it by hand.
    const isOwnProfile = req.userId.toString() === userId;
    const canViewLogs = req.user.hasPermission('logs.view');

    if (!canViewLogs && !isOwnProfile) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view login history for this user'
      });
    }

    // Reject anything that is not a well-formed id before it reaches the database
    if (!isPublicId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // 404 when the user is gone, rather than an empty list that looks like
    // "this user has simply never logged in".
    const target = await userService.findById(userId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get login activity logs
    const loginHistory = await activityLogService.listLogins(userId, limit);

    res.json({
      success: true,
      loginHistory
    });

  } catch (error) {
    console.error('Get login history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching login history'
    });
  }
});

// @route   GET /api/admin/users/:id
// @desc    Get single user by ID
// @access  Private (Admin with users.view permission)
router.get('/:id', adminAuth, checkPermission('users.view'), async (req, res) => {
  try {
    if (!isPublicId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    const user = await userService.findById(req.params.id, {
      include: { customRole: true, assignedBy: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const permissions = user.getPermissions();

    // Same permission check the ported login-history route uses, via the
    // shared helper instead of a third hand-rolled copy of getPermissions().
    const isOwnProfile = req.userId.toString() === req.params.id;
    const canViewLogs = req.user.hasPermission('logs.view');

    let recentActivity = [];
    if (canViewLogs || isOwnProfile) {
      recentActivity = (await activityLogService.listForUser(user.id, { limit: 10 })).logs;
    }

    // Build user response with conditional activity information
    const userResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      accountType: user.accountType,
      role: user.role,
      customRole: withIdAlias(user.customRole),
      permissions: permissions,
      status: user.status,
      isEmailVerified: user.isEmailVerified
    };

    // A customer's Stripe customer belongs to their account (Team) now, not to
    // the user — see the customer detail route for it.

    if (user.accountType === 'admin') {
      userResponse.department = user.department;
    }

    const canViewActivityInfo = canViewLogs || isOwnProfile;
    if (canViewActivityInfo) {
      userResponse.lastLogin = user.lastLogin;
      userResponse.lastLoginIP = user.lastLoginIP;
      userResponse.loginAttempts = user.loginAttempts;
      userResponse.lockUntil = user.lockUntil;
      userResponse.assignedBy = userService.sanitizeUserRef(user.assignedBy);
      userResponse.createdAt = user.createdAt;
      userResponse.updatedAt = user.updatedAt;
    }

    res.json({
      success: true,
      user: userResponse,
      recentActivity
    });

  } catch (error) {
    console.error('Get user error:', error);
    console.error('User ID:', req.params.id);
    console.error('Error details:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/admin/users/:id/activity/export
// @desc    Export user activity logs to CSV with date range filter
// @access  Private (Admin with users.view permission)
router.get('/:id/activity/export', adminAuth, checkPermission('users.view'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.params.id;

    if (!isPublicId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Look the user up first and 404 if they're gone — the customers'
    // equivalent route already does this, while here an absent id fell
    // through to the log query and came back as a 500.
    const user = await userService.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const activities = await activityLogService.listForExport({ userId, startDate, endDate });

    const headers = [
      'Date & Time',
      'Action',
      'Description',
      'Status',
      'IP Address'
    ];

    const csvRows = [headers.join(',')];

    const formatDate = (date) => {
      if (!date) return 'N/A';
      const d = new Date(date);
      return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    };

    activities.forEach(activity => {
      const row = [
        formatDate(activity.createdAt),
        `"${activity.action}"`,
        `"${activity.description || 'N/A'}"`,
        activity.status || 'N/A',
        activity.ipAddress || 'N/A'
      ];
      csvRows.push(row.join(','));
    });

    const csv = csvRows.join('\n');
    const timestamp = new Date().toISOString().split('T')[0];
    const username = user ? user.name.replace(/\s+/g, '-').toLowerCase() : 'user';
    const filename = `activity-${username}-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error('Export activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting activity logs'
    });
  }
});

// @route   POST /api/admin/users
// @desc    Create new admin user
// @access  Private (Super Admin or Admin with users.create permission)
router.post('/', adminAuth, checkPermission('users.create'), async (req, res) => {
  try {
    const { name, email, password, role, customRoleId, department } = req.body;
    const clientIP = getClientIP(req);

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    const pwdCheck = await validatePassword(password);
    if (!pwdCheck.valid) {
      return res.status(400).json({
        success: false,
        message: pwdCheck.message
      });
    }

    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can create another super admin'
      });
    }

    const existingUser = await userService.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    /**
     * A custom role REQUIRES a role id.
     *
     * This used to read `if (role === 'custom' && customRoleId)`, so the whole
     * check short-circuited away exactly when the field was missing — the
     * account was created with `customRoleId: null`, could log in, and was
     * then 403'd on every single page with nothing anywhere explaining why.
     */
    if (role === 'custom') {
      if (!customRoleId) {
        return res.status(400).json({
          success: false,
          message: 'Please choose a custom role for this user'
        });
      }
      const customRole = await customRoleService.findByIdentifier(customRoleId);
      if (!customRole) {
        return res.status(400).json({
          success: false,
          message: 'Custom role not found'
        });
      }
    }

    const user = await userService.createUser({
      name,
      email,
      password,
      accountType: 'admin',
      role: role || 'viewer',
      customRoleId: customRoleId || null,
      department,
      status: 'active',
      isEmailVerified: true, // Admins don't need email verification
      assignedById: req.user.id,
      // Non-super-admin users must change password on first login
      passwordChangeRequired: role !== 'super_admin'
    });

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'user_created',
      actionType: 'create',
      targetModel: 'User',
      targetId: user.id,
      targetName: user.name,
      description: `Created new admin user: ${user.email}`,
      metadata: { userRole: user.role, department: user.department },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    // Create notification for new admin
    await notificationService.createNotification({
      recipientId: user.id,
      recipientType: 'admin',
      type: 'welcome',
      contentKey: 'admin.welcome',
      title: 'Welcome to Admin Panel',
      message: `Your admin account has been created by ${req.user.name}. Your role is: ${user.role}`,
      metadata: { adminName: req.user.name, role: user.role },
      priority: 'high'
    });

    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user'
    });
  }
});

// @route   PUT /api/admin/users/:id
// @desc    Update user
// @access  Private (Admin with users.edit permission)
router.put('/:id', adminAuth, checkPermission('users.edit'), async (req, res) => {
  try {
    const { name, role, customRoleId, department, status, avatar } = req.body;
    const clientIP = getClientIP(req);

    const existing = await userService.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (existing.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can edit another super admin'
      });
    }

    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can assign super admin role'
      });
    }

    const changes = {};

    if (role === 'custom' && customRoleId) {
      const customRole = await customRoleService.findByIdentifier(customRoleId);
      if (!customRole) {
        return res.status(400).json({
          success: false,
          message: 'Custom role not found'
        });
      }
      changes.customRoleId = customRoleId;
    }

    if (name) changes.name = name;
    if (role) changes.role = role;
    if (department !== undefined) changes.department = department;
    if (status) changes.status = status;
    if (avatar !== undefined) changes.avatar = avatar || null;

    const user = await userService.updateUser(existing, changes);

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'user_updated',
      actionType: 'update',
      targetModel: 'User',
      targetId: user.id,
      targetName: user.name,
      description: `Updated user: ${user.email}`,
      metadata: req.body,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    // Notify user of changes
    await notificationService.createNotification({
      recipientId: user.id,
      type: 'admin_message',
      contentKey: 'account.updatedByAdmin',
      title: 'Account Updated',
      message: `Your account has been updated by ${req.user.name}`,
      metadata: { adminName: req.user.name },
      priority: 'medium'
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user'
    });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete user
// @access  Private (Super Admin or Admin with users.delete permission)
router.delete('/:id', adminAuth, checkPermission('users.delete'), async (req, res) => {
  try {
    const clientIP = getClientIP(req);

    const user = await userService.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can delete another super admin'
      });
    }

    if (user.id.toString() === req.userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    const userName = user.name;
    const userEmail = user.email;

    // An admin accumulates Restrict-guarded references from the moment they
    // exist (the welcome notification alone is enough), so the same cascade
    // the customer routes use has to run here too.
    await userDeletionService.deleteUsersCompletely([user]);

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'user_deleted',
      actionType: 'delete',
      targetModel: 'User',
      targetId: req.params.id,
      targetName: userName,
      description: `Deleted user: ${userEmail}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user'
    });
  }
});

// @route   POST /api/admin/users/:id/suspend
// @desc    Suspend user
// @access  Private (Admin with users.suspend permission)
router.post('/:id/suspend', adminAuth, checkPermission('users.suspend'), async (req, res) => {
  try {
    const { reason } = req.body;
    const clientIP = getClientIP(req);

    const existing = await userService.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (existing.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot suspend super admin'
      });
    }

    const user = await userService.updateUser(existing, { status: 'suspended' });

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'user_suspended',
      actionType: 'update',
      targetModel: 'User',
      targetId: user.id,
      targetName: user.name,
      description: `Suspended user: ${user.email}${reason ? ` - Reason: ${reason}` : ''}`,
      metadata: { reason },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    // Notify user
    await notificationService.createNotification({
      recipientId: user.id,
      type: 'account_suspended',
      // With a reason the message is the admin's own words and stays as
      // written; without one it is our sentence and can be translated.
      contentKey: reason ? 'account.suspendedWithReason' : 'account.suspended',
      title: 'Account Suspended',
      message: reason || 'Your account has been suspended. Please contact support for more information.',
      metadata: { reason: reason || null },
      priority: 'urgent'
    });

    res.json({
      success: true,
      message: 'User suspended successfully'
    });

  } catch (error) {
    console.error('Suspend user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error suspending user'
    });
  }
});

// @route   POST /api/admin/users/:id/activate
// @desc    Activate user
// @access  Private (Admin with users.activate permission)
router.post('/:id/activate', adminAuth, checkPermission('users.activate'), async (req, res) => {
  try {
    const clientIP = getClientIP(req);

    const existing = await userService.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = await userService.updateUser(existing, { status: 'active' });

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'user_activated',
      actionType: 'update',
      targetModel: 'User',
      targetId: user.id,
      targetName: user.name,
      description: `Activated user: ${user.email}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    // Notify user
    await notificationService.createNotification({
      recipientId: user.id,
      type: 'account_activated',
      contentKey: 'account.activated',
      title: 'Account Activated',
      message: 'Your account has been activated. You can now access all features.',
      priority: 'high'
    });

    res.json({
      success: true,
      message: 'User activated successfully'
    });

  } catch (error) {
    console.error('Activate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error activating user'
    });
  }
});

// @route   POST /api/admin/users/bulk-delete
// @desc    Delete multiple admin users at once
// @access  Private (Admin with users.delete permission)
router.post('/bulk-delete', adminAuth, checkPermission('users.delete'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide user IDs to delete' });
    }

    const clientIP = getClientIP(req);

    // ids are the public ids the frontend has always used
    const users = (await prisma.user.findMany({ where: byPublicIds(ids) })).map(u => userService.wrapUser(u));
    const toDelete = users.filter(u => {
      if (u.id.toString() === req.userId.toString()) return false; // no self-delete
      if (u.role === 'super_admin' && req.user.role !== 'super_admin') return false;
      return true;
    });

    if (toDelete.length === 0) {
      return res.status(400).json({ success: false, message: 'No eligible users to delete' });
    }

    await userDeletionService.deleteUsersCompletely(toDelete);

    await activityLogService.logActivity({
      userId: req.userId, userName: req.user.name, userEmail: req.user.email, userRole: req.user.role,
      action: 'users_bulk_deleted', actionType: 'delete', targetModel: 'User',
      description: `Bulk deleted ${toDelete.length} users`,
      metadata: { deletedCount: toDelete.length, emails: toDelete.map(u => u.email) },
      ipAddress: clientIP, userAgent: req.get('user-agent'), status: 'success',
    });

    res.json({ success: true, message: `${toDelete.length} user(s) deleted successfully`, deletedCount: toDelete.length });
  } catch (error) {
    console.error('Bulk delete users error:', error);
    res.status(500).json({ success: false, message: 'Error deleting users' });
  }
});

module.exports = router;
