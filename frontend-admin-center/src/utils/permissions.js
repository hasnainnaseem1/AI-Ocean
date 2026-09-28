/**
 * All available permissions — mirrors backend CustomRole.availablePermissions
 */
export const PERMISSIONS = {
  // User Management
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_EDIT: 'users.edit',
  USERS_DELETE: 'users.delete',
  USERS_SUSPEND: 'users.suspend',
  USERS_ACTIVATE: 'users.activate',

  // Customer Management
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_EDIT: 'customers.edit',
  CUSTOMERS_DELETE: 'customers.delete',
  CUSTOMERS_SUSPEND: 'customers.suspend',
  CUSTOMERS_ACTIVATE: 'customers.activate',
  CUSTOMERS_VERIFY: 'customers.verify',

  // AI Model Catalog (models, tiers, deployment questionnaire)
  MODELS_VIEW: 'models.view',
  MODELS_CREATE: 'models.create',
  MODELS_EDIT: 'models.edit',
  MODELS_DELETE: 'models.delete',

  // Deployments
  DEPLOYMENTS_VIEW: 'deployments.view',
  DEPLOYMENTS_MANAGE: 'deployments.manage',

  // Billing & Credits
  BILLING_VIEW: 'billing.view',
  BILLING_MANAGE: 'billing.manage',

  // Role Management
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_EDIT: 'roles.edit',
  ROLES_DELETE: 'roles.delete',

  // Analytics
  ANALYTICS_VIEW: 'analytics.view',
  ANALYTICS_EXPORT: 'analytics.export',

  // Activity Logs
  LOGS_VIEW: 'logs.view',
  LOGS_EXPORT: 'logs.export',
  LOGS_DELETE: 'logs.delete',

  // Settings
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',

  // Notifications
  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_SEND: 'notifications.send',
  NOTIFICATIONS_DELETE: 'notifications.delete',

  // System
  SYSTEM_BACKUP: 'system.backup',
  SYSTEM_RESTORE: 'system.restore',
  SYSTEM_MAINTENANCE: 'system.maintenance',
};

/**
 * Permission groups for organized display (e.g., role form checkboxes)
 */
export const PERMISSION_GROUPS = {
  'User Management': [
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_EDIT,
    PERMISSIONS.USERS_DELETE,
    PERMISSIONS.USERS_SUSPEND,
    PERMISSIONS.USERS_ACTIVATE,
  ],
  'AI Infrastructure': [
    PERMISSIONS.MODELS_VIEW,
    PERMISSIONS.MODELS_CREATE,
    PERMISSIONS.MODELS_EDIT,
    PERMISSIONS.MODELS_DELETE,
    PERMISSIONS.DEPLOYMENTS_VIEW,
    PERMISSIONS.DEPLOYMENTS_MANAGE,
  ],
  'Billing & Credits': [
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_MANAGE,
  ],
  'Customer Management': [
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_CREATE,
    PERMISSIONS.CUSTOMERS_EDIT,
    PERMISSIONS.CUSTOMERS_DELETE,
    PERMISSIONS.CUSTOMERS_SUSPEND,
    PERMISSIONS.CUSTOMERS_ACTIVATE,
    PERMISSIONS.CUSTOMERS_VERIFY,
  ],
  'Role Management': [
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.ROLES_CREATE,
    PERMISSIONS.ROLES_EDIT,
    PERMISSIONS.ROLES_DELETE,
  ],
  Analytics: [
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
  ],
  'Activity Logs': [
    PERMISSIONS.LOGS_VIEW,
    PERMISSIONS.LOGS_EXPORT,
    PERMISSIONS.LOGS_DELETE,
  ],
  Settings: [
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_EDIT,
  ],
  Notifications: [
    PERMISSIONS.NOTIFICATIONS_VIEW,
    PERMISSIONS.NOTIFICATIONS_SEND,
    PERMISSIONS.NOTIFICATIONS_DELETE,
  ],
  System: [
    PERMISSIONS.SYSTEM_BACKUP,
    PERMISSIONS.SYSTEM_RESTORE,
    PERMISSIONS.SYSTEM_MAINTENANCE,
  ],
};

/**
 * Friendly label for a permission string, e.g. 'users.view' → 'View'
 */
export const getPermissionLabel = (permission) => {
  const action = permission.split('.')[1];
  if (!action) return permission;
  return action.charAt(0).toUpperCase() + action.slice(1);
};

/**
 * Friendly group label from permission string, e.g. 'users.view' → 'Users'
 */
export const getPermissionGroup = (permission) => {
  const group = permission.split('.')[0];
  if (!group) return permission;
  return group.charAt(0).toUpperCase() + group.slice(1);
};
