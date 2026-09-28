/**
 * Integrations Controller
 *
 * A single enable/disable switch shared by every card on the admin Integrations
 * page. Every payment gateway (Stripe, LemonSqueezy, Polar) shares the
 * "payment" category: turning one on moves `activePaymentGateway` to it and
 * turns every other payment gateway off, since a checkout can only run
 * through one processor at a time. `PAYMENT_GATEWAY_TYPES` comes from
 * gatewayRegistry.js so a future gateway only needs adding there, not a new
 * `||` hand-added to this file too. Email and Google SSO are not exclusive to
 * anything — Email is the platform's only SMTP path, and Google SSO's flag
 * has always stood alone.
 */
const adminSettingsService = require('../../services/admin/adminSettingsService');
const activityLogService = require('../../services/admin/activityLogService');
const { getClientIP } = require('../../utils/helpers/ipHelper');
const { PAYMENT_GATEWAY_TYPES } = require('../../services/payments/gatewayRegistry');

const VALID_TYPES = [...PAYMENT_GATEWAY_TYPES, 'email', 'google-sso'];

/** Does this gateway type have the credentials it needs to actually be enabled? */
const isGatewayConfigured = (type, settings) => {
  if (type === 'stripe') return !!settings.stripeSettings?.secretKey;
  if (type === 'lemonsqueezy') return !!(settings.lemonSqueezySettings?.apiKey && settings.lemonSqueezySettings?.storeId);
  if (type === 'polar') return !!(settings.polarSettings?.accessToken && settings.polarSettings?.organizationId);
  return false;
};

const MISSING_CREDENTIALS_MESSAGE = {
  stripe: 'Add your Stripe API keys before enabling this integration',
  lemonsqueezy: 'Add your LemonSqueezy store ID and API key before enabling this integration',
  polar: 'Add your Polar access token and organization ID before enabling this integration',
};

/**
 * PUT /api/v1/admin/settings/integrations/:type/toggle
 * Body: { enabled: boolean }
 * Super Admin only
 */
const toggleIntegration = async (req, res) => {
  try {
    const { type } = req.params;
    const { enabled } = req.body;
    const clientIP = getClientIP(req);

    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can enable or disable integrations' });
    }

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `Invalid integration type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: '"enabled" must be true or false' });
    }

    const settings = await adminSettingsService.getSettings();

    if (PAYMENT_GATEWAY_TYPES.includes(type)) {
      if (enabled) {
        if (!isGatewayConfigured(type, settings)) {
          return res.status(400).json({ success: false, message: MISSING_CREDENTIALS_MESSAGE[type] });
        }
        settings.activePaymentGateway = type;
      } else if (settings.activePaymentGateway === type) {
        settings.activePaymentGateway = 'none';
      }
      // Keep each gateway's own `enabled` flag from disagreeing with the real
      // switch — it used to be set independently by each settings form and
      // could drift out of sync.
      for (const gatewayType of PAYMENT_GATEWAY_TYPES) {
        const key = gatewayType === 'lemonsqueezy' ? 'lemonSqueezySettings'
          : gatewayType === 'polar' ? 'polarSettings' : 'stripeSettings';
        if (!settings[key]) settings[key] = {};
        settings[key].enabled = settings.activePaymentGateway === gatewayType;
      }
    } else if (type === 'email') {
      if (enabled && !settings.emailSettings?.smtpHost) {
        return res.status(400).json({ success: false, message: 'Add your SMTP host before enabling this integration' });
      }
      if (!settings.emailSettings) settings.emailSettings = {};
      settings.emailSettings.enabled = enabled;
    } else if (type === 'google-sso') {
      if (!settings.googleSSOSettings) settings.googleSSOSettings = {};
      settings.googleSSOSettings.enabled = enabled;
    }

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
      description: `${type} integration ${enabled ? 'enabled' : 'disabled'}`,
      metadata: { type, enabled, activePaymentGateway: settings.activePaymentGateway },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: `${type} ${enabled ? 'enabled' : 'disabled'} successfully`,
      activePaymentGateway: settings.activePaymentGateway,
      emailEnabled: settings.emailSettings?.enabled,
      googleSSOEnabled: settings.googleSSOSettings?.enabled,
    });
  } catch (error) {
    console.error('Toggle integration error:', error);
    res.status(500).json({ success: false, message: 'Error toggling integration' });
  }
};

module.exports = {
  toggleIntegration,
};
