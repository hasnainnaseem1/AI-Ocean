import React from 'react';
import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '../../hooks/usePermission';

/**
 * Renders children only if user has the required permission(s).
 *
 * Usage:
 *   <PermissionGuard permission="users.create">
 *     <Button>Create User</Button>
 *   </PermissionGuard>
 *
 *   <PermissionGuard permission={['users.edit', 'users.delete']} requireAll={false}>
 *     <Button>Manage</Button>
 *   </PermissionGuard>
 *
 * Props:
 *   - permission: string | string[]
 *   - requireAll: boolean (default false — any match suffices)
 *   - fallback: ReactNode (what to render if denied, default null)
 *   - showForbidden: boolean (show 403 page instead of fallback)
 */
const PermissionGuard = ({
  permission,
  requireAll = false,
  fallback = null,
  showForbidden = false,
  children,
}) => {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermission();
  const navigate = useNavigate();

  let hasAccess = false;

  if (Array.isArray(permission)) {
    hasAccess = requireAll ? hasAllPermissions(permission) : hasAnyPermission(permission);
  } else {
    hasAccess = hasPermission(permission);
  }

  if (hasAccess) {
    return children;
  }

  if (showForbidden) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="Sorry, you don't have permission to access this page."
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            Back to Dashboard
          </Button>
        }
      />
    );
  }

  return fallback;
};

export default PermissionGuard;
