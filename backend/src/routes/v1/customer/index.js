const express = require('express');
const router = express.Router();

const catalogRoutes = require('./catalog.routes');
const deploymentRoutes = require('./deployments.routes');
const walletRoutes = require('./wallet.routes');
const billingRoutes = require('./billing.routes');
const paymentMethodsRoutes = require('./paymentMethods.routes');
const teamsRoutes = require('./teams.routes');
const invitationsRoutes = require('./invitations.routes');

// All customer routes require authentication, and act on one account (Team) —
// `teamContext` resolves it into `req.team` / `req.membership`.
const { auth, teamContext } = require('../../../middleware/auth');

router.use('/catalog', auth, teamContext, catalogRoutes);
router.use('/deployments', auth, teamContext, deploymentRoutes);
router.use('/wallet', auth, teamContext, walletRoutes);
router.use('/billing', auth, teamContext, billingRoutes);
router.use('/payment-methods', auth, teamContext, paymentMethodsRoutes);
router.use('/teams', auth, teamContext, teamsRoutes);
// Not behind teamContext: someone accepting an invitation is not a member yet.
router.use('/invitations', auth, invitationsRoutes);

module.exports = router;
