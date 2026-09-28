import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { SiteProvider, useSite } from './context/SiteContext';
import RedirectHandler from './components/RedirectHandler';
import ScrollToTop from './components/ScrollToTop';
import RouteProgressBar from './components/RouteProgressBar';
import DynamicPage from './pages/DynamicPage';
import BlogListPage from './pages/BlogListPage';
import BlogDetailPage from './pages/BlogDetailPage';
import MaintenancePage from './pages/MaintenancePage';
import config from './config';

// Redirect to customer center immediately — check before React does anything.
// replace() removes this entry from browser history so back button skips it.
// This fast path only covers a hard page load (a typed URL, a bookmark); it
// cannot fire for a client-side route change, which is why ExternalRedirect
// below also redirects itself — buttons all over the site link to bare
// "/signup", and since those now go through React Router's Link for a smooth
// transition rather than a full reload, something inside the route itself
// has to catch that case too.
const AUTH_PATHS = ['/login', '/signup'];
const currentPath = window.location.pathname;
if (AUTH_PATHS.includes(currentPath)) {
  window.location.replace(`${config.customerCenterUrl}${currentPath}${window.location.search}`);
}

const ExternalRedirect = ({ path }) => {
  useEffect(() => {
    window.location.replace(`${config.customerCenterUrl}${path}${window.location.search}`);
  }, [path]);
  return null;
};

function App() {
  return (
    <SiteProvider>
      <AppContent />
    </SiteProvider>
  );
}

const AppContent = () => {
  const { site, loading } = useSite();

  if (loading) return null;

  if (site?.maintenance?.enabled) {
    return <MaintenancePage message={site?.maintenance?.message} siteName={site?.companyName || site?.siteName} />;
  }

  return (
    <Router>
      <ScrollToTop />
      <RouteProgressBar />
      <RedirectHandler />
      <AnimatedRoutes />
    </Router>
  );
};

/**
 * Keying this div by pathname forces React to remount it — and so replay the
 * `page-fade-in` animation — on every route change. Page content is already
 * cache-warm by the time a click happens (see SiteContext's prefetch and
 * dataCache), so the remount costs nothing visible; what the visitor sees is
 * a deliberate cross-fade instead of an instant, jarring swap.
 */
const AnimatedRoutes = () => {
  const location = useLocation();
  return (
    <div key={location.pathname} className="page-transition">
      <Routes location={location}>
        {/* Auth pages — redirect to customer center */}
        <Route path="/login" element={<ExternalRedirect path="/login" />} />
        <Route path="/signup" element={<ExternalRedirect path="/signup" />} />
        {/* Blog pages (before catch-all) */}
        <Route path="/blog" element={<BlogListPage />} />
        <Route path="/blog/:slug" element={<BlogDetailPage />} />
        {/* Homepage */}
        <Route path="/" element={<DynamicPage isHome />} />
        {/* All other pages by slug */}
        <Route path="/:slug" element={<DynamicPage />} />
      </Routes>
    </div>
  );
};

export default App;