const activityLogService = require('../../services/admin/activityLogService');
const { getClientIP } = require('../../utils/helpers/ipHelper');
/**
 * RBAC Middleware - Check if user has required permission(s)
 * @param {string|array} requiredPermissions - Single permission or array of permissions
 * @param {string} requireAll - If true, user must have ALL permissions. If false, user must have ANY permission
 */
const checkPermission = (requiredPermissions, requireAll = false) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const clientIP = getClientIP(req);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Convert single permission to array
      const permissions = Array.isArray(requiredPermissions) 
        ? requiredPermissions 
        : [requiredPermissions];

      // Super admin has all permissions
      if (user.role === 'super_admin') {
        return next();
      }

      // Get user's permissions
      const userPermissions = await user.getPermissions();

      // Check if user has wildcard permission
      if (userPermissions.includes('*')) {
        return next();
      }

      let hasAccess = false;

      if (requireAll) {
        // User must have ALL permissions
        hasAccess = permissions.every(permission => 
          userPermissions.includes(permission)
        );
      } else {
        // User must have ANY of the permissions
        hasAccess = permissions.some(permission => 
          userPermissions.includes(permission)
        );
      }

      if (!hasAccess) {
        // Log unauthorized access attempt
        await activityLogService.logActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userRole: user.role,
          action: 'unauthorized_access',
          actionType: 'auth',
          description: `Attempted to access resource requiring: ${permissions.join(', ')}`,
          metadata: {
            requiredPermissions: permissions,
            userPermissions: userPermissions,
            requestedPath: req.path,
            requestedMethod: req.method
          },
          ipAddress: clientIP,
          userAgent: req.get('user-agent'),
          status: 'failed',
          errorMessage: 'Insufficient permissions'
        });

        return res.status(403).json({
          success: false,
          message: 'You do not have permission to perform this action',
          requiredPermissions: permissions
        });
      }

      next();
    } catch (error) {
      console.error('RBAC middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Permission check failed'
      });
    }
  };
};

/**
 * Check if user has specific role(s)
 * @param {string|array} roles - Single role or array of roles
 */
const checkRole = (roles) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const clientIP = getClientIP(req);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const allowedRoles = Array.isArray(roles) ? roles : [roles];

      if (!allowedRoles.includes(user.role)) {
        // Log unauthorized access attempt
        await activityLogService.logActivity({
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          userRole: user.role,
          action: 'unauthorized_access',
          actionType: 'auth',
          description: `Attempted to access resource requiring role: ${allowedRoles.join(', ')}`,
          metadata: {
            requiredRoles: allowedRoles,
            userRole: user.role,
            requestedPath: req.path,
            requestedMethod: req.method
          },
          ipAddress: clientIP,
          userAgent: req.get('user-agent'),
          status: 'failed',
          errorMessage: 'Insufficient role'
        });

        return res.status(403).json({
          success: false,
          message: 'You do not have the required role to perform this action',
          requiredRoles: allowedRoles
        });
      }

      next();
    } catch (error) {
      console.error('Role check middleware error:', error);
      res.status(500).json({
        success: false,
        message: 'Role check failed'
      });
    }
  };
};

/**
 * Super Admin only access
 */
const superAdminOnly = checkRole('super_admin');

/**
 * Admin or Super Admin access
 */
const adminOnly = checkRole(['super_admin', 'admin']);

module.exports = {
  checkPermission,
  checkRole,
  superAdminOnly,
  adminOnly
};
