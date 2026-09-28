import React from 'react';
import { Spin } from 'antd';
import { useTheme } from '../contexts/ThemeContext';
import { pageBg } from '../theme/colors';

/**
 * Suspense fallback for lazy-loaded routes. Wired in ADMIN-7-POLISH once
 * App.js's 43 eager imports convert to React.lazy(); created now so it is
 * ready and consistent with the rest of this phase's components.
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
      <Spin size="large" />
    </div>
  );
};

export default RouteLoader;
