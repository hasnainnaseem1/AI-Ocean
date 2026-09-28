/**
 * Polar Settings Controller
 *
 * Admin-side business logic for managing Polar configuration. Mirrors
 * lemonSqueezySettingsController.js's updateLemonSqueezy exactly — same
 * super-admin gate, same "only overwrite a secret when a new non-empty value
 * is sent" rule (so re-saving the form without retyping the access token
 * doesn't blank it out), same cache-clear + activity-log shape.
 */
const adminSettingsService = require('../../services/admin/adminSettingsService');
const activityLogService = require('../../services/admin/activityLogService');
const { getClientIP } = require('../../utils/helpers/ipHelper');

/**
 * PUT /api/v1/admin/settings/polar
 * Update Polar integration settings (super_admin only)
 */
const updatePolar = async (req, res) => {
  try {
    const {
      accessToken, organizationId, productId, webhookSecret, sandbox, enabled,
    } = req.body;
    const clientIP = getClientIP(req);

    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can update Polar settings' });
    }

    const settings = await adminSettingsService.getSettings();

    if (!settings.polarSettings) settings.polarSettings = {};

    if (organizationId !== undefined) settings.polarSettings.organizationId = organizationId.trim();
    if (productId !== undefined) settings.polarSettings.productId = productId.trim();
    if (sandbox !== undefined) settings.polarSettings.sandbox = !!sandbox;
    if (enabled !== undefined) settings.polarSettings.enabled = enabled;

    // Only update secrets if new, non-empty values are provided
    if (accessToken && accessToken.trim()) {
      settings.polarSettings.accessToken = accessToken.trim();
    }
    if (webhookSecret && webhookSecret.trim()) {
      settings.polarSettings.webhookSecret = webhookSecret.trim();
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Clear cached service instance so it reinitializes with new keys
    try {
      const polarService = require('../../services/polar/polarService');
      polarService.clearCache();
    } catch (e) { /* ignore */ }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Polar integration settings updated',
      metadata: { organizationId: organizationId || '(unchanged)', sandbox, enabled },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: 'Polar settings saved successfully',
      polarSettings: {
        organizationId: settings.polarSettings.organizationId,
        productId: settings.polarSettings.productId,
        sandbox: settings.polarSettings.sandbox,
        enabled: settings.polarSettings.enabled,
        // Never return secrets
      },
    });
  } catch (error) {
    console.error('Update Polar settings error:', error);
    res.status(500).json({ success: false, message: 'Error updating Polar settings' });
  }
};

module.exports = {
  updatePolar,
};
