/**
 * SEO Head Manager — utility to inject/update meta tags, structured data,
 * Open Graph, Twitter Cards, canonical URLs, and verification tags.
 */

// Helper: set or create a meta tag
function setMeta(attr, attrValue, content) {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${attrValue}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, attrValue);
    document.head.appendChild(el);
  }
  el.content = content;
}

// Helper: set or create a link tag
function setLink(rel, href) {
  if (!href) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

// Helper: set or create a JSON-LD script
function setJsonLd(id, data) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('script');
    el.id = id;
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

// Remove a JSON-LD script
function removeJsonLd(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/**
 * Update page-level SEO meta tags
 */
export function updatePageSeo({
  title,
  description,
  keywords,
  ogImage,
  ogType = 'website',
  canonicalUrl,
  noIndex = false,
  siteName = '',
  url = '',
  twitterHandle = '',
}) {
  /**
   * Title.
   *
   * The site name is only appended when the title does not already carry it —
   * the homepage's title IS the site name, which produced "AI-Ocean | AI-Ocean"
   * on every visit.
   */
  if (title) {
    const alreadyBranded =
      siteName && title.toLowerCase().includes(siteName.toLowerCase());
    document.title = siteName && !alreadyBranded ? `${title} | ${siteName}` : title;
  }

  /**
   * Basic meta.
   *
   * Cleared, not merely skipped, when a page supplies nothing. This is a single
   * page app: the previous page's tags survive a client-side navigation, so a
   * `if (keywords)` guard left one page's keywords attached to the next one —
   * which is how the old product's keywords kept appearing on pages that had none.
   */
  setMeta('name', 'description', description || '');
  if (keywords) {
    setMeta('name', 'keywords', keywords);
  } else {
    document.querySelector('meta[name="keywords"]')?.remove();
  }

  // Robots
  if (noIndex) {
    setMeta('name', 'robots', 'noindex, nofollow');
  } else {
    // Remove noindex if previously set
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta && robotsMeta.content.includes('noindex')) {
      robotsMeta.remove();
    }
  }

  // Canonical URL
  const pageUrl = canonicalUrl || url || window.location.href;
  setLink('canonical', pageUrl);

  // Open Graph
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:type', ogType);
  setMeta('property', 'og:url', pageUrl);
  // Same reasoning as keywords: a stale image from the previous page is worse
  // than none, because it is what a shared link would preview.
  if (ogImage) {
    setMeta('property', 'og:image', ogImage);
  } else {
    document.querySelector('meta[property="og:image"]')?.remove();
    document.querySelector('meta[name="twitter:image"]')?.remove();
  }
  if (siteName) setMeta('property', 'og:site_name', siteName);

  // Twitter Card
  setMeta('name', 'twitter:card', ogImage ? 'summary_large_image' : 'summary');
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', description);
  if (ogImage) setMeta('name', 'twitter:image', ogImage);
  if (twitterHandle) setMeta('name', 'twitter:site', twitterHandle);
}

/**
 * Inject Organization schema (JSON-LD)
 */
export function setOrganizationSchema({ name, url, logo, description, socialLinks = {} }) {
  const sameAs = Object.values(socialLinks).filter(Boolean);
  setJsonLd('schema-organization', {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url,
    ...(logo && { logo }),
    ...(description && { description }),
    ...(sameAs.length > 0 && { sameAs }),
  });
}

/**
 * Inject WebSite schema (JSON-LD) with SearchAction
 */
export function setWebSiteSchema({ name, url }) {
  setJsonLd('schema-website', {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${url}/blog?search={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  });
}

/**
 * Inject Article / BlogPosting schema (JSON-LD)
 */
export function setArticleSchema({
  title,
  description,
  url,
  image,
  author,
  publishedAt,
  modifiedAt,
  siteName,
  siteUrl,
}) {
  setJsonLd('schema-article', {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    ...(description && { description }),
    ...(image && { image }),
    url,
    datePublished: publishedAt,
    ...(modifiedAt && { dateModified: modifiedAt }),
    author: {
      '@type': 'Person',
      name: author || 'Admin',
    },
    publisher: {
      '@type': 'Organization',
      name: siteName || '',
      ...(siteUrl && { url: siteUrl }),
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
  });
}

/**
 * Inject BreadcrumbList schema (JSON-LD)
 */
export function setBreadcrumbSchema(items) {
  // items: [{ name, url }]
  setJsonLd('schema-breadcrumb', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  });
}

/**
 * Remove all page-specific schemas (call on page change)
 */
export function clearPageSchemas() {
  removeJsonLd('schema-article');
  removeJsonLd('schema-breadcrumb');
}

/**
 * Inject Google Analytics 4 script
 */
export function initGoogleAnalytics(measurementId) {
  if (!measurementId || document.getElementById('ga-script')) return;

  const script = document.createElement('script');
  script.id = 'ga-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);

  const inline = document.createElement('script');
  inline.id = 'ga-inline';
  inline.textContent = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${measurementId}');
  `;
  document.head.appendChild(inline);
}

/**
 * Inject verification meta tags
 */
export function setVerificationTags({ google, bing }) {
  if (google) setMeta('name', 'google-site-verification', google);
  if (bing) setMeta('name', 'msvalidate.01', bing);
}

/**
 * Inject custom head scripts from admin settings
 */
export function injectCustomHeadScripts(scriptContent) {
  if (!scriptContent || document.getElementById('custom-head-scripts')) return;

  const container = document.createElement('div');
  container.id = 'custom-head-scripts';
  container.innerHTML = scriptContent;

  // Move script tags to head properly
  const scripts = container.querySelectorAll('script');
  scripts.forEach(oldScript => {
    const newScript = document.createElement('script');
    Array.from(oldScript.attributes).forEach(attr => {
      newScript.setAttribute(attr.name, attr.value);
    });
    newScript.textContent = oldScript.textContent;
    document.head.appendChild(newScript);
  });

  // Move non-script elements (meta tags, link tags, etc.)
  Array.from(container.children).forEach(child => {
    if (child.tagName !== 'SCRIPT') {
      document.head.appendChild(child.cloneNode(true));
    }
  });
}
