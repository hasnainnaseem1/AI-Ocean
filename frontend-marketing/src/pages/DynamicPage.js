import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import BlockRenderer from '../components/BlockRenderer';
import { useSite } from '../context/SiteContext';
import { updatePageSeo, setBreadcrumbSchema, clearPageSchemas } from '../utils/seoHelpers';
import { getCached, isStale, setCached } from '../utils/dataCache';
import config from '../config';

const applySeo = (pageData, { isHome, site, seo }) => {
  const pageTitle = pageData.metaTitle || pageData.title;
  const pageDesc = pageData.metaDescription || pageData.description || '';
  const pageUrl = isHome ? window.location.origin : `${window.location.origin}/${pageData.slug}`;
  const ogImage = pageData.ogImage || seo.defaultOgImage || '';

  updatePageSeo({
    // The homepage used to be forced to the bare site name, throwing away the
    // metaTitle an admin wrote for it — which is the single most valuable
    // title on the site for search. Its own title wins; the site name is
    // only the fallback.
    title: isHome ? (pageTitle || site.siteName) : pageTitle,
    description: pageDesc,
    keywords: pageData.metaKeywords || '',
    ogImage,
    ogType: 'website',
    canonicalUrl: pageData.canonicalUrl || pageUrl,
    noIndex: pageData.noIndex || false,
    siteName: site.siteName || '',
    url: pageUrl,
    twitterHandle: seo.socialLinks?.twitter || '',
  });

  if (!isHome) {
    setBreadcrumbSchema([
      { name: 'Home', url: window.location.origin },
      { name: pageData.title, url: pageUrl },
    ]);
  }
};

const DynamicPage = ({ isHome = false }) => {
  const { slug } = useParams();
  const { site, seo } = useSite();
  const cacheKey = isHome ? '__home__' : `page:${slug}`;
  const [page, setPage] = useState(() => getCached(cacheKey) ?? null);
  const [loading, setLoading] = useState(() => !getCached(cacheKey));
  const [error, setError] = useState(false);

  useEffect(() => {
    const cachedPage = getCached(cacheKey);

    // A cache hit renders (and applies SEO) immediately — no spinner, no
    // blank flash. This is what makes clicking between nav links feel like a
    // real multi-page site instead of a reload every time.
    if (cachedPage) {
      setPage(cachedPage);
      setError(false);
      setLoading(false);
      applySeo(cachedPage, { isHome, site, seo });
      if (!isStale(cacheKey)) return undefined; // fresh enough — skip the network entirely
      // else fall through and quietly revalidate in the background
    } else {
      setLoading(true);
    }

    let cancelled = false;
    clearPageSchemas();

    const fetchPage = async () => {
      try {
        const url = isHome
          ? `${config.apiUrl}/api/v1/public/marketing/home`
          : `${config.apiUrl}/api/v1/public/marketing/pages/${slug}`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;

        if (data.success && data.page) {
          setCached(cacheKey, data.page);
          setPage(data.page);
          setError(false);
          applySeo(data.page, { isHome, site, seo });
        } else if (!cachedPage) {
          setError(true);
        }
      } catch (err) {
        console.error('Failed to fetch page:', err);
        if (!cachedPage) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPage();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isHome, cacheKey, site.siteName]);

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--surface-page)' }}>
        <Navbar />
        <div className="flex items-center justify-center py-40">
          <div
            className="animate-spin rounded-full h-10 w-10"
            style={{ border: '2px solid var(--surface-border)', borderBottomColor: 'var(--color-primary)' }}
          />
        </div>
        <Footer />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--surface-page)' }}>
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-40 text-center">
          <div className="text-[64px] font-bold tracking-tight mb-2" style={{ color: 'var(--surface-border)' }}>404</div>
          <h1 className="text-2xl font-bold mkt-ink mb-3">Page not found</h1>
          <p className="mkt-muted mb-8">
            The page you&apos;re looking for doesn&apos;t exist or has been removed.
          </p>
          <a href="/" className="mkt-btn mkt-btn-primary inline-block px-7 py-3.5 text-[15px]">
            Go home
          </a>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-page)' }}>
      <Navbar />
      <main>
        <BlockRenderer blocks={page.blocks || []} />
      </main>
      {page.customCSS && <style>{page.customCSS}</style>}
      <Footer />
    </div>
  );
};

export default DynamicPage;
