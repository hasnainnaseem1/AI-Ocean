const auth = require('./auth');
const adminAuth = require('./adminAuth');
const teamContext = require('./teamContext');
const { requirePermission } = teamContext;

module.exports = {
  auth,
  adminAuth,
  teamContext,
  requirePermission,
};