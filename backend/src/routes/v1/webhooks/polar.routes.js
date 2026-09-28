/**
 * Polar Webhook Routes
 *
 * Thin routing layer — only handles:
 *   1. Raw body extraction
 *   2. Standard Webhooks signature verification (see polarService.js)
 *   3. Delegating to the webhook controller
 *
 * IMPORTANT: This route must use express.raw() body parser, NOT express.json().
 * It is mounted separately in app.js before JSON middleware.
 */
const express = require('express');
const router = express.Router();
const polarService = require('../../../services/polar/polarService');
const { handleWebhook } = require('../../../controllers/webhooks/polarWebhookController');

// @route   POST /api/v1/webhooks/polar
// @desc    Handle Polar webhook events
// @access  Public (verified via Standard Webhooks signature)
router.post('/', async (req, res) => {
  try {
    const headers = {
      'webhook-id': req.headers['webhook-id'],
      'webhook-timestamp': req.headers['webhook-timestamp'],
      'webhook-signature': req.headers['webhook-signature'],
    };

    if (!headers['webhook-id'] || !headers['webhook-timestamp'] || !headers['webhook-signature']) {
      return res.status(400).json({ error: 'Missing webhook signature headers' });
    }

    // Extract raw payload for signature verification
    let payload;
    try {
      payload = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
    } catch {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const webhookSecret = await polarService.getWebhookSecret();
    if (!webhookSecret) {
      console.error('[Polar] Webhook secret not configured in Admin Settings');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let isValid = false;
    try {
      isValid = polarService.verifyWebhookSignature(payload, headers, webhookSecret);
    } catch (err) {
      console.error('[Polar] Signature check threw:', err.message);
      return res.status(400).json({ error: 'Signature verification failed' });
    }

    if (!isValid) {
      console.error('[Polar] Invalid signature — check that the webhook secret in Admin Settings matches the Polar dashboard');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Delegate to controller
    return await handleWebhook(req, res);
  } catch (err) {
    console.error('[Polar] Unhandled route error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

module.exports = router;
