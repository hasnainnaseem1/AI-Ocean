/**
 * The fixed vocabulary of permission strings a CustomRole can be built from.
 * Was a model static (`CustomRole.availablePermissions`) — now a plain
 * constant, since Prisma records don't carry statics.
 */
const AVAILABLE_PERMISSIONS = [
  // User Management
  'users.view', 'users.create', 'users.edit', 'users.delete',
  'users.suspend', 'users.activate',

  // Customer Management
  'customers.view', 'customers.create', 'customers.edit', 'customers.delete',
  'customers.suspend', 'customers.activate', 'customers.verify',

  // Role Management
  'roles.view', 'roles.create', 'roles.edit', 'roles.delete',

  // Analytics — revenue is separate from the rest on purpose: an operator may
  // well want a role that can see usage and growth without seeing money.
  'analytics.view', 'analytics.export', 'analytics.revenue',

  // AI Model Catalog (models, tiers, questionnaire)
  'models.view', 'models.create', 'models.edit', 'models.delete',

  // Deployments
  'deployments.view', 'deployments.manage',

  // Billing & Credits
  'billing.view', 'billing.manage',

  // Activity Logs
  'logs.view', 'logs.export', 'logs.delete',

  // Settings
  'settings.view', 'settings.edit',

  // Notifications
  'notifications.view', 'notifications.send', 'notifications.delete',

  // System
  'system.backup', 'system.restore', 'system.maintenance'
];

module.exports = { AVAILABLE_PERMISSIONS };
