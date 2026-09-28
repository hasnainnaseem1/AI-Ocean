import React, { useEffect } from 'react';
import { Layout, Button, Input, Tooltip } from 'antd';
import { MenuUnfoldOutlined, SearchOutlined, SunOutlined, MoonOutlined } from '@ant-design/icons';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../contexts/ThemeContext';
import NotificationsDropdown from '../common/NotificationsDropdown';
import { SURFACE, ADMIN_DENSITY, muted, hairline } from '../../theme/colors';

const { Header } = Layout;

/**
 * The top bar.
 *
 * Deliberately quiet: a three-column grid whose only permanent contents are a
 * search affordance and the notification bell. The account identity that used
 * to live here has moved to the bottom of the sidebar, which is where the
 * customer center keeps it — the header is about the page you are on, not
 * about who you are.
 *
 * The search box is a stub until the next phase, where it becomes the visible
 * entry point to the Ctrl+K command palette. It is rendered read-only rather
 * than as a working input so it cannot accept text that goes nowhere.
 */
const AppHeader = ({ collapsed, setCollapsed, broken, onOpenSearch }) => {
  const { user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  // Keep the stored timezone in step with the user record — other parts of the
  // app format dates from localStorage rather than re-reading the user.
  useEffect(() => {
    if (user?.timezone) localStorage.setItem('userTimezone', user.timezone);
  }, [user?.timezone]);

  const surfaceBg = isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight;
  const borderColor = hairline(isDark);
  const mutedColor = muted(isDark);

  return (
    <Header
      style={{
        height: ADMIN_DENSITY.headerHeight,
        lineHeight: `${ADMIN_DENSITY.headerHeight}px`,
        padding: '0 16px',
        background: surfaceBg,
        borderBottom: `1px solid ${borderColor}`,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {/* Left — the expand control only matters once the sider has collapsed
          to zero width on a narrow screen; otherwise the sider owns it. */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {broken && collapsed && (
          <Button
            type="text"
            icon={<MenuUnfoldOutlined />}
            onClick={() => setCollapsed(false)}
            aria-label="Open menu"
          />
        )}
      </div>

      {/* Centre — search */}
      <div style={{ width: 'min(380px, 42vw)' }}>
        <Input
          className="header-search"
          readOnly
          onClick={onOpenSearch}
          prefix={<SearchOutlined style={{ color: mutedColor }} />}
          placeholder="Search pages, customers, models…"
          suffix={
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: mutedColor,
                border: `1px solid ${borderColor}`,
                borderRadius: 5,
                padding: '1px 6px',
                whiteSpace: 'nowrap',
              }}
            >
              Ctrl K
            </span>
          }
          style={{
            background: isDark ? 'rgba(255,255,255,0.05)' : SURFACE.pageBgLight,
            borderRadius: 999,
            cursor: 'pointer',
          }}
        />
      </div>

      {/* Right — theme toggle + notifications. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        <Tooltip title={isDark ? 'Light Mode' : 'Dark Mode'}>
          <Button
            type="text"
            shape="circle"
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleTheme}
            style={{ fontSize: 15, color: mutedColor, width: 32, height: 32 }}
          />
        </Tooltip>
        <Tooltip title="Notifications">
          <span>
            <NotificationsDropdown />
          </span>
        </Tooltip>
      </div>
    </Header>
  );
};

export default AppHeader;
