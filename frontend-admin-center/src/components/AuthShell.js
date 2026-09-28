import React from 'react';
import { Typography, Grid } from 'antd';
import { ArrowLeftOutlined, ThunderboltFilled } from '@ant-design/icons';
import { useTheme } from '../contexts/ThemeContext';
import { getBrand, pageBg, muted } from '../theme/colors';

const { Title, Text } = Typography;

/**
 * Shared wrapper for the auth screens — login, forgot password, reset password.
 *
 * A split layout: the form on the left, a brand panel on the right that
 * carries the identity. This replaces the full-screen purple gradient card
 * those three pages each drew for themselves, which was the most obviously
 * dated surface in the app and the source of ~30 hardcoded hex values.
 *
 * Ported from the customer center's AuthShell with two changes for this app:
 * there is no SiteContext here, so the name and tagline are literals rather
 * than fetched; and there is no theme toggle yet — dark mode is still being
 * swept in, and a toggle on the login screen would let someone flip to dark
 * and then land in an app that is only half-converted.
 */
const AuthShell = ({ maxWidth = 420, title, subtitle, children }) => {
  const { isDark } = useTheme();
  const screens = Grid.useBreakpoint();
  const showBrandPanel = screens.md;

  const brand = getBrand(isDark);
  const marketingUrl = process.env.REACT_APP_MARKETING_URL;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: pageBg(isDark) }}>
      {/* ── Form panel ── */}
      <div
        style={{
          flex: showBrandPanel ? '1 1 55%' : '1 1 100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {marketingUrl && (
          <div style={{ padding: '24px 32px 0' }}>
            <a
              href={marketingUrl}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13.5,
                fontWeight: 500,
                color: muted(isDark),
                textDecoration: 'none',
              }}
            >
              <ArrowLeftOutlined style={{ fontSize: 12 }} />
              Back to site
            </a>
          </div>
        )}

        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 32px',
          }}
        >
          <div style={{ width: '100%', maxWidth }}>
            {title && (
              <div style={{ marginBottom: 26 }}>
                <Title level={3} style={{ margin: 0 }}>{title}</Title>
                {subtitle && (
                  <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
                    {subtitle}
                  </Text>
                )}
              </div>
            )}
            {children}
          </div>
        </div>
      </div>

      {/* ── Brand panel ── */}
      {showBrandPanel && (
        <div
          style={{
            flex: '1 1 45%',
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(160deg, #11152B 0%, #1B2360 55%, #30409E 100%)',
          }}
        >
          {/* Faint grid — reads as graph paper at a glance rather than as a pattern */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), '
                + 'linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
            }}
          />
          <div
            style={{
              position: 'absolute', width: 260, height: 260, borderRadius: 28,
              background: `${brand}33`, filter: 'blur(10px)', top: -60, right: -60,
            }}
          />
          <div
            style={{
              position: 'absolute', width: 180, height: 180, borderRadius: 24,
              background: 'rgba(255,255,255,0.05)', bottom: 60, left: -40,
            }}
          />

          <div
            style={{
              position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 48,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 48, height: 48, borderRadius: 14,
                  background: 'rgba(255,255,255,0.14)',
                  color: '#fff', fontSize: 21,
                }}
              >
                <ThunderboltFilled />
              </div>
              <Title level={3} style={{ margin: 0, color: '#fff' }}>Admin Center</Title>
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.72)', maxWidth: 320, fontSize: 14.5 }}>
              Platform operations, customers, infrastructure and billing — in one place.
            </Text>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthShell;
