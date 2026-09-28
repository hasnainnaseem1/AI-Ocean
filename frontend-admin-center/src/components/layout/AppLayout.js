import React, { useState, useCallback, useEffect } from 'react';
import { Layout, Grid } from 'antd';
import { Outlet, useLocation } from 'react-router-dom';
import AppSider from './AppSider';
import AppHeader from './AppHeader';
import CommandPalette, { openCommandPalette } from '../common/CommandPalette';
import { useTheme } from '../../contexts/ThemeContext';
import { pageBg, ADMIN_DENSITY } from '../../theme/colors';

const { Content } = Layout;

const COLLAPSE_KEY = 'aio_sidebar_collapsed';

const readStoredCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * The authenticated app shell.
 *
 * One structural change matters more than anything cosmetic here: the content
 * area is now transparent. It used to be a single white, rounded, padded
 * surface, which meant every page was drawn *on top of* one big card — so a
 * page's own cards became cards-inside-a-card and the whole app read as a
 * different product from the customer center. Making the content transparent
 * lets each page compose itself *out of* cards against the page background,
 * which is the arrangement the rest of the design system assumes.
 */
const AppLayout = () => {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const [broken, setBroken] = useState(false);
  const { isDark } = useTheme();
  const location = useLocation();
  const screens = Grid.useBreakpoint();

  // Persist the choice — an operator who works collapsed should not have to
  // re-collapse on every visit.
  const updateCollapsed = useCallback((next) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* non-fatal: the preference just won't survive a reload */
    }
  }, []);

  // Below `lg` the sider collapses to zero width and behaves as an overlay,
  // so the header takes over the expand control.
  const isNarrow = broken || screens.lg === false;

  /**
   * `collapsedWidth: 0` only takes effect while the sider is actually
   * collapsed — and nothing was collapsing it. On a phone the sider therefore
   * kept its full ~240px, leaving barely 130px for the page and pushing every
   * table off the right edge of the document.
   *
   * `setCollapsed` rather than `updateCollapsed` on purpose: this is a
   * response to the viewport, not a choice the operator made, so it must not
   * be written to localStorage and follow them back to their desktop.
   */
  useEffect(() => {
    if (isNarrow) setCollapsed(true);
  }, [isNarrow, location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh', background: pageBg(isDark) }}>
      <AppSider
        collapsed={collapsed}
        setCollapsed={updateCollapsed}
        broken={isNarrow}
        onBreakpoint={setBroken}
      />
      <Layout style={{ background: 'transparent' }}>
        <AppHeader
          collapsed={collapsed}
          setCollapsed={updateCollapsed}
          broken={isNarrow}
          onOpenSearch={openCommandPalette}
        />
        <Content style={{ background: 'transparent', overflow: 'visible' }}>
          {/* Keyed on the path so the entrance animation replays per page —
              the same cue the customer center uses to make navigation read as
              a transition rather than a hard cut. */}
          <div
            key={location.pathname}
            className="fade-in"
            style={{ margin: ADMIN_DENSITY.contentMargin, paddingBottom: 24 }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>
      <CommandPalette />
    </Layout>
  );
};

export default AppLayout;
