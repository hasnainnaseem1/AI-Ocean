import React, { createContext, useContext, useState, useEffect } from 'react';
import config from '../config';
import {
  setOrganizationSchema,
  setWebSiteSchema,
  initGoogleAnalytics,
  setVerificationTags,
  injectCustomHeadScripts,
} from '../utils/seoHelpers';
import { setCached } from '../utils/dataCache';

const SiteContext = createContext({});

export const useSite = () => useContext(SiteContext);

// Helper: convert hex color to comma-separated RGB for use in rgba()
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '112, 137, 245'; // #7089F5 — same fallback as every other colour default here
};

export const SiteProvider = ({ children }) => {
  const [site, setSite] = useState({
    siteName: '',
    siteDescription: '',
    contactEmail: '',
    supportEmail: '',
    primaryColor: '#7089F5',
    secondaryColor: '#6EA8FE',
    accentColor: '#B79CF0',
    logoUrl: '',
    faviconUrl: '',
    companyName: '',
    appTagline: '',
    appDescription: '',
    enableCustomerSignup: true,
    enableLogin: true,
    maintenance: { enabled: false, message: '' },
  });
  const [navigation, setNavigation] = useState([]);
  const [pages, setPages] = useState([]);
  const [seo, setSeo] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSiteData = async () => {
      try {
        const [siteRes, navRes, pagesRes, seoRes] = await Promise.all([
          fetch(`${config.apiUrl}/api/v1/public/marketing/site`).then(r => r.json()),
          fetch(`${config.apiUrl}/api/v1/public/marketing/navigation`).then(r => r.json()),
          fetch(`${config.apiUrl}/api/v1/public/marketing/pages`).then(r => r.json()),
          fetch(`${config.apiUrl}/api/v1/public/seo/settings`).then(r => r.json()),
        ]);

        if (siteRes.success) setSite(siteRes.site);
        if (navRes.success) setNavigation(navRes.navigation);
        if (pagesRes.success) {
          setPages(pagesRes.pages);
          // Warm the page-content cache for every published page in the
          // background. Without this, DynamicPage only knows a page's full
          // content once its own fetch resolves, so the first click to any
          // page not yet visited still shows the full-page loading state —
          // a visible collapse-and-repaint that reads as a blink even when
          // it only lasts a couple hundred milliseconds. Fetching all of a
          // small, admin-managed page set right after site config loads
          // means that by the time a visitor clicks anywhere, it is already
          // cache-hot.
          pagesRes.pages.forEach((p) => {
            const cacheKey = p.isHomePage ? '__home__' : `page:${p.slug}`;
            const url = p.isHomePage
              ? `${config.apiUrl}/api/v1/public/marketing/home`
              : `${config.apiUrl}/api/v1/public/marketing/pages/${p.slug}`;
            fetch(url)
              .then((r) => r.json())
              .then((data) => { if (data.success && data.page) setCached(cacheKey, data.page); })
              .catch(() => {});
          });
        }
        if (seoRes.success) setSeo(seoRes.seo || {});

        // Update favicon dynamically
        if (siteRes.site?.faviconUrl) {
          // Update all existing favicon/icon links
          const iconLinks = document.querySelectorAll("link[rel*='icon']");
          iconLinks.forEach(link => {
            link.href = siteRes.site.faviconUrl;
          });
          // Also ensure a standard shortcut icon exists
          if (!document.querySelector("link[rel='shortcut icon']")) {
            const newLink = document.createElement('link');
            newLink.rel = 'shortcut icon';
            newLink.href = siteRes.site.faviconUrl;
            document.head.appendChild(newLink);
          }
        }

        // Update page title & meta description
        if (siteRes.site?.siteName) {
          document.title = siteRes.site.siteName;
        }
        if (siteRes.site?.siteDescription) {
          let meta = document.querySelector('meta[name="description"]');
          if (meta) meta.content = siteRes.site.siteDescription;
        }
        // Update theme-color meta
        if (siteRes.site?.primaryColor) {
          let tc = document.querySelector('meta[name="theme-color"]');
          if (tc) tc.content = siteRes.site.primaryColor;
        }

        // === Global SEO Injection ===
        const seoData = seoRes?.seo || {};
        const siteUrl = window.location.origin;

        // Google Analytics
        if (seoData.googleAnalyticsId) {
          initGoogleAnalytics(seoData.googleAnalyticsId);
        }

        // Verification tags
        setVerificationTags({
          google: seoData.googleSearchConsoleVerification,
          bing: seoData.bingVerification,
        });

        // Organization schema
        if (seoData.enableSchemaMarkup !== false) {
          setOrganizationSchema({
            name: siteRes.site?.companyName || siteRes.site?.siteName || '',
            url: siteUrl,
            logo: siteRes.site?.logoUrl || '',
            description: siteRes.site?.siteDescription || '',
            socialLinks: seoData.socialLinks || {},
          });
          setWebSiteSchema({
            name: siteRes.site?.siteName || '',
            url: siteUrl,
          });
        }

        // Custom head scripts (e.g., Facebook Pixel, Hotjar, etc.)
        if (seoData.customHeadScripts) {
          injectCustomHeadScripts(seoData.customHeadScripts);
        }
      } catch (err) {
        console.error('Failed to fetch site data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSiteData();
  }, []);

  // ─── Inject dynamic brand colors as CSS custom properties + overrides ───
  useEffect(() => {
    /**
     * The marketing site is deliberately single-theme dark.
     *
     * It has no light/dark toggle — a marketing site is a composed piece, not an
     * app someone works in all day, so it commits to one visual world. The
     * ground and ink below are the customer center's DARK-mode tokens, which
     * means a visitor who signs up and switches the app to dark sees the same
     * palette they were sold in.
     *
     * The accent still comes from AdminSettings, so an operator can rebrand;
     * only the surfaces are fixed.
     */
    const pc = site.primaryColor || '#7089F5';
    const sc = site.secondaryColor || '#6EA8FE';
    const ac = site.accentColor || '#B79CF0';
    const pcRgb = hexToRgb(pc);
    const scRgb = hexToRgb(sc);
    const acRgb = hexToRgb(ac);

    // Set CSS custom properties on :root
    const root = document.documentElement;
    root.style.setProperty('--color-primary', pc);
    root.style.setProperty('--color-secondary', sc);
    root.style.setProperty('--color-accent', ac);
    root.style.setProperty('--color-primary-rgb', pcRgb);
    root.style.setProperty('--color-secondary-rgb', scRgb);
    root.style.setProperty('--color-accent-rgb', acRgb);

    /**
     * Surface tokens — the customer center's dark-mode values.
     *
     * On a dark ground a drop shadow does nothing, so separation comes from a
     * hairline border and a slightly lifted fill instead. `--surface-alt` is the
     * every-other-section ground: the contrast between it and `--surface-page`
     * is deliberately small, because on dark a strong alternation reads as
     * banding rather than rhythm.
     */
    root.style.setProperty('--surface-page', '#0E1120');
    root.style.setProperty('--surface-alt', '#12162A');
    root.style.setProperty('--surface-card', '#171B2E');
    root.style.setProperty('--surface-card-hover', '#1C2138');
    root.style.setProperty('--surface-border', '#242942');
    root.style.setProperty('--surface-ink', '#E6E8EC');
    root.style.setProperty('--surface-ink-muted', '#9BA1BC');
    root.style.setProperty('--surface-ink-faint', '#8A90AB');
    root.style.setProperty('--surface-radius', '14px');
    /**
     * Two different accent washes, because they carry different content.
     *
     * `--tint-tile` sits behind an ICON, which only has to clear 3:1, so it can
     * be strong enough to read as a coloured tile. `--tint-pill` sits behind
     * 11px BOLD TEXT inside a card, which has to clear 4.5:1 — and a wash that
     * lightens the ground eats exactly the contrast that ground was providing.
     * Measured on this palette: 0.14 gives 4.39 (fails), 0.07 gives 4.85.
     */
    root.style.setProperty('--tint-tile', `rgba(${pcRgb}, 0.14)`);
    root.style.setProperty('--tint-pill', `rgba(${pcRgb}, 0.07)`);
    root.style.setProperty('--brand-gradient', `linear-gradient(135deg, ${sc} 0%, ${pc} 100%)`);
    // A wide, very low-opacity wash used behind heroes and the closing CTA —
    // the atmospheric glow that keeps a dark page from reading as a flat slab.
    root.style.setProperty(
      '--brand-glow',
      `radial-gradient(ellipse 80% 55% at 50% 0%, rgba(${pcRgb}, 0.16), transparent 70%)`
    );

    // Inject / update dynamic stylesheet that overrides Tailwind purple/blue classes
    let styleEl = document.getElementById('dynamic-brand-colors');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'dynamic-brand-colors';
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = `
      /* ═══ Dynamic Brand Color Overrides ═══ */

      /* ── Text colors ── */
      .text-purple-600, .text-purple-500 { color: var(--color-primary) !important; }
      .text-purple-400 { color: var(--color-primary) !important; }
      .text-purple-200 { color: rgba(255,255,255,0.7) !important; }
      .text-purple-100 { color: rgba(255,255,255,0.85) !important; }
      .text-purple-900 { color: var(--color-primary) !important; }

      /* ── Background colors ── */
      .bg-purple-600, .bg-purple-500 { background-color: var(--color-primary) !important; }
      .bg-purple-400 { background-color: rgba(var(--color-primary-rgb), 0.75) !important; }
      .bg-purple-200 { background-color: rgba(var(--color-primary-rgb), 0.2) !important; }
      .bg-purple-100 { background-color: rgba(var(--color-primary-rgb), 0.15) !important; }
      .bg-purple-50  { background-color: rgba(var(--color-primary-rgb), 0.05) !important; }

      /* ── Border colors ── */
      .border-purple-600 { border-color: var(--color-primary) !important; }
      .border-purple-300 { border-color: rgba(var(--color-primary-rgb), 0.4) !important; }
      .border-purple-200 { border-color: rgba(var(--color-primary-rgb), 0.25) !important; }

      /* ── Gradient stops (from = primary, to = secondary) ── */
      .from-purple-600 { --tw-gradient-from: var(--color-primary) !important; }
      .from-purple-400 { --tw-gradient-from: rgba(var(--color-primary-rgb), 0.75) !important; }
      .from-purple-50  { --tw-gradient-from: rgba(var(--color-primary-rgb), 0.05) !important; }
      .to-blue-600, .to-blue-500 { --tw-gradient-to: var(--color-secondary) !important; }
      .to-blue-400 { --tw-gradient-to: rgba(var(--color-secondary-rgb), 0.75) !important; }
      .to-blue-50  { --tw-gradient-to: rgba(var(--color-secondary-rgb), 0.05) !important; }

      /* ── Hover states ── */
      .hover\\:text-purple-600:hover,
      .hover\\:text-purple-500:hover { color: var(--color-primary) !important; }
      .hover\\:text-purple-700:hover { color: var(--color-primary) !important; }
      .hover\\:bg-purple-700:hover { background-color: var(--color-primary) !important; filter: brightness(0.9); }
      .hover\\:bg-purple-600:hover { background-color: var(--color-primary) !important; }
      .hover\\:bg-purple-50:hover  { background-color: rgba(var(--color-primary-rgb), 0.05) !important; }
      .hover\\:border-purple-200:hover { border-color: rgba(var(--color-primary-rgb), 0.25) !important; }
      .hover\\:from-purple-700:hover { --tw-gradient-from: var(--color-primary) !important; }
      .hover\\:to-blue-600:hover { --tw-gradient-to: var(--color-secondary) !important; }

      /* ── Focus states ── */
      .focus\\:ring-purple-500:focus { --tw-ring-color: var(--color-primary) !important; }

      /* ── Group hover ── */
      .group:hover .group-hover\\:text-purple-600 { color: var(--color-primary) !important; }

      /* ── Shadow ── */
      .shadow-purple-200 { --tw-shadow-color: rgba(var(--color-primary-rgb), 0.2) !important; }

      /* ── Prose (blog article links) ── */
      .prose a { color: var(--color-primary) !important; }
      .prose a:hover { color: var(--color-primary) !important; filter: brightness(0.85); }

      /* ── Checkbox / radio accent ── */
      input[type="checkbox"].text-purple-600,
      input[type="radio"].text-purple-600 { accent-color: var(--color-primary) !important; }

      /* ═══ Shared surface classes ═══
         Every block uses these instead of restating the same radius/border
         pair, so retuning the look is a one-place edit. */
      html, body {
        background: var(--surface-page);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }

      /* Display face for headings only. Negative tracking is applied by size,
         not globally: it tightens as type grows and returns to normal at 24px
         and below, where tightening only hurts legibility. */
      h1, h2, h3, .mkt-display {
        font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      }
      h1 { letter-spacing: -1.5px; }
      h2 { letter-spacing: -1px; }
      h3 { letter-spacing: normal; }
      code, pre, .mkt-mono {
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      /* A 2px inset ring rather than a border: it keeps the box model stable
         (no 1px shifting layout) and on a dark ground reads as a lit edge
         instead of an outline. */
      .mkt-card {
        background: var(--surface-card);
        border-radius: var(--surface-radius);
        box-shadow: inset 0 0 0 1.5px var(--surface-border);
        transition: box-shadow 200ms ease, background-color 200ms ease;
      }
      .mkt-card-hover:hover {
        box-shadow: inset 0 0 0 1.5px rgba(var(--color-primary-rgb), 0.55);
        background: var(--surface-card-hover);
      }
      .mkt-tint { background: var(--surface-alt); }
      .mkt-gradient { background: var(--brand-gradient); }
      .mkt-glow { background-image: var(--brand-glow); }

      /* Icon tile — the tile carries the colour so the heading stays plain. */
      .mkt-tile {
        background: var(--tint-tile);
        color: var(--color-primary);
        border-radius: 11px;
      }

      /* Pill buttons, as on the reference site. */
      .mkt-btn {
        border-radius: 999px;
        font-weight: 600;
        transition: filter 160ms ease, border-color 160ms ease, background-color 160ms ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .mkt-btn-primary { background: var(--color-primary); color: #0B0E18; }
      .mkt-btn-primary:hover { filter: brightness(1.10); }
      /* The outline is an inset shadow, not a border, so the button does not
         change size between its two states. On hover the ghost becomes the
         primary — one control, two weights, no third style to maintain. */
      .mkt-btn-ghost {
        background: transparent;
        color: var(--surface-ink);
        box-shadow: inset 0 0 0 1px var(--surface-ink-muted);
      }
      .mkt-btn-ghost:hover {
        background: var(--color-primary);
        color: #0B0E18;
        box-shadow: inset 0 0 0 1px var(--color-primary);
      }

      .mkt-ink { color: var(--surface-ink); }
      .mkt-muted { color: var(--surface-ink-muted); }
      .mkt-faint { color: var(--surface-ink-faint); }

      /* ── Dark-ground corrections for the two hand-built blog pages ──
         Those pages predate the token system and still use Tailwind's
         light-mode utilities; on a dark ground they would render white cards
         and near-black text. Remapping here keeps them in the same world
         without rewriting both files. */
      .bg-white { background-color: var(--surface-card) !important; }
      .bg-gray-50, .bg-gray-100 { background-color: var(--surface-alt) !important; }
      .bg-gray-200 { background-color: var(--surface-border) !important; }
      .text-gray-900, .text-gray-800 { color: var(--surface-ink) !important; }
      .text-gray-700, .text-gray-600 { color: var(--surface-ink-muted) !important; }
      .text-gray-500, .text-gray-400, .text-gray-300 { color: var(--surface-ink-faint) !important; }
      .border-gray-200, .border-gray-300, .border-gray-100 { border-color: var(--surface-border) !important; }
      /* Tailwind's preflight gives a bare \`border\` a near-white default colour,
         which on this ground renders as a bright hairline. The blog's post
         header, related-articles strip and pagination all use bare borders. */
      .border, .border-t, .border-b, .border-l, .border-r { border-color: var(--surface-border) !important; }
      .hover\\:bg-gray-100:hover,
      .hover\\:bg-gray-50:hover,
      .hover\\:bg-gray-200:hover { background-color: var(--surface-card-hover) !important; }
      .prose { color: var(--surface-ink-muted); }
      .prose h1, .prose h2, .prose h3, .prose h4, .prose strong { color: var(--surface-ink); }
      /* prose-code compiles to \`.prose :where(code)\`, so the .bg-gray-100
         remap above never reaches inline code inside an article body. */
      .prose :where(code) {
        background-color: var(--surface-alt) !important;
        color: var(--surface-ink) !important;
      }
    `;
  }, [site.primaryColor, site.secondaryColor, site.accentColor]);

  return (
    <SiteContext.Provider value={{ site, navigation, pages, seo, loading }}>
      {children}
    </SiteContext.Provider>
  );
};

export default SiteContext;
