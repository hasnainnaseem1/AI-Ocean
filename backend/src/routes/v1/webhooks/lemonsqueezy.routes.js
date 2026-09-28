/**
 * LemonSqueezy Webhook Routes
 *
 * Thin routing layer — only handles:
 *   1. Raw body extraction
 *   2. HMAC signature verification
 *   3. Delegating to the webhook controller
 *
 * IMPORTANT: This route must use express.raw() body parser, NOT express.json().
 * It is mounted separately in app.js before JSON middleware.
 */
const express = require('express');
const router = express.Router();
const lemonSqueezyService = require('../../../services/lemonsqueezy/lemonSqueezyService');
const { handleWebhook } = require('../../../controllers/webhooks/lemonSqueezyWebhookController');

// @route   POST /api/v1/webhooks/lemonsqueezy
// @desc    Handle LemonSqueezy webhook events
// @access  Public (verified via HMAC signature)
router.post('/', async (req, res) => {
  try {
    const signature = req.headers['x-signature'];

    if (!signature) {
      return res.status(400).json({ error: 'Missing webhook signature' });
    }

    // Extract raw payload for signature verification
    let payload;
    try {
      payload = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
    } catch {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    // Verify HMAC signature
    const webhookSecret = await lemonSqueezyService.getWebhookSecret();
    if (!webhookSecret) {
      console.error('[LemonSqueezy] Webhook secret not configured in Admin Settings');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let isValid = false;
    try {
      isValid = lemonSqueezyService.verifyWebhookSignature(payload, signature, webhookSecret);
    } catch (err) {
      console.error('[LemonSqueezy] Signature check threw:', err.message);
      return res.status(400).json({ error: 'Signature verification failed' });
    }

    if (!isValid) {
      console.error('[LemonSqueezy] Invalid signature — check that the webhook secret in Admin Settings matches LemonSqueezy dashboard');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Delegate to controller
    return await handleWebhook(req, res);
  } catch (err) {
    console.error('[LemonSqueezy] Unhandled route error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

module.exports = router;
