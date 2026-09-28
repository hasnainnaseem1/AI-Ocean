const { checkPermission, checkRole, superAdminOnly, adminOnly } = require('./rbac');
const { checkFeatureEnabled } = require('./featureGate');

module.exports = {
  checkPermission,
  checkRole,
  superAdminOnly,
  adminOnly,
  checkFeatureEnabled
};