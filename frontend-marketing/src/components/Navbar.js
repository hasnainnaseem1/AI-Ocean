import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useSite } from '../context/SiteContext';
import config from '../config';

/**
 * Site header.
 *
 * Deliberately quiet: a hairline rule instead of a drop shadow, the brand name
 * in plain ink instead of gradient text, and a single solid accent button. The
 * customer center a visitor lands in after signing up looks like this, and an
 * auth screen that suddenly changes visual language reads as a different site.
 *
 * Nav items come from the pages an admin marked "show in navigation" — nothing
 * here is a hardcoded route.
 */
const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { site, navigation, loading } = useSite();

  const brandName = site.companyName || site.siteName || '';
  const linkClass = 'mkt-muted hover:opacity-70 font-medium text-[15px] transition-opacity';

  if (loading) {
    return (
      <nav className="sticky top-0 z-50" style={{ background: 'rgba(14,17,32,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--surface-border)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"><div className="h-16" /></div>
      </nav>
    );
  }

  return (
    <nav
      className="sticky top-0 z-50"
      style={{ background: 'rgba(14,17,32,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--surface-border)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link to="/" className="flex items-center gap-2.5">
            {site.logoUrl ? (
              <img src={site.logoUrl} alt={brandName} className="h-8 w-auto" />
            ) : (
              <span
                className="flex items-center justify-center w-9 h-9 font-bold text-[17px]"
                style={{ background: 'var(--color-primary)', borderRadius: 10, color: '#0B0E18' }}
              >
                {(brandName || '?').charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-[19px] font-bold mkt-ink tracking-tight">{brandName}</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {navigation.map((item) => (
              <Link key={item.slug} to={item.path} className={linkClass}>
                {item.label}
              </Link>
            ))}
            {site.enableLogin !== false && (
              <a href={`${config.customerCenterUrl}/login`} className={linkClass}>Sign in</a>
            )}
            {site.enableCustomerSignup && (
              <a href={`${config.customerCenterUrl}/signup`} className="mkt-btn mkt-btn-primary px-5 py-2.5 text-[15px] ml-1">
                Get started
              </a>
            )}
          </div>

          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
            className="md:hidden p-2 rounded-lg hover:bg-white/10 transition-colors mkt-ink"
          >
            {isMenuOpen ? <X className="w-6 h-6 mkt-ink" /> : <Menu className="w-6 h-6 mkt-ink" />}
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden" style={{ background: 'var(--surface-page)', borderTop: '1px solid var(--surface-border)' }}>
          <div className="px-4 py-4 space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.slug}
                to={item.path}
                className="block mkt-muted font-medium py-2.5"
                onClick={() => setIsMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            {site.enableLogin !== false && (
              <a
                href={`${config.customerCenterUrl}/login`}
                className="block mkt-muted font-medium py-2.5"
                onClick={() => setIsMenuOpen(false)}
              >
                Sign in
              </a>
            )}
            {site.enableCustomerSignup && (
              <a
                href={`${config.customerCenterUrl}/signup`}
                className="mkt-btn mkt-btn-primary block w-full text-center px-6 py-3 mt-2"
                onClick={() => setIsMenuOpen(false)}
              >
                Get started
              </a>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
