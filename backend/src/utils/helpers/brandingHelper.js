/**
 * Branding Helper
 * Replaces all hardcoded branding with dynamic values from .env
 */

const brandingConfig = {
  appName: process.env.APP_NAME || 'My Platform',
  appTagline: process.env.APP_TAGLINE || 'Your Business Optimization Platform',
  appDescription: process.env.APP_DESCRIPTION || 'AI-powered business optimization platform',
  appVersion: process.env.APP_VERSION || '1.0.0',
  
  // Service Keywords
  primaryService: process.env.PRIMARY_SERVICE || 'SEO',
  secondaryService: process.env.SECONDARY_SERVICE || 'Optimization',
  targetPlatform: process.env.TARGET_PLATFORM || '',
  toolType: process.env.TOOL_TYPE || 'AI Agent',
  
  // Welcome Messages
  welcomeTitle: process.env.WELCOME_TITLE || 'Welcome to {APP_NAME}!',
  welcomeMessage: process.env.WELCOME_MESSAGE || 'Thank you for joining {APP_NAME}. Please verify your email to get started.',
  emailVerificationMessage: process.env.EMAIL_VERIFICATION_MESSAGE || 'Please verify your email to start using our platform.',
  
  // Email
  emailFromName: process.env.EMAIL_FROM_NAME || 'Platform Team',
  emailSubjectPrefix: process.env.EMAIL_SUBJECT_PREFIX || '[Platform]',
};

/**
 * Replace placeholders in text with actual branding values
 * @param {string} text - Text with placeholders like {APP_NAME}
 * @returns {string} - Text with replaced values
 */
const replacePlaceholders = (text) => {
  if (!text) return text;
  
  return text
    .replace(/{APP_NAME}/g, brandingConfig.appName)
    .replace(/{APP_TAGLINE}/g, brandingConfig.appTagline)
    .replace(/{PRIMARY_SERVICE}/g, brandingConfig.primaryService)
    .replace(/{SECONDARY_SERVICE}/g, brandingConfig.secondaryService)
    .replace(/{TARGET_PLATFORM}/g, brandingConfig.targetPlatform)
    .replace(/{TOOL_TYPE}/g, brandingConfig.toolType);
};

/**
 * Get welcome notification data.
 *
 * `settings` is the AdminSettings record. The brand name comes from there
 * first, because that is what the operator configures and what every other
 * customer-facing surface renders — the `.env` values are only a fallback for
 * a brand-new install that hasn't been through Settings yet. Reading APP_NAME
 * directly is why a customer's very first notification read "Welcome to My
 * Platform!" on a platform called AI-Ocean.
 */
const brandNameFrom = (settings) => settings?.themeSettings?.companyName
  || settings?.themeSettings?.appName
  || settings?.siteName
  || brandingConfig.appName;

const getWelcomeNotification = (settings) => {
  const appName = brandNameFrom(settings);
  const fill = (text) => replacePlaceholders(text).split(brandingConfig.appName).join(appName);

  return {
    type: 'welcome',
    title: fill(brandingConfig.welcomeTitle),
    message: fill(brandingConfig.welcomeMessage),
    priority: 'high',
  };
};

/**
 * Get email verification message
 */
const getEmailVerificationMessage = () => replacePlaceholders(brandingConfig.emailVerificationMessage);

/**
 * Get app info for API responses
 */
const getAppInfo = () => ({
  name: brandingConfig.appName,
  tagline: brandingConfig.appTagline,
  description: brandingConfig.appDescription,
  version: brandingConfig.appVersion
});

/**
 * Get service info
 */
const getServiceInfo = () => ({
  primaryService: brandingConfig.primaryService,
  secondaryService: brandingConfig.secondaryService,
  targetPlatform: brandingConfig.targetPlatform,
  toolType: brandingConfig.toolType
});

module.exports = {
  brandingConfig,
  replacePlaceholders,
  getWelcomeNotification,
  getEmailVerificationMessage,
  getAppInfo,
  getServiceInfo
};
