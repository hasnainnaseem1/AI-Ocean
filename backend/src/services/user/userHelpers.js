const bcrypt = require('bcryptjs');

/**
 * Plain-function equivalents of what used to be User instance methods, now
 * that a "user" is a Prisma record instead of a document with methods
 * attached. Every one of these takes the user object as its first argument
 * instead of being called as `user.methodName()`.
 *
 * `wrapUser` (in userService.js) still binds these back onto the object it
 * returns, so existing call sites like `req.user.hasPermission('x.y')`
 * continue to work unchanged across the rest of the app — these plain
 * functions are what that binding actually calls.
 */

const BUILT_IN_PERMISSIONS = {
  admin: [
    'users.view', 'users.create', 'users.edit', 'users.delete',
    'customers.view', 'customers.edit',
    'models.view', 'models.create', 'models.edit', 'models.delete',
    'deployments.view', 'deployments.manage',
    'billing.view', 'billing.manage',
    // Revenue used to be gated by a hardcoded `role === 'admin'` check in
    // analytics.routes.js. It is a real permission now, so the built-in roles
    // carry it (or not) exactly as that check used to decide: admin yes,
    // moderator and viewer no.
    'analytics.view', 'analytics.revenue', 'logs.view', 'settings.edit'
  ],
  moderator: [
    'users.view', 'customers.view', 'customers.edit',
    'models.view', 'models.edit',
    'deployments.view', 'deployments.manage',
    'billing.view',
    'analytics.view'
  ],
  viewer: [
    'users.view', 'customers.view',
    'models.view', 'deployments.view', 'billing.view',
    'analytics.view'
  ]
};

const hashPassword = async (plain) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
};

const comparePassword = async (user, candidatePassword) => {
  return bcrypt.compare(candidatePassword, user.password);
};

const isLocked = (user) => {
  return !!(user.lockUntil && new Date(user.lockUntil) > new Date());
};

/** Mirrors User.js's getPermissions() exactly, including the customRole path. */
const getPermissions = (user) => {
  if (user.role === 'super_admin') {
    return ['*'];
  }
  if (user.role === 'custom' && user.customRole) {
    return user.customRole.permissions || [];
  }
  return BUILT_IN_PERMISSIONS[user.role] || [];
};

const hasPermission = (user, permission) => {
  const permissions = getPermissions(user);
  if (permissions.includes('*')) return true;
  if (permissions.includes(permission)) return true;
  const [resource] = permission.split('.');
  if (permissions.includes(`${resource}.*`)) return true;
  return false;
};

module.exports = {
  BUILT_IN_PERMISSIONS,
  hashPassword,
  comparePassword,
  isLocked,
  getPermissions,
  hasPermission,
};
