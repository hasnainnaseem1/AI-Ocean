/**
 * LemonSqueezy Settings Controller
 *
 * Admin-side business logic for managing LemonSqueezy configuration
 * and active payment gateway selection.
 */
const adminSettingsService = require('../../services/admin/adminSettingsService');
const activityLogService = require('../../services/admin/activityLogService');
const { getClientIP } = require('../../utils/helpers/ipHelper');

/**
 * PUT /api/v1/admin/settings/lemonsqueezy
 * Update LemonSqueezy integration settings (super_admin only)
 */
const updateLemonSqueezy = async (req, res) => {
  try {
    const { apiKey, storeId, webhookSecret, enabled } = req.body;
    const clientIP = getClientIP(req);

    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can update LemonSqueezy settings' });
    }

    const settings = await adminSettingsService.getSettings();

    if (!settings.lemonSqueezySettings) settings.lemonSqueezySettings = {};

    if (storeId !== undefined) settings.lemonSqueezySettings.storeId = storeId.trim().replace(/^#/, '');
    if (enabled !== undefined) settings.lemonSqueezySettings.enabled = enabled;

    // Only update secrets if new, non-empty values are provided
    if (apiKey && apiKey.trim()) {
      settings.lemonSqueezySettings.apiKey = apiKey.trim();
    }
    if (webhookSecret && webhookSecret.trim()) {
      settings.lemonSqueezySettings.webhookSecret = webhookSecret.trim();
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Clear cached service instance so it reinitializes with new keys
    try {
      const lemonSqueezyService = require('../../services/lemonsqueezy/lemonSqueezyService');
      lemonSqueezyService.clearCache();
    } catch (e) { /* ignore */ }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'LemonSqueezy integration settings updated',
      metadata: { storeId: storeId || '(unchanged)', enabled },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: 'LemonSqueezy settings saved successfully',
      lemonSqueezySettings: {
        storeId: settings.lemonSqueezySettings.storeId,
        enabled: settings.lemonSqueezySettings.enabled,
        // Never return secrets
      },
    });
  } catch (error) {
    console.error('Update LemonSqueezy settings error:', error);
    res.status(500).json({ success: false, message: 'Error updating LemonSqueezy settings' });
  }
};

/**
 * PUT /api/v1/admin/settings/payment-gateway
 * Set the active payment gateway (stripe | lemonsqueezy | polar | none)
 * Super Admin only
 */
const updatePaymentGateway = async (req, res) => {
  try {
    const { gateway } = req.body;
    const clientIP = getClientIP(req);

    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can change the payment gateway' });
    }

    const { PAYMENT_GATEWAY_TYPES } = require('../../services/payments/gatewayRegistry');
    const VALID_GATEWAYS = [...PAYMENT_GATEWAY_TYPES, 'none'];
    if (!VALID_GATEWAYS.includes(gateway)) {
      return res.status(400).json({
        success: false,
        message: `Invalid gateway. Must be one of: ${VALID_GATEWAYS.join(', ')}`,
      });
    }

    const settings = await adminSettingsService.getSettings();
    settings.activePaymentGateway = gateway;
    settings.lastUpdatedBy = req.userId;
    await settings.save();

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: `Active payment gateway changed to ${gateway}`,
      metadata: { gateway },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: `Payment gateway set to ${gateway}`,
      activePaymentGateway: gateway,
    });
  } catch (error) {
    console.error('Update payment gateway error:', error);
    res.status(500).json({ success: false, message: 'Error updating payment gateway' });
  }
};

module.exports = {
  updateLemonSqueezy,
  updatePaymentGateway,
};
