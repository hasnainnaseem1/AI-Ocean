const express = require('express');
const customRoleService = require('../../../services/user/customRoleService');
const router = express.Router();
const prisma = require('../../../lib/prismaClient');
const userService = require('../../../services/user/userService');
const { AVAILABLE_PERMISSIONS } = require('../../../services/user/customRolePermissions');
const activityLogService = require('../../../services/admin/activityLogService');

const { adminAuth } = require('../../../middleware/auth');
const { checkPermission, checkFeatureEnabled } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

// CustomRole now mints a id like every other entity, so it is
// addressable by the app's public `_id` as well as by its Postgres UUID —
// see services/user/customRoleService.js for why that mattered.
// `createdBy`/`updatedBy` are Users though, and must never leak a password
// id convention everywhere else in the app — and must never leak a password
// hash just because they were fetched as someone else's relation.
const withUserIdAlias = (u) => userService.sanitizeUserRef(u);

// @route   GET /api/admin/roles
// @desc    Get all custom roles
// @access  Private (Admin with roles.view permission)
router.get('/', adminAuth, checkPermission('roles.view'), checkFeatureEnabled('enableCustomRoles'), async (req, res) => {
  try {
    const roles = await prisma.customRole.findMany({
      include: { createdBy: true, updatedBy: true },
      orderBy: { createdAt: 'desc' },
    });

    // Get built-in roles info
    const builtInRoles = [
      {
        name: 'super_admin',
        description: 'Full system access with all permissions',
        permissions: ['*'],
        isBuiltIn: true,
        isActive: true
      },
      {
        name: 'admin',
        description: 'Administrative access (cannot manage roles)',
        permissions: [
          'users.view', 'users.create', 'users.edit', 'users.delete',
          'customers.view', 'customers.edit', 'customers.suspend',
          'analytics.view', 'logs.view',
          'settings.view', 'settings.edit'
        ],
        isBuiltIn: true,
        isActive: true
      },
      {
        name: 'moderator',
        description: 'Can manage customers and view analytics',
        permissions: [
          'users.view', 'customers.view', 'customers.edit',
          'analytics.view'
        ],
        isBuiltIn: true,
        isActive: true
      },
      {
        name: 'viewer',
        description: 'Read-only access to users, customers, and analytics',
        permissions: [
          'users.view', 'customers.view', 'analytics.view'
        ],
        isBuiltIn: true,
        isActive: true
      }
    ];

    res.json({
      success: true,
      builtInRoles,
      customRoles: roles.map(role => ({

        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isActive: role.isActive,
        createdBy: withUserIdAlias(role.createdBy),
        updatedBy: withUserIdAlias(role.updatedBy),
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      })),
      availablePermissions: AVAILABLE_PERMISSIONS
    });

  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching roles'
    });
  }
});

// @route   GET /api/admin/roles/:id
// @desc    Get single custom role
// @access  Private (Admin with roles.view permission)
router.get('/:id', adminAuth, checkPermission('roles.view'), checkFeatureEnabled('enableCustomRoles'), async (req, res) => {
  try {
    const role = await customRoleService.findByIdentifier(req.params.id, {
      include: { createdBy: true, updatedBy: true },
    });

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    const usersWithRole = await prisma.user.findMany({
      where: { customRoleId: role.id },
      select: { id: true, name: true, email: true, accountType: true, status: true },
      take: 10,
    });

    const totalUsersWithRole = await prisma.user.count({ where: { customRoleId: role.id } });

    res.json({
      success: true,
      role: {

        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isActive: role.isActive,
        createdBy: withUserIdAlias(role.createdBy),
        updatedBy: withUserIdAlias(role.updatedBy),
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      },
      usersWithRole: usersWithRole.map(u => ({ ...u, id: u.id, })),
      totalUsersWithRole
    });

  } catch (error) {
    console.error('Get role error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching role'
    });
  }
});

// @route   POST /api/admin/roles
// @desc    Create custom role
// @access  Private (Super Admin or Admin with roles.create permission)
router.post('/', adminAuth, checkPermission('roles.create'), checkFeatureEnabled('enableCustomRoles'), async (req, res) => {
  try {
    const { name, description, permissions } = req.body;
    const clientIP = getClientIP(req);

    if (!name || !permissions || !Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide role name and permissions array'
      });
    }

    const invalidPermissions = permissions.filter(p => !AVAILABLE_PERMISSIONS.includes(p));
    if (invalidPermissions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid permissions',
        invalidPermissions
      });
    }

    const normalizedName = name.toLowerCase().replace(/\s+/g, '_');
    const existingRole = await prisma.customRole.findUnique({ where: { name: normalizedName } });
    if (existingRole) {
      return res.status(400).json({
        success: false,
        message: 'Role with this name already exists'
      });
    }

    const role = await customRoleService.create({
      name: normalizedName,
      description,
      permissions,
      createdById: req.user.id,
    });

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'role_created',
      actionType: 'create',
      targetModel: 'CustomRole',
      targetId: role.id,
      targetName: role.name,
      description: `Created custom role: ${role.name}`,
      metadata: { permissions: role.permissions },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.status(201).json({
      success: true,
      message: 'Custom role created successfully',
      role: {

        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions
      }
    });

  } catch (error) {
    console.error('Create role error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating role'
    });
  }
});

// @route   PUT /api/admin/roles/:id
// @desc    Update custom role
// @access  Private (Super Admin or Admin with roles.edit permission)
router.put('/:id', adminAuth, checkPermission('roles.edit'), checkFeatureEnabled('enableCustomRoles'), async (req, res) => {
  try {
    const { name, description, permissions, isActive } = req.body;
    const clientIP = getClientIP(req);

    const existing = await customRoleService.findByIdentifier(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    const changes = { updatedById: req.user.id };

    if (permissions && Array.isArray(permissions)) {
      const invalidPermissions = permissions.filter(p => !AVAILABLE_PERMISSIONS.includes(p));
      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid permissions',
          invalidPermissions
        });
      }
      changes.permissions = permissions;
    }

    if (name) changes.name = name.toLowerCase().replace(/\s+/g, '_');
    if (description !== undefined) changes.description = description;
    if (isActive !== undefined) changes.isActive = isActive;

    const role = await prisma.customRole.update({ where: { id: req.params.id }, data: changes });

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'role_updated',
      actionType: 'update',
      targetModel: 'CustomRole',
      targetId: role.id,
      targetName: role.name,
      description: `Updated custom role: ${role.name}`,
      metadata: req.body,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Role updated successfully',
      role: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isActive: role.isActive
      }
    });

  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating role'
    });
  }
});

// @route   DELETE /api/admin/roles/:id
// @desc    Delete custom role
// @access  Private (Super Admin or Admin with roles.delete permission)
router.delete('/:id', adminAuth, checkPermission('roles.delete'), checkFeatureEnabled('enableCustomRoles'), async (req, res) => {
  try {
    const clientIP = getClientIP(req);

    const role = await customRoleService.findByIdentifier(req.params.id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    const usersWithRole = await prisma.user.count({ where: { customRoleId: role.id } });
    if (usersWithRole > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role. ${usersWithRole} user(s) currently have this role.`,
        usersWithRole
      });
    }

    const roleName = role.name;
    await prisma.customRole.delete({ where: { id: role.id } });

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'role_deleted',
      actionType: 'delete',
      targetModel: 'CustomRole',
      targetId: req.params.id,
      targetName: roleName,
      description: `Deleted custom role: ${roleName}`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Role deleted successfully'
    });

  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting role'
    });
  }
});

// @route   GET /api/admin/roles/permissions/available
// @desc    Get all available permissions
// @access  Private (Admin with roles.view permission)
router.get('/permissions/available', adminAuth, checkPermission('roles.view'), checkFeatureEnabled('enableCustomRoles'), async (req, res) => {
  try {
    const permissions = AVAILABLE_PERMISSIONS;

    const groupedPermissions = {
      users: permissions.filter(p => p.startsWith('users.')),
      customers: permissions.filter(p => p.startsWith('customers.')),
      roles: permissions.filter(p => p.startsWith('roles.')),
      analytics: permissions.filter(p => p.startsWith('analytics.')),
      logs: permissions.filter(p => p.startsWith('logs.')),
      settings: permissions.filter(p => p.startsWith('settings.')),
      notifications: permissions.filter(p => p.startsWith('notifications.')),
      system: permissions.filter(p => p.startsWith('system.'))
    };

    res.json({
      success: true,
      permissions,
      groupedPermissions
    });

  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching permissions'
    });
  }
});

// @route   POST /api/admin/roles/bulk-delete
// @desc    Delete multiple custom roles at once
// @access  Private (Admin with roles.delete permission)
router.post('/bulk-delete', adminAuth, checkPermission('roles.delete'), checkFeatureEnabled('enableCustomRoles'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide role IDs to delete' });
    }
    const roles = await prisma.customRole.findMany({ where: { id: { in: ids } } });
    if (roles.length === 0) {
      return res.status(404).json({ success: false, message: 'No custom roles found with provided IDs' });
    }
    const usersWithRoles = await prisma.user.count({ where: { customRoleId: { in: ids } } });
    if (usersWithRoles > 0) {
      return res.status(400).json({ success: false, message: 'Some selected roles have users assigned. Reassign them first.' });
    }
    await prisma.customRole.deleteMany({ where: { id: { in: roles.map(r => r.id) } } });
    await activityLogService.logActivity({
      userId: req.userId, userName: req.user.name, userEmail: req.user.email, userRole: req.user.role,
      action: 'roles_bulk_deleted', actionType: 'delete', targetModel: 'CustomRole',
      description: `Bulk deleted ${roles.length} custom roles`,
      ipAddress: getClientIP(req), userAgent: req.get('user-agent'), status: 'success',
    });
    res.json({ success: true, message: `${roles.length} role(s) deleted successfully`, deletedCount: roles.length });
  } catch (error) {
    console.error('Bulk delete roles error:', error);
    res.status(500).json({ success: false, message: 'Error deleting roles' });
  }
});

module.exports = router;
