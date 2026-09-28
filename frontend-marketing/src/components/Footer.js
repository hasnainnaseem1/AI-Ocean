import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, Twitter, Linkedin, Facebook, Instagram, Youtube } from 'lucide-react';
import { useSite } from '../context/SiteContext';
import config from '../config';

function Footer() {
  const { site, navigation, pages, seo, loading } = useSite();
  const brandName = site.companyName || site.siteName || '';
  const year = new Date().getFullYear();
  const socialLinks = seo?.socialLinks || {};
  const socialEnabled = seo?.socialLinksEnabled || {};
  const customSocialLinks = seo?.customSocialLinks || [];

  // Split navigation into product links (non-legal pages)
  const productLinks = navigation.filter(n => !['privacy', 'terms'].includes(n.slug));
  // Legal links — pull from ALL pages (they may have showInNavigation: false)
  const legalLinks = pages
    .filter(p => ['privacy', 'terms'].includes(p.slug))
    .map(p => ({ slug: p.slug, label: p.title, path: `/${p.slug}` }));

  if (loading) return null;

  return (
    // Deep indigo-tinted dark rather than neutral gray-900 — the same ground the
    // customer center uses in dark mode, so the two apps share one palette.
    <footer style={{ background: 'var(--surface-page)', color: 'var(--surface-ink-muted)', borderTop: '1px solid var(--surface-border)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
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
              <span className="text-[19px] font-bold text-white tracking-tight">
                {brandName}
              </span>
            </div>
            <p className="mkt-muted mb-5 max-w-md leading-relaxed">
              {site.appDescription || site.siteDescription || ''}
            </p>
            <div className="flex space-x-4">
              {site.contactEmail && (
                <a href={`mailto:${site.contactEmail}`} className="mkt-muted hover:text-white transition" aria-label="Email">
                  <Mail className="w-5 h-5" />
                </a>
              )}
              {socialLinks.twitter && socialEnabled.twitter !== false && (
                <a href={socialLinks.twitter.startsWith('@') ? `https://twitter.com/${socialLinks.twitter.slice(1)}` : socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="mkt-muted hover:text-white transition" aria-label="Twitter">
                  <Twitter className="w-5 h-5" />
                </a>
              )}
              {socialLinks.facebook && socialEnabled.facebook !== false && (
                <a href={socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="mkt-muted hover:text-white transition" aria-label="Facebook">
                  <Facebook className="w-5 h-5" />
                </a>
              )}
              {socialLinks.linkedin && socialEnabled.linkedin !== false && (
                <a href={socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="mkt-muted hover:text-white transition" aria-label="LinkedIn">
                  <Linkedin className="w-5 h-5" />
                </a>
              )}
              {socialLinks.instagram && socialEnabled.instagram !== false && (
                <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="mkt-muted hover:text-white transition" aria-label="Instagram">
                  <Instagram className="w-5 h-5" />
                </a>
              )}
              {socialLinks.youtube && socialEnabled.youtube !== false && (
                <a href={socialLinks.youtube} target="_blank" rel="noopener noreferrer" className="mkt-muted hover:text-white transition" aria-label="YouTube">
                  <Youtube className="w-5 h-5" />
                </a>
              )}
              {customSocialLinks.map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="mkt-muted hover:text-white transition" aria-label={link.name}>
                  {link.iconUrl ? (
                    <img src={link.iconUrl} alt={link.name} className="w-5 h-5 rounded-sm object-cover" />
                  ) : (
                    <span className="text-xs font-medium">{link.name?.charAt(0)?.toUpperCase()}</span>
                  )}
                </a>
              ))}
            </div>
          </div>

          {/* Product Navigation */}
          <div>
            <h3 className="text-white font-semibold mb-4">Product</h3>
            <ul className="space-y-2">
              {productLinks.map((item) => (
                <li key={item.slug}>
                  <Link to={item.path} className="mkt-muted hover:text-white transition">
                    {item.label}
                  </Link>
                </li>
              ))}
              {site.enableCustomerSignup && (
                <li>
                  <a href={`${config.customerCenterUrl}/signup`} className="mkt-muted hover:text-white transition">
                    Get Started
                  </a>
                </li>
              )}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-white font-semibold mb-4">Legal</h3>
            <ul className="space-y-2">
              {legalLinks.map((item) => (
                <li key={item.slug}>
                  <Link to={item.path} className="mkt-muted hover:text-white transition">
                    {item.label}
                  </Link>
                </li>
              ))}
              {/* Always show contact if there's a contact email */}
              {site.contactEmail && !navigation.some(n => n.slug === 'contact') && (
                <li>
                  <a href={`mailto:${site.contactEmail}`} className="mkt-muted hover:text-white transition">
                    Contact Us
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-10 pt-8 text-center text-sm" style={{ borderTop: '1px solid var(--surface-border)', color: 'var(--surface-ink-faint)' }}>
          <p>&copy; {year} {brandName}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;