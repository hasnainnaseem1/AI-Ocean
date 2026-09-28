const express = require('express');
const router = express.Router();
const marketingPageService = require('../../../services/admin/marketingPageService');
const adminSettingsService = require('../../../services/admin/adminSettingsService');
const { canStoreCards } = require('../../../services/payments/gatewayRegistry');
const teamSettingsService = require('../../../services/team/teamSettingsService');
const languageSettingsService = require('../../../services/i18n/languageSettingsService');

/**
 * GET /api/v1/public/site
 * Get site branding & settings for the marketing website
 */
router.get('/site', async (req, res) => {
  try {
    const settings = await adminSettingsService.getSettings();
    /*
     * Read through the language service rather than off `settings.features`
     * directly — it is what fills in the defaults and drops any language the
     * product no longer ships. `adminSettingsService` applies defaults only
     * when it first creates the row, so a settings object read here can be
     * missing the block entirely.
     */
    const languageSettings = await languageSettingsService.getLanguageSettings();
    res.json({
      success: true,
      site: {
        // General fields are top-level in AdminSettings
        siteName: settings.siteName || '',
        siteDescription: settings.siteDescription || '',
        contactEmail: settings.contactEmail || '',
        supportEmail: settings.supportEmail || '',
        // Theme / Branding (nested under themeSettings)
        primaryColor: settings.themeSettings?.primaryColor || '#7c3aed',
        secondaryColor: settings.themeSettings?.secondaryColor || '#3b82f6',
        accentColor: settings.themeSettings?.accentColor || '#f59e0b',
        logoUrl: settings.themeSettings?.logoUrl || '',
        logoSmallUrl: settings.themeSettings?.logoSmallUrl || '',
        faviconUrl: settings.themeSettings?.faviconUrl || '',
        companyName: settings.themeSettings?.companyName || settings.themeSettings?.appName || settings.siteName || '',
        appTagline: settings.themeSettings?.appTagline || '',
        appDescription: settings.themeSettings?.appDescription || '',
        // Feature flags (nested under features)
        enableCustomerSignup: settings.features?.enableCustomerSignup !== false,
        enableLogin: settings.features?.enableLogin !== false,
        enableModelCatalog: settings.features?.enableModelCatalog !== false,
        enableDeployments: settings.features?.enableDeployments !== false,
        enablePlayground: settings.features?.enablePlayground === true,
        /**
         * Which languages this platform offers.
         *
         * Full descriptors rather than bare codes, so the language menu can
         * render a native name and know a script's direction without the
         * client keeping its own copy of a list the admin controls. `dir` in
         * particular must come from here: the server decides which languages
         * exist, so it should also be the one saying which of them are
         * right-to-left.
         */
        languages: {
          enabled: languageSettingsService.enabledDescriptors(languageSettings),
          default: languageSettings.default,
          firstVisitPromptEnabled: languageSettings.firstVisitPromptEnabled,
        },
        // Whether customers may create and join teams — decides if signup asks
        // "just me / my team" and whether any team entry point is shown.
        teams: { enabled: (await teamSettingsService.getTeamSettings()).enabled },
        // Credit-wallet parameters the frontends need to render billing UI
        billing: {
          currency: settings.billingSettings?.currency || 'USD',
          topUpPresets: settings.billingSettings?.topUpPresets || [25, 50, 100, 250],
          minTopUp: settings.billingSettings?.minTopUp ?? 10,
          maxTopUp: settings.billingSettings?.maxTopUp ?? 5000,
          lowBalanceThreshold: settings.billingSettings?.lowBalanceThreshold ?? 10,
          // Whether the deploy flow offers "build your own machine". Sent here
          // so the frontend can leave the button out entirely when the admin
          // has it off, rather than showing one that can only return a 403.
          customBuildEnabled: settings.billingSettings?.customBuild?.enabled !== false,
        },
        /**
         * Saving a card on file only works through gateways that can
         * structurally do it — Stripe and Polar, not LemonSqueezy (a
         * merchant-of-record with no API for storing a payment method or
         * charging one later) — read from gatewayRegistry.canStoreCards so a
         * future gateway only needs an entry there, not a new check here. So
         * `cardGateAvailable` is false whenever the active gateway can't do
         * this at all, or (Stripe specifically) hasn't had its publishable
         * key configured yet — every frontend hides card-on-file UI rather
         * than showing a form that can only ever fail. The secret key never
         * appears here — only the publishable key, which is meant for the
         * browser, and only for Stripe: Polar's card flow is a server-driven
         * portal redirect and needs no client-side key at all.
         */
        payments: (() => {
          const activeGateway = settings.activePaymentGateway || 'stripe';
          const cardGateAvailable = activeGateway === 'stripe'
            ? !!settings.stripeSettings?.publicKey
            : canStoreCards(activeGateway);
          return {
            activeGateway,
            cardGateAvailable,
            stripePublishableKey: activeGateway === 'stripe' ? (settings.stripeSettings?.publicKey || '') : '',
          };
        })(),
        // Google SSO (only expose clientId when enabled — never expose clientSecret)
        googleSSO: {
          enabled: settings.googleSSOSettings?.enabled || false,
          clientId: settings.googleSSOSettings?.enabled ? (settings.googleSSOSettings?.clientId || '') : '',
        },
        // Maintenance mode
        maintenance: {
          enabled: settings.maintenanceMode?.enabled || false,
          message: settings.maintenanceMode?.message || 'We are currently performing maintenance. Please check back soon.',
        },
      },
    });
  } catch (err) {
    console.error('Error fetching site settings:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch site settings' });
  }
});

/**
 * GET /api/v1/public/navigation
 * Get navigation links for the marketing website
 */
router.get('/navigation', async (req, res) => {
  try {
    const pages = await marketingPageService.listForNavigation();

    const navigation = pages.map(p => ({
      label: p.navigationLabel || p.title,
      slug: p.slug,
      path: p.isHomePage ? '/' : `/${p.slug}`,
    }));

    res.json({ success: true, navigation });
  } catch (err) {
    console.error('Error fetching navigation:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch navigation' });
  }
});

/**
 * GET /api/v1/public/pages
 * Get all published pages (minimal data for routing)
 */
router.get('/pages', async (req, res) => {
  try {
    const pages = await marketingPageService.listPublishedForRouting();

    res.json({ success: true, pages });
  } catch (err) {
    console.error('Error fetching pages:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pages' });
  }
});

/**
 * GET /api/v1/public/pages/:slug
 * Get a single published page by slug (full content)
 */
router.get('/pages/:slug', async (req, res) => {
  try {
    const page = await marketingPageService.findBySlug(req.params.slug, { publishedOnly: true });

    if (!page) {
      return res.status(404).json({ success: false, message: 'Page not found' });
    }

    // Filter out hidden blocks
    const { lastEditedBy, ...rest } = page;
    const visibleBlocks = page.blocks.filter(b => b.visible !== false);

    res.json({
      success: true,
      page: {
        ...rest,
        blocks: visibleBlocks,
      },
    });
  } catch (err) {
    console.error('Error fetching page:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch page' });
  }
});

/**
 * GET /api/v1/public/pages/home
 * Get the homepage
 */
router.get('/home', async (req, res) => {
  try {
    const page = await marketingPageService.findHomepage();

    if (!page) {
      return res.status(404).json({ success: false, message: 'Homepage not configured' });
    }

    const { lastEditedBy, ...rest } = page;
    const visibleBlocks = page.blocks.filter(b => b.visible !== false);

    res.json({
      success: true,
      page: {
        ...rest,
        blocks: visibleBlocks,
      },
    });
  } catch (err) {
    console.error('Error fetching homepage:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch homepage' });
  }
});

module.exports = router;
