/**
 * Feature Gate Middleware
 * 
 * Checks if a specific feature is enabled in AdminSettings before allowing
 * the request to proceed. Returns 403 if the feature is disabled.
 * 
 * Usage:
 *   const { checkFeatureEnabled } = require('../middleware/security/featureGate');
 *   router.post('/', checkFeatureEnabled('enableDeployments'), auth, handler);
 */
const adminSettingsService = require('../../services/admin/adminSettingsService');

/**
 * Returns Express middleware that checks if the given feature flag is enabled.
 * @param {string} featureName - e.g. 'enableDeployments', 'enableModelCatalog', 'enableActivityLogs'
 * @param {string} [customMessage] - Optional custom 403 message
 */
const checkFeatureEnabled = (featureName, customMessage) => {
  return async (req, res, next) => {
    try {
      const settings = await adminSettingsService.getSettings();
      const isEnabled = settings.features?.[featureName] !== false;

      if (!isEnabled) {
        const featureLabel = featureName
          .replace(/^enable/, '')
          .replace(/([A-Z])/g, ' $1')
          .trim();

        return res.status(403).json({
          success: false,
          message: customMessage || `${featureLabel} feature is currently disabled by the administrator.`,
          featureDisabled: featureName,
        });
      }

      next();
    } catch (error) {
      console.error(`Error checking feature flag ${featureName}:`, error);
      // On error, allow the request through (fail-open) to avoid blocking legitimate requests
      next();
    }
  };
};

module.exports = { checkFeatureEnabled };
