import React from 'react';
import { Spin } from 'antd';
import { useTheme } from '../context/ThemeContext';
import { getBrand, pageBg } from '../theme/colors';

/**
 * Suspense fallback for lazy-loaded routes. Each page is its own chunk now
 * (see App.js), so this appears briefly on first navigation to a route —
 * matching the page background keeps that instant from flashing white/black.
 */
const RouteLoader = () => {
  const { isDark } = useTheme();
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: pageBg(isDark),
      }}
    >
      <Spin size="large" style={{ color: getBrand(isDark) }} />
    </div>
  );
};

export default RouteLoader;
