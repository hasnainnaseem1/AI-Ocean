const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const { meta } = require('../../../utils/helpers/pagination');
const router = express.Router();
const adminSettingsService = require('../../../services/admin/adminSettingsService');
const seoRedirectService = require('../../../services/admin/seoRedirectService');
const { checkPermission } = require('../../../middleware/security');

// ==========================================
// SEO SETTINGS
// ==========================================

/**
 * GET /api/v1/admin/seo/settings
 * Get SEO settings
 */
router.get('/settings', checkPermission('settings.view'), async (req, res) => {
  try {
    const settings = await adminSettingsService.getSettings();
    res.json({ success: true, seoSettings: settings.seoSettings || {} });
  } catch (err) {
    console.error('Error fetching SEO settings:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch SEO settings' });
  }
});

/**
 * PUT /api/v1/admin/seo/settings
 * Update SEO settings
 */
router.put('/settings', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      googleAnalyticsId,
      googleSearchConsoleVerification,
      bingVerification,
      defaultOgImage,
      socialLinks,
      socialLinksEnabled,
      customSocialLinks,
      enableSitemap,
      robotsTxtCustom,
      customHeadScripts,
      enableSchemaMarkup,
    } = req.body;

    const settings = await adminSettingsService.getSettings();

    if (!settings.seoSettings) settings.seoSettings = {};

    if (googleAnalyticsId !== undefined) settings.seoSettings.googleAnalyticsId = googleAnalyticsId;
    if (googleSearchConsoleVerification !== undefined) settings.seoSettings.googleSearchConsoleVerification = googleSearchConsoleVerification;
    if (bingVerification !== undefined) settings.seoSettings.bingVerification = bingVerification;
    if (defaultOgImage !== undefined) settings.seoSettings.defaultOgImage = defaultOgImage;
    if (socialLinks !== undefined) settings.seoSettings.socialLinks = socialLinks;
    if (socialLinksEnabled !== undefined) settings.seoSettings.socialLinksEnabled = socialLinksEnabled;
    if (customSocialLinks !== undefined) settings.seoSettings.customSocialLinks = customSocialLinks;
    if (enableSitemap !== undefined) settings.seoSettings.enableSitemap = enableSitemap;
    if (robotsTxtCustom !== undefined) settings.seoSettings.robotsTxtCustom = robotsTxtCustom;
    if (customHeadScripts !== undefined) settings.seoSettings.customHeadScripts = customHeadScripts;
    if (enableSchemaMarkup !== undefined) settings.seoSettings.enableSchemaMarkup = enableSchemaMarkup;

    settings.markModified('seoSettings');
    await settings.save();

    res.json({ success: true, seoSettings: settings.seoSettings });
  } catch (err) {
    console.error('Error updating SEO settings:', err);
    res.status(500).json({ success: false, message: 'Failed to update SEO settings' });
  }
});

// ==========================================
// REDIRECTS MANAGEMENT
// ==========================================

/**
 * GET /api/v1/admin/seo/redirects
 * List all redirects
 */
router.get('/redirects', checkPermission('settings.view'), async (req, res) => {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    const { redirects, total } = await seoRedirectService.list({ search, status, page, limit });

    res.json({
      success: true,
      redirects,
      pagination: meta({ page, limit }, total),
    });
  } catch (err) {
    console.error('Error fetching redirects:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch redirects' });
  }
});

/**
 * POST /api/v1/admin/seo/redirects
 * Create a new redirect
 */
router.post('/redirects', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { fromPath, toPath, statusCode, note } = req.body;

    if (!fromPath || !toPath) {
      return res.status(400).json({ success: false, message: 'fromPath and toPath are required' });
    }

    // Normalize paths
    const normalizedFrom = fromPath.startsWith('/') ? fromPath : `/${fromPath}`;
    const normalizedTo = toPath.startsWith('/') || toPath.startsWith('http') ? toPath : `/${toPath}`;

    // Prevent circular redirects
    if (normalizedFrom === normalizedTo) {
      return res.status(400).json({ success: false, message: 'Cannot redirect a path to itself' });
    }

    const redirect = await seoRedirectService.create({
      fromPath: normalizedFrom,
      toPath: normalizedTo,
      statusCode: statusCode || 301,
      note: note || '',
      createdBy: req.user?.id,
    });

    res.status(201).json({ success: true, redirect });
  } catch (err) {
    failure(res, err, 'Failed to create redirect', { log: 'Error creating redirect' });
  }
});

/**
 * PUT /api/v1/admin/seo/redirects/:id
 * Update a redirect
 */
router.put('/redirects/:id', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { fromPath, toPath, statusCode, isActive, note } = req.body;

    const redirect = await seoRedirectService.update(req.params.id, {
      fromPath: fromPath !== undefined ? (fromPath.startsWith('/') ? fromPath : `/${fromPath}`) : undefined,
      toPath: toPath !== undefined ? (toPath.startsWith('/') || toPath.startsWith('http') ? toPath : `/${toPath}`) : undefined,
      statusCode,
      isActive,
      note,
    });
    if (!redirect) {
      return res.status(404).json({ success: false, message: 'Redirect not found' });
    }

    res.json({ success: true, redirect });
  } catch (err) {
    failure(res, err, 'Failed to update redirect', { log: 'Error updating redirect' });
  }
});

/**
 * DELETE /api/v1/admin/seo/redirects/:id
 * Delete a redirect
 */
router.delete('/redirects/:id', checkPermission('settings.edit'), async (req, res) => {
  try {
    const redirect = await seoRedirectService.deleteOne(req.params.id);
    if (!redirect) {
      return res.status(404).json({ success: false, message: 'Redirect not found' });
    }
    res.json({ success: true, message: 'Redirect deleted' });
  } catch (err) {
    console.error('Error deleting redirect:', err);
    res.status(500).json({ success: false, message: 'Failed to delete redirect' });
  }
});

/**
 * PUT /api/v1/admin/seo/redirects/:id/toggle
 * Toggle redirect active status
 */
router.put('/redirects/:id/toggle', checkPermission('settings.edit'), async (req, res) => {
  try {
    const redirect = await seoRedirectService.toggleActive(req.params.id);
    if (!redirect) {
      return res.status(404).json({ success: false, message: 'Redirect not found' });
    }
    res.json({ success: true, redirect });
  } catch (err) {
    console.error('Error toggling redirect:', err);
    res.status(500).json({ success: false, message: 'Failed to toggle redirect' });
  }
});

module.exports = router;
