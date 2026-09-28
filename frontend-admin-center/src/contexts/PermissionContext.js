import React, { createContext, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ROLES } from '../utils/constants';

export const PermissionContext = createContext(null);

export const PermissionProvider = ({ children }) => {
  const { user } = useAuth();

  const value = useMemo(() => {
    // Ensure permissions is always an array
    let permissions = user?.permissions || [];
    if (!Array.isArray(permissions)) {
      permissions = [];
    }
    
    const role = user?.role || '';

    /**
     * Check if user has a specific permission
     */
    const hasPermission = (permission) => {
      if (!user) return false;
      if (role === ROLES.SUPER_ADMIN) return true;
      if (permissions.includes('*')) return true;
      return permissions.includes(permission);
    };

    /**
     * Check if user has ANY of the given permissions
     */
    const hasAnyPermission = (perms) => {
      if (!user) return false;
      if (role === ROLES.SUPER_ADMIN) return true;
      if (permissions.includes('*')) return true;
      return perms.some((p) => permissions.includes(p));
    };

    /**
     * Check if user has ALL of the given permissions
     */
    const hasAllPermissions = (perms) => {
      if (!user) return false;
      if (role === ROLES.SUPER_ADMIN) return true;
      if (permissions.includes('*')) return true;
      return perms.every((p) => permissions.includes(p));
    };

    /**
     * Check if user has a specific role
     */
    const hasRole = (r) => {
      if (!user) return false;
      if (Array.isArray(r)) return r.includes(role);
      return role === r;
    };

    const isSuperAdmin = role === ROLES.SUPER_ADMIN;
    const isAdmin = role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN;

    return {
      permissions,
      role,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
      hasRole,
      isSuperAdmin,
      isAdmin,
    };
  }, [user]);

  return (
    <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>
  );
};
