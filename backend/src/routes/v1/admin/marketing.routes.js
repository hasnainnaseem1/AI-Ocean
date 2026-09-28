const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const marketingPageService = require('../../../services/admin/marketingPageService');
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

/**
 * GET /api/v1/admin/marketing/pages
 * List all marketing pages (admin view — includes drafts)
 */
router.get('/pages', checkPermission('settings.view'), async (req, res) => {
  try {
    const { status, search } = req.query;
    const pages = await marketingPageService.list({ status, search });
    res.json({ success: true, pages });
  } catch (err) {
    console.error('Error fetching marketing pages:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pages' });
  }
});

/**
 * GET /api/v1/admin/marketing/pages/:id
 * Get a single page with all content blocks
 */
router.get('/pages/:id', checkPermission('settings.view'), async (req, res) => {
  try {
    const page = await marketingPageService.findById(req.params.id);
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }
    res.json({ success: true, page });
  } catch (err) {
    console.error('Error fetching marketing page:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch page' });
  }
});

/**
 * POST /api/v1/admin/marketing/pages
 * Create a new marketing page
 */
router.post('/pages', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      title, slug, description, metaTitle, metaDescription, metaKeywords,
      status, isHomePage, showInNavigation, navigationOrder, navigationLabel,
      blocks, customCSS,
    } = req.body;

    const page = await marketingPageService.create({
      title, slug, description, metaTitle, metaDescription, metaKeywords,
      status: status || 'draft',
      isHomePage: isHomePage || false,
      showInNavigation: showInNavigation !== false,
      navigationOrder: navigationOrder || 0,
      navigationLabel: navigationLabel || '',
      blocks: blocks || [],
      customCSS: customCSS || '',
      lastEditedBy: req.user.id,
    });

    res.status(201).json({ success: true, page, message: 'Page created successfully' });
  } catch (err) {
    failure(res, err, 'Failed to create page', { log: 'Error creating marketing page' });
  }
});

/**
 * PUT /api/v1/admin/marketing/pages/:id
 * Update a marketing page
 */
router.put('/pages/:id', checkPermission('settings.edit'), async (req, res) => {
  try {
    const allowedFields = [
      'title', 'slug', 'description', 'metaTitle', 'metaDescription', 'metaKeywords',
      'status', 'isHomePage', 'showInNavigation', 'navigationOrder', 'navigationLabel',
      'blocks', 'customCSS',
    ];
    const fields = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) fields[field] = req.body[field];
    });
    fields.lastEditedBy = req.user.id;

    const page = await marketingPageService.update(req.params.id, fields);
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }

    res.json({ success: true, page, message: 'Page updated successfully' });
  } catch (err) {
    failure(res, err, 'Failed to update page', { log: 'Error updating marketing page' });
  }
});

/**
 * DELETE /api/v1/admin/marketing/pages/:id
 * Delete a marketing page
 */
router.delete('/pages/:id', checkPermission('settings.edit'), async (req, res) => {
  try {
    const page = await marketingPageService.deleteOne(req.params.id);
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }
    res.json({ success: true, message: 'Page deleted successfully' });
  } catch (err) {
    failure(res, err, 'Failed to delete page', { log: 'Error deleting marketing page' });
  }
});

/**
 * PUT /api/v1/admin/marketing/pages/:id/status
 * Quick status toggle (publish/draft/archive)
 */
router.put('/pages/:id/status', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['published', 'draft', 'archived'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const page = await marketingPageService.updateStatus(req.params.id, status, req.user.id);
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }
    res.json({ success: true, page, message: `Page ${status} successfully` });
  } catch (err) {
    console.error('Error updating page status:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

/**
 * POST /api/v1/admin/marketing/pages/:id/clone
 * Clone an existing marketing page
 */
router.post('/pages/:id/clone', checkPermission('settings.edit'), async (req, res) => {
  try {
    const page = await marketingPageService.clone(req.params.id, req.user.id);
    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }
    res.status(201).json({ success: true, page, message: 'Page cloned successfully' });
  } catch (err) {
    console.error('Error cloning page:', err);
    res.status(500).json({ success: false, message: 'Failed to clone page' });
  }
});

/**
 * PUT /api/v1/admin/marketing/pages-reorder
 * Reorder navigation items
 */
router.put('/pages-reorder', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { pages } = req.body; // [{ id, navigationOrder }]
    if (!Array.isArray(pages)) {
      return res.status(400).json({ success: false, message: 'Pages array required' });
    }
    await marketingPageService.reorder(pages);
    res.json({ success: true, message: 'Navigation order updated' });
  } catch (err) {
    console.error('Error reordering pages:', err);
    res.status(500).json({ success: false, message: 'Failed to reorder pages' });
  }
});

/**
 * GET /api/v1/admin/marketing/navigation
 * Get navigation config for marketing site
 */
router.get('/navigation', checkPermission('settings.view'), async (req, res) => {
  try {
    const navigation = await marketingPageService.listForNavigation();
    res.json({ success: true, navigation });
  } catch (err) {
    console.error('Error fetching navigation:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch navigation' });
  }
});

// POST /admin/marketing/pages/bulk-delete — delete multiple pages
router.post('/pages/bulk-delete', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide page IDs to delete' });
    }
    const deletedCount = await marketingPageService.bulkDelete(ids);
    await activityLogService.logActivity({
      userId: req.userId, userName: req.user.name, userEmail: req.user.email, userRole: req.user.role,
      action: 'pages_bulk_deleted', actionType: 'delete', targetModel: 'MarketingPage',
      description: `Bulk deleted ${deletedCount} marketing pages`,
      ipAddress: getClientIP(req), userAgent: req.get('user-agent'), status: 'success',
    });
    res.json({ success: true, message: `${deletedCount} page(s) deleted successfully`, deletedCount });
  } catch (error) {
    failure(res, error, 'Error deleting pages', { log: 'Bulk delete marketing pages error' });
  }
});

module.exports = router;
