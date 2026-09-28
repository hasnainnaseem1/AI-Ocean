const express = require('express');
const { meta } = require('../../../utils/helpers/pagination');
const router = express.Router();
const blogPostService = require('../../../services/admin/blogPostService');

/**
 * GET /api/v1/public/blog/posts
 * List published blog posts with search, category filter, pagination, sorting
 */
router.get('/posts', async (req, res) => {
  try {
    const {
      search,
      category,
      tag,
      sort = 'latest', // latest | popular | featured
      page = 1,
      limit = 9,
    } = req.query;
    const { posts, total } = await blogPostService.listPublished({
      search, category, tag, sort, page, limit,
    });

    res.json({
      success: true,
      posts,
      pagination: meta({ page, limit }, total),
    });
  } catch (err) {
    console.error('Error fetching public blog posts:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch blog posts' });
  }
});

/**
 * GET /api/v1/public/blog/popular
 * Get top 5 most popular posts
 */
router.get('/popular', async (req, res) => {
  try {
    const posts = await blogPostService.listPopular(5);
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch popular posts' });
  }
});

/**
 * GET /api/v1/public/blog/categories
 * Get all categories with post counts
 */
router.get('/categories', async (req, res) => {
  try {
    const categories = await blogPostService.categoryCounts();
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/v1/public/blog/posts/:slug
 * Get a single published blog post by slug (increments views)
 */
router.get('/posts/:slug', async (req, res) => {
  try {
    const post = await blogPostService.incrementViews(req.params.slug);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Also fetch related posts (same category, excluding current)
    const related = await blogPostService.listRelated(post.category, post.id, 3);

    res.json({ success: true, post, related });
  } catch (err) {
    console.error('Error fetching blog post:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch post' });
  }
});

module.exports = router;
