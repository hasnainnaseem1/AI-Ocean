import React from 'react';
import { Typography, Grid } from 'antd';
import { MoonOutlined, SunOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSite } from '../context/SiteContext';
import { getBrand, pageBg } from '../theme/colors';
import LanguageSwitcher from './LanguageSwitcher';
import config from '../config';

const { Title, Text } = Typography;

const ThemeToggle = ({ isDark, onToggle, dark, label }) => (
  <button
    onClick={onToggle}
    aria-label={label}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 38,
      height: 38,
      borderRadius: '50%',
      cursor: 'pointer',
      fontSize: 16,
      border: dark ? '1px solid rgba(255,255,255,0.18)' : '1px solid #E5E7EB',
      background: dark ? 'rgba(255,255,255,0.12)' : '#FFFFFF',
      color: dark ? '#fff' : '#475467',
    }}
  >
    {isDark ? <SunOutlined /> : <MoonOutlined />}
  </button>
);

/**
 * Shared wrapper for every auth screen (login, signup, forgot/reset password,
 * email verification…). Split layout: a plain form panel on the left, and a
 * brand panel on the right that carries the identity (logo, name, tagline)
 * so individual pages no longer each fetch that themselves — one read of the
 * already app-wide-cached site config here instead of four separate network
 * calls doing the same thing.
 */
const AuthShell = ({ maxWidth = 440, title, subtitle, children }) => {
  const { t } = useTranslation('auth');
  const { isDark, toggleTheme } = useTheme();
  const { siteConfig } = useSite();
  const screens = Grid.useBreakpoint();
  const showBrandPanel = screens.md;

  const brand = getBrand(isDark);
  const siteName = siteConfig?.companyName || siteConfig?.siteName || t('shell.defaultSiteName');
  const tagline = siteConfig?.appTagline || t('shell.defaultTagline');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: pageBg(isDark) }}>
      {/* ── Form panel ── */}
      <div style={{ flex: showBrandPanel ? '1 1 55%' : '1 1 100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '24px 32px 0',
        }}>
          <a
            href={config.marketingUrl}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13.5, fontWeight: 500, color: isDark ? '#9BA1BC' : '#667085',
              textDecoration: 'none',
            }}
          >
            <ArrowLeftOutlined style={{ fontSize: 12 }} />
            {t('shell.backToHome')}
          </a>
          {/*
            * The language switcher lives here on every screen size — this
            * corner was empty on desktop, and someone who cannot read English
            * needs to be able to change language *before* signing in, not
            * after. The choice is kept in this browser and carried onto their
            * account the moment they sign in (see LanguageContext).
            *
            * The theme toggle still only appears here on mobile; on desktop it
            * sits in the brand panel, and moving it would be a different change.
            */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LanguageSwitcher variant="chip" />
            {!showBrandPanel && <ThemeToggle isDark={isDark} onToggle={toggleTheme} dark={false} label={t('shell.toggleTheme')} />}
          </div>
        </div>

        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '40px 32px',
        }}>
          <div style={{ width: '100%', maxWidth }}>
            {title && (
              <div style={{ marginBottom: 28 }}>
                <Title level={3} style={{ margin: 0, fontWeight: 700 }}>{title}</Title>
                {subtitle && (
                  <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>{subtitle}</Text>
                )}
              </div>
            )}
            {children}
          </div>
        </div>
      </div>

      {/* ── Brand panel ── */}
      {showBrandPanel && (
        <div style={{
          flex: '1 1 45%', position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(160deg, #11152B 0%, #1B2360 55%, #30409E 100%)',
        }}>
          {/* Faint grid, the way graph paper reads at a glance rather than a literal pattern */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), '
              + 'linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }} />
          <div style={{
            position: 'absolute', width: 260, height: 260, borderRadius: 28,
            background: `${brand}33`, filter: 'blur(10px)', top: -60, right: -60,
          }} />
          <div style={{
            position: 'absolute', width: 180, height: 180, borderRadius: 24,
            background: 'rgba(255,255,255,0.05)', bottom: 60, left: -40,
          }} />

          <div style={{
            position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 48,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 48, height: 48, borderRadius: 14,
                background: 'rgba(255,255,255,0.14)',
              }}>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 20 }}>
                  {siteName.charAt(0).toUpperCase()}
                </span>
              </div>
              <Title level={3} style={{ margin: 0, color: '#fff' }}>{siteName}</Title>
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.72)', maxWidth: 320, fontSize: 14.5 }}>
              {tagline}
            </Text>
          </div>

          <div style={{ position: 'absolute', bottom: 24, right: 24 }}>
            <ThemeToggle isDark={isDark} onToggle={toggleTheme} dark label={t('shell.toggleTheme')} />
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthShell;
