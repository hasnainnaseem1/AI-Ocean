const express = require('express');
const router = express.Router();

const customerAuthRoutes = require('./customer.routes');
const adminAuthRoutes = require('./admin.routes');

router.use('/customer', customerAuthRoutes);
router.use('/admin', adminAuthRoutes);

module.exports = router;