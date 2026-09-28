/**
 * Security Settings Helper
 * Provides centralized access to dynamic security settings from AdminSettings.
 * All auth routes, password validations, and login logic should use these helpers
 * instead of hardcoded values.
 */

const adminSettingsService = require('../../services/admin/adminSettingsService');

// Default values (fallbacks if DB is unreachable)
const DEFAULTS = {
  maxLoginAttempts: 5,
  lockoutDuration: 2 * 60 * 60 * 1000, // 2 hours in ms
  sessionTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  passwordMinLength: 8,
  requireStrongPassword: true,
};

/**
 * Get current security settings from AdminSettings collection.
 * Returns settings with sensible defaults if DB fetch fails.
 */
async function getSecuritySettings() {
  try {
    const settings = await adminSettingsService.getSettings();
    const ss = settings.securitySettings || {};
    return {
      maxLoginAttempts: ss.maxLoginAttempts || DEFAULTS.maxLoginAttempts,
      lockoutDuration: ss.lockoutDuration || DEFAULTS.lockoutDuration,
      sessionTimeout: ss.sessionTimeout || DEFAULTS.sessionTimeout,
      passwordMinLength: ss.passwordMinLength || DEFAULTS.passwordMinLength,
      requireStrongPassword: ss.requireStrongPassword !== undefined ? ss.requireStrongPassword : DEFAULTS.requireStrongPassword,
    };
  } catch (err) {
    console.error('[SecurityHelper] Failed to fetch settings, using defaults:', err.message);
    return { ...DEFAULTS };
  }
}

/**
 * Convert session timeout (stored in ms) to JWT expiresIn string.
 * e.g. 604800000 ms → '7d', 3600000 ms → '1h', 1800000 ms → '30m'
 */
function msToJwtExpiry(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.floor(ms / (60 * 1000));
  return `${Math.max(1, minutes)}m`;
}

/**
 * Validate password strength against current security settings.
 * Returns { valid: boolean, errors: string[] }
 * 
 * @param {string} password - The password to validate
 * @param {object} [secSettings] - Optional pre-fetched security settings (avoids extra DB call)
 */
async function validatePassword(password, secSettings) {
  const ss = secSettings || await getSecuritySettings();
  const errors = [];

  // Check minimum length
  if (!password || password.length < ss.passwordMinLength) {
    errors.push(`Password must be at least ${ss.passwordMinLength} characters`);
  }

  // Check strong password requirements
  if (ss.requireStrongPassword && password) {
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    message: errors.length > 0 ? errors.join('. ') : null,
  };
}

module.exports = {
  getSecuritySettings,
  msToJwtExpiry,
  validatePassword,
  DEFAULTS,
};
