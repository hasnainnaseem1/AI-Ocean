const express = require('express');
const router = express.Router();
const adminSettingsService = require('../../../services/admin/adminSettingsService');
const marketingPageService = require('../../../services/admin/marketingPageService');
const blogPostService = require('../../../services/admin/blogPostService');
const seoRedirectService = require('../../../services/admin/seoRedirectService');

/**
 * GET /api/v1/public/seo/sitemap.xml
 * Auto-generated XML sitemap
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    const settings = await adminSettingsService.getSettings();
    if (!settings.seoSettings?.enableSitemap) {
      return res.status(404).send('Sitemap disabled');
    }

    const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}`;
    const now = new Date().toISOString();

    // Fetch all published pages
    const pages = await marketingPageService.listPublished();

    // Fetch all published blog posts
    const posts = await blogPostService.listPublishedForSitemap();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Homepage
    const homePage = pages.find(p => p.isHomePage);
    xml += `  <url>\n`;
    xml += `    <loc>${baseUrl}/</loc>\n`;
    xml += `    <lastmod>${homePage ? homePage.updatedAt.toISOString() : now}</lastmod>\n`;
    xml += `    <changefreq>daily</changefreq>\n`;
    xml += `    <priority>1.0</priority>\n`;
    xml += `  </url>\n`;

    // Marketing pages (excluding homepage & noIndex pages)
    for (const page of pages) {
      if (page.isHomePage || page.noIndex) continue;
      /**
       * /blog gets its own entry below, with a lastmod taken from the newest
       * post and a higher priority. A "Blog" MarketingPage record also exists
       * so the link appears in navigation and carries its own SEO fields —
       * without this guard that record emits a second, duplicate <url>.
       */
      if (page.slug === 'blog') continue;
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/${page.slug}</loc>\n`;
      xml += `    <lastmod>${page.updatedAt.toISOString()}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.8</priority>\n`;
      xml += `  </url>\n`;
    }

    // Blog listing page
    xml += `  <url>\n`;
    xml += `    <loc>${baseUrl}/blog</loc>\n`;
    xml += `    <lastmod>${posts.length > 0 ? posts[0].updatedAt.toISOString() : now}</lastmod>\n`;
    xml += `    <changefreq>daily</changefreq>\n`;
    xml += `    <priority>0.9</priority>\n`;
    xml += `  </url>\n`;

    // Blog posts (excluding noIndex)
    for (const post of posts) {
      if (post.noIndex) continue;
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
      xml += `    <lastmod>${post.updatedAt.toISOString()}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;
    }

    xml += '</urlset>';

    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('Sitemap error:', err);
    res.status(500).send('Failed to generate sitemap');
  }
});

/**
 * GET /api/v1/public/seo/robots.txt
 * Dynamic robots.txt
 */
router.get('/robots.txt', async (req, res) => {
  try {
    const settings = await adminSettingsService.getSettings();
    const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}`;

    // If custom robots.txt content is provided, use it
    if (settings.seoSettings?.robotsTxtCustom) {
      res.set('Content-Type', 'text/plain');
      return res.send(settings.seoSettings.robotsTxtCustom);
    }

    // Default robots.txt
    let content = 'User-agent: *\n';
    content += 'Allow: /\n';
    content += 'Disallow: /api/\n';
    content += 'Disallow: /login\n';
    content += 'Disallow: /signup\n';
    content += '\n';

    // Add noIndex pages as Disallow
    const noIndexPageSlugs = await marketingPageService.listNoIndexSlugs();
    for (const slug of noIndexPageSlugs) {
      content += `Disallow: /${slug}\n`;
    }

    const noIndexPostSlugs = await blogPostService.listNoIndexSlugs();
    for (const slug of noIndexPostSlugs) {
      content += `Disallow: /blog/${slug}\n`;
    }

    content += '\n';
    if (settings.seoSettings?.enableSitemap) {
      content += `Sitemap: ${baseUrl}/api/v1/public/seo/sitemap.xml\n`;
    }

    res.set('Content-Type', 'text/plain');
    res.send(content);
  } catch (err) {
    console.error('Robots.txt error:', err);
    res.status(500).send('Failed to generate robots.txt');
  }
});

/**
 * GET /api/v1/public/seo/settings
 * Public SEO settings (GA ID, verification tags, social links, schema enable)
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await adminSettingsService.getSettings();
    const seo = settings.seoSettings || {};

    res.json({
      success: true,
      seo: {
        googleAnalyticsId: seo.googleAnalyticsId || '',
        googleSearchConsoleVerification: seo.googleSearchConsoleVerification || '',
        bingVerification: seo.bingVerification || '',
        defaultOgImage: seo.defaultOgImage || '',
        socialLinks: seo.socialLinks || {},
        socialLinksEnabled: seo.socialLinksEnabled || { twitter: true, facebook: true, linkedin: true, instagram: true, youtube: true },
        customSocialLinks: (seo.customSocialLinks || []).filter(l => l.enabled),
        enableSchemaMarkup: seo.enableSchemaMarkup !== false,
        customHeadScripts: seo.customHeadScripts || '',
      },
      site: {
        siteName: settings.siteName || '',
        siteDescription: settings.siteDescription || '',
        contactEmail: settings.contactEmail || '',
        logoUrl: settings.themeSettings?.logoUrl || '',
      },
    });
  } catch (err) {
    console.error('SEO settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch SEO settings' });
  }
});

/**
 * GET /api/v1/public/seo/check-redirect
 * Check if a redirect exists for given path
 */
router.get('/check-redirect', async (req, res) => {
  try {
    const { path } = req.query;
    if (!path) return res.json({ success: true, redirect: null });

    const redirect = await seoRedirectService.recordHit(path);
    if (redirect) {
      return res.json({ success: true, redirect });
    }

    res.json({ success: true, redirect: null });
  } catch (err) {
    console.error('Redirect check error:', err);
    res.json({ success: true, redirect: null });
  }
});

module.exports = router;
