const express = require('express');
const router = express.Router();

const v1Routes = require('./v1');

router.use('/v1', v1Routes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

module.exports = router;