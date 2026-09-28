const express = require('express');
const router = express.Router();

// Import admin routes
const usersRoutes = require('./users.routes');
const customersRoutes = require('./customers.routes');
const rolesRoutes = require('./roles.routes');
const analyticsRoutes = require('./analytics.routes');
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
const questionsRoutes = require('./questions.routes');
const recommendationPolicyRoutes = require('./recommendationPolicy.routes');
const walletsRoutes = require('./wallets.routes');
const teamsRoutes = require('./teams.routes');

// All admin routes require admin authentication
const { adminAuth } = require('../../../middleware/auth');

router.use('/users', adminAuth, usersRoutes);
router.use('/customers', adminAuth, customersRoutes);
router.use('/roles', adminAuth, rolesRoutes);
router.use('/analytics', adminAuth, analyticsRoutes);
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
router.use('/questions', adminAuth, questionsRoutes);
router.use('/recommendation-policy', adminAuth, recommendationPolicyRoutes);
router.use('/wallets', adminAuth, walletsRoutes);
router.use('/teams', adminAuth, teamsRoutes);

module.exports = router;