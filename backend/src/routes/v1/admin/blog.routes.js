const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const { meta } = require('../../../utils/helpers/pagination');
const router = express.Router();
const blogPostService = require('../../../services/admin/blogPostService');
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

/**
 * GET /api/v1/admin/blog/posts
 * List all blog posts (admin view — includes drafts)
 * Query params: status (comma-separated), category (comma-separated),
 *               search, page, limit, dateFrom, dateTo, sortField, sortOrder
 */
router.get('/posts', checkPermission('settings.view'), async (req, res) => {
  try {
    const {
      status, category, search, page = 1, limit = 20, dateFrom, dateTo, sortField, sortOrder,
    } = req.query;

    const { posts, total } = await blogPostService.list({
      status, category, search, page, limit, dateFrom, dateTo, sortField, sortOrder,
    });

    res.json({
      success: true,
      posts,
      pagination: meta({ page, limit }, total),
    });
  } catch (err) {
    console.error('Error fetching blog posts:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch blog posts' });
  }
});

/**
 * GET /api/v1/admin/blog/stats
 * Blog statistics
 */
router.get('/stats', checkPermission('settings.view'), async (req, res) => {
  try {
    const stats = await blogPostService.stats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/v1/admin/blog/categories
 * Get distinct categories
 */
router.get('/categories', checkPermission('settings.view'), async (req, res) => {
  try {
    const categories = await blogPostService.distinctCategories();
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/v1/admin/blog/posts/:id
 * Get a single blog post
 */
router.get('/posts/:id', checkPermission('settings.view'), async (req, res) => {
  try {
    const post = await blogPostService.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    res.json({ success: true, post });
  } catch (err) {
    console.error('Error fetching blog post:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch post' });
  }
});

/**
 * POST /api/v1/admin/blog/posts
 * Create a new blog post
 */
router.post('/posts', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      title, slug, excerpt, content, featuredImage,
      category, tags, status, isFeatured, authorName,
      seoTitle, seoDescription,
    } = req.body;

    const post = await blogPostService.create({
      title,
      slug,
      excerpt,
      content,
      featuredImage,
      author: req.user?.id,
      authorName: authorName || req.user?.name || 'Admin',
      category: category || 'General',
      tags: tags || [],
      status: status || 'draft',
      isFeatured: isFeatured || false,
      seoTitle,
      seoDescription,
    });

    res.status(201).json({ success: true, post });
  } catch (err) {
    failure(res, err, 'Failed to create post', { log: 'Error creating blog post' });
  }
});

/**
 * PUT /api/v1/admin/blog/posts/:id
 * Update a blog post
 */
router.put('/posts/:id', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      title, slug, excerpt, content, featuredImage,
      category, tags, status, isFeatured, authorName,
      seoTitle, seoDescription,
    } = req.body;

    const post = await blogPostService.update(req.params.id, {
      title, slug, excerpt, content, featuredImage, category, tags, status, isFeatured, authorName, seoTitle, seoDescription,
    });
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    res.json({ success: true, post });
  } catch (err) {
    failure(res, err, 'Failed to update post', { log: 'Error updating blog post' });
  }
});

/**
 * DELETE /api/v1/admin/blog/posts/:id
 * Delete a blog post
 */
router.delete('/posts/:id', checkPermission('settings.edit'), async (req, res) => {
  try {
    const post = await blogPostService.deleteOne(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (err) {
    console.error('Error deleting blog post:', err);
    res.status(500).json({ success: false, message: 'Failed to delete post' });
  }
});

/**
 * PUT /api/v1/admin/blog/posts/:id/status
 * Toggle blog post status
 */
router.put('/posts/:id/status', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const post = await blogPostService.updateStatus(req.params.id, status);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    res.json({ success: true, post });
  } catch (err) {
    console.error('Error updating post status:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

// POST /admin/blog/posts/bulk-delete — delete multiple blog posts
router.post('/posts/bulk-delete', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide post IDs to delete' });
    }
    const deletedCount = await blogPostService.bulkDelete(ids);
    await activityLogService.logActivity({
      userId: req.userId, userName: req.user.name, userEmail: req.user.email, userRole: req.user.role,
      action: 'blog_posts_bulk_deleted', actionType: 'delete', targetModel: 'BlogPost',
      description: `Bulk deleted ${deletedCount} blog posts`,
      ipAddress: getClientIP(req), userAgent: req.get('user-agent'), status: 'success',
    });
    res.json({ success: true, message: `${deletedCount} post(s) deleted successfully`, deletedCount });
  } catch (error) {
    console.error('Bulk delete blog posts error:', error);
    res.status(500).json({ success: false, message: 'Error deleting blog posts' });
  }
});

module.exports = router;
