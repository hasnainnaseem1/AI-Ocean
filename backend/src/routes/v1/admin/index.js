const express = require('express');
const router = express.Router();

// Import admin routes
const usersRoutes = require('./users.routes');
const customersRoutes = require('./customers.routes');
const rolesRoutes = require('./roles.routes');
const analyticsRoutes = require('./analytics.routes');
const dashboardRoutes = require('./dashboard.routes');
const logsRoutes = require('./logs.routes');
const settingsRoutes = require('./settings.routes');
const departmentsRoutes = require('./departments.routes');
const devUtilsRoutes = require('./dev-utils.routes');
const marketingRoutes = require('./marketing.routes');
const blogRoutes = require('./blog.routes');
const seoRoutes = require('./seo.routes');
const uploadRoutes = require('./upload.routes');
const cronRoutes = require('./cron.routes');
const modelsRoutes = require('./models.routes');
const tiersRoutes = require('./tiers.routes');
const resourceComponentsRoutes = require('./resourceComponents.routes');
const deploymentsRoutes = require('./deployments.routes');
const cloudInstancesRoutes = require('./cloudInstances.routes');
const questionsRoutes = require('./questions.routes');
const recommendationPolicyRoutes = require('./recommendationPolicy.routes');
const analyticsPolicyRoutes = require('./analyticsPolicy.routes');
const walletsRoutes = require('./wallets.routes');
const teamsRoutes = require('./teams.routes');
const supportRoutes = require('./support.routes');

// All admin routes require admin authentication
const { adminAuth } = require('../../../middleware/auth');

router.use('/users', adminAuth, usersRoutes);
router.use('/customers', adminAuth, customersRoutes);
router.use('/roles', adminAuth, rolesRoutes);
router.use('/analytics', adminAuth, analyticsRoutes);
// Separate from /analytics: the Dashboard composes several domains rather
// than being one, and must stay reachable with plain analytics.view.
router.use('/dashboard', adminAuth, dashboardRoutes);
router.use('/logs', adminAuth, logsRoutes);
router.use('/settings', adminAuth, settingsRoutes);
router.use('/departments', adminAuth, departmentsRoutes);
router.use('/dev-utils', adminAuth, devUtilsRoutes);
router.use('/marketing', adminAuth, marketingRoutes);
router.use('/blog', adminAuth, blogRoutes);
router.use('/seo', adminAuth, seoRoutes);
router.use('/upload', adminAuth, uploadRoutes);
router.use('/cron', adminAuth, cronRoutes);

// AI infrastructure
router.use('/models', adminAuth, modelsRoutes);
router.use('/tiers', adminAuth, tiersRoutes);
router.use('/resource-components', adminAuth, resourceComponentsRoutes);
router.use('/deployments', adminAuth, deploymentsRoutes);
// The machines behind deployments, and the ones nobody owns. Its own mount
// rather than more routes under /deployments, so that `/orphans` can never be
// swallowed by `/deployments/:id`.
router.use('/cloud', adminAuth, cloudInstancesRoutes);
router.use('/questions', adminAuth, questionsRoutes);
router.use('/recommendation-policy', adminAuth, recommendationPolicyRoutes);
// What the analytics layer's numbers MEAN — thresholds, bands, weights and
// every customer-facing sentence built from them. Sits beside the
// recommendation policy because they are the same pattern.
router.use('/analytics-policy', adminAuth, analyticsPolicyRoutes);
router.use('/wallets', adminAuth, walletsRoutes);
router.use('/teams', adminAuth, teamsRoutes);
router.use('/support', adminAuth, supportRoutes);

module.exports = router;