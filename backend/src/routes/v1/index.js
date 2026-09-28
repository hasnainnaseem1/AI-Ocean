const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const customerRoutes = require('./customer');
const adminRoutes = require('./admin');
const notificationRoutes = require('./notification');
const publicRoutes = require('./public');
const stripeWebhookRoutes = require('./webhooks/stripe.routes');
const lemonSqueezyWebhookRoutes = require('./webhooks/lemonsqueezy.routes');
const polarWebhookRoutes = require('./webhooks/polar.routes');

router.use('/auth', authRoutes);
router.use('/customer', customerRoutes);
router.use('/admin', adminRoutes);
router.use('/notifications', notificationRoutes);
router.use('/public', publicRoutes);
router.use('/webhooks/stripe', stripeWebhookRoutes);
router.use('/webhooks/lemonsqueezy', lemonSqueezyWebhookRoutes);
router.use('/webhooks/polar', polarWebhookRoutes);

module.exports = router;