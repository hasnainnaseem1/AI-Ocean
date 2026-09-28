/**
 * Maintenance Mode Middleware
 *
 * Checks if the platform is in maintenance mode and blocks non-admin requests.
 * Respects the `allowAdminAccess` flag — when true, authenticated admin requests
 * are allowed through even during maintenance.
 *
 * Returns 503 Service Unavailable with the configured maintenance message.
 *
 * Skipped paths:
 *  - Health check (/api/health)
 *  - Public site config (/api/v1/public/site) — so frontends can detect maintenance
 *  - Admin auth (/api/v1/auth/admin) — so admins can still log in
 *  - Admin settings (/api/v1/admin/settings) — so admins can disable maintenance
 */
const adminSettingsService = require('../../services/admin/adminSettingsService');
const userService = require('../../services/user/userService');
const jwt = require('jsonwebtoken');

/**
 * Paths that are NEVER blocked by maintenance mode.
 *
 * The site-config and navigation endpoints are here so the frontends can still
 * find out that maintenance is on — and render their own maintenance page with
 * the operator's message and branding. They are reachable under two prefixes:
 * `/public/marketing/*` is where the routers actually live, and `/public/*` is
 * a convenience alias (see routes/v1/public/index.js). The marketing site calls
 * the `/public/marketing/*` form, so listing only the alias meant its config
 * call was blocked and every page fell back to "404 Page not found", unbranded.
 */
const BYPASS_PATHS = [
  '/api/health',
  '/api/v1/public/site',
  '/api/v1/public/navigation',
  '/api/v1/public/marketing/site',
  '/api/v1/public/marketing/navigation',
  '/api/v1/auth/admin',
  '/api/v1/admin/settings/maintenance',
  '/api/v1/webhooks/stripe',
  '/api/v1/webhooks/lemonsqueezy',
];

// Cache to avoid hitting DB on every single request
let cachedSettings = null;
let cacheExpiry = 0;
const CACHE_TTL = 5000; // 5 seconds

const getMaintenanceSettings = async () => {
  const now = Date.now();
  if (cachedSettings && now < cacheExpiry) {
    return cachedSettings;
  }
  try {
    const settings = await adminSettingsService.getSettings();
    cachedSettings = {
      enabled: settings.maintenanceMode?.enabled || false,
      message: settings.maintenanceMode?.message || 'We are currently performing maintenance. Please check back soon.',
      allowAdminAccess: settings.maintenanceMode?.allowAdminAccess !== false,
    };
    cacheExpiry = now + CACHE_TTL;
    return cachedSettings;
  } catch (err) {
    console.error('Error checking maintenance mode:', err);
    // Fail-open: don't block requests if we can't read settings
    return { enabled: false, message: '', allowAdminAccess: true };
  }
};

// Exported so settings route can bust the cache when maintenance is toggled
const bustMaintenanceCache = () => {
  cachedSettings = null;
  cacheExpiry = 0;
};

const maintenanceMiddleware = async (req, res, next) => {
  // Skip bypass paths
  const path = req.path;
  if (BYPASS_PATHS.some(bp => path.startsWith(bp))) {
    return next();
  }

  const maintenance = await getMaintenanceSettings();

  if (!maintenance.enabled) {
    return next();
  }

  // Maintenance is ON — check if admin access is allowed
  if (maintenance.allowAdminAccess) {
    // Try to extract and verify admin token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Look up the user to check accountType
        const user = await userService.findById(decoded.userId);
        if (user && user.accountType === 'admin') {
          return next();
        }
      } catch {
        // Invalid token — fall through to maintenance response
      }
    }
  }

  // Block the request
  return res.status(503).json({
    success: false,
    maintenance: true,
    message: maintenance.message,
  });
};

module.exports = { maintenanceMiddleware, bustMaintenanceCache };
