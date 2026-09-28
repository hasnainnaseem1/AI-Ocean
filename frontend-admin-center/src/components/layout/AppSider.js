import React, { useMemo, useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Dropdown, Typography, Tooltip, Modal, message, Button } from 'antd';
import {
  ThunderboltFilled,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  SettingOutlined,
  LogoutOutlined,
  KeyOutlined,
  GlobalOutlined,
  UserOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermission } from '../../hooks/usePermission';
import { useAuth } from '../../hooks/useAuth';
import { useFeatures } from '../../contexts/FeatureContext';
import { useTheme } from '../../contexts/ThemeContext';
import { visibleSections, selectedKeyFor } from '../../config/navigation';
import {
  SURFACE, GRADIENT, ADMIN_DENSITY, microLabelStyle, getBrand, ink, muted, hairline,
} from '../../theme/colors';
import { getInitials, formatStatus } from '../../utils/helpers';
import authApi from '../../api/authApi';
import ChangePasswordModal from '../common/ChangePasswordModal';
import TimezoneModal from '../common/TimezoneModal';

const { Sider } = Layout;
const { Text } = Typography;

/**
 * The app's primary navigation.
 *
 * Switches with the theme (see SURFACE.siderBg*), with flat items grouped
 * under uppercase micro-labels rather than the collapsible submenus this
 * used to have — see config/navigation.js for why.
 *
 * The account identity sits at the *bottom* of the sidebar rather than in the
 * header. That is the customer center's arrangement, and it frees the header
 * to be about the current page instead of about who is logged in. It relies on
 * the `.ant-layout-sider-children` flex fix in index.css: antd wraps a Sider's
 * children in a plain block div, so without it `flex: 1` on the scroll region
 * never grows and the dock cannot pin to the bottom.
 */
const AppSider = ({ collapsed, setCollapsed, broken, onBreakpoint }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = usePermission();
  const { features } = useFeatures();
  const { user, logout, updateUserData } = useAuth();
  const { isDark } = useTheme();

  const [logoHover, setLogoHover] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [timezoneModalOpen, setTimezoneModalOpen] = useState(false);

  // Clicking the collapsed logo to expand the sidebar removes that very
  // element from under the cursor — the click that triggers `setCollapsed`
  // unmounts it before a real mouseleave can fire, so `logoHover` is left
  // stuck `true`. Next time the sidebar collapses, the icon then renders
  // already swapped to the hover state with no hover having happened yet.
  // Resetting on every collapse/expand transition closes that gap outright
  // rather than relying on the browser firing a mouseleave it may skip.
  useEffect(() => { setLogoHover(false); }, [collapsed]);

  const sections = useMemo(
    () => visibleSections(hasPermission, features),
    [hasPermission, features]
  );
  const selectedKey = selectedKeyFor(location.pathname, sections);

  // Which section holds the page currently on screen — used both to expand
  // it by default and to keep it open if the admin navigates there some
  // other way (Ctrl+K, a direct link) while it happens to be collapsed.
  const activeSection = sections.find((s) => s.items.some((i) => i.key === selectedKey))?.section;

  // Sections render as an accordion — TailAdmin-style, and the actual fix
  // for this list needing to scroll at all: 26 destinations across 6
  // sections shown flat forced a scrollbar on any normal viewport. Only the
  // section holding the current page starts open; the rest collapse to a
  // single label row. Expanding one leaves any others the admin opened by
  // hand alone, so browsing across sections doesn't fight the admin's clicks.
  const [expandedSections, setExpandedSections] = useState(() => new Set(activeSection ? [activeSection] : []));
  useEffect(() => {
    if (activeSection) {
      setExpandedSections((prev) => (prev.has(activeSection) ? prev : new Set(prev).add(activeSection)));
    }
  }, [activeSection]);
  const toggleSection = (name) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const surfaceBg = isDark ? SURFACE.siderBgDark : SURFACE.siderBgLight;
  const borderColor = hairline(isDark);
  const inkColor = ink(isDark);
  const mutedColor = muted(isDark);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Non-super-admins cannot set their own password; they ask a super admin to
  // reset it. Preserved from the previous header menu.
  const handleRequestPasswordReset = () => {
    Modal.confirm({
      title: 'Request password reset',
      content:
        'Send a password reset request to your Super Admin? You will be notified when your password is reset.',
      okText: 'Yes, request reset',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const data = await authApi.requestPasswordReset();
          message.success(data.message || 'Password reset request sent.');
        } catch (error) {
          message.error(error.response?.data?.message || 'Could not send the reset request.');
        }
      },
    });
  };

  const accountMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: 'My profile', onClick: () => navigate('/profile') },
      user?.role === 'super_admin'
        ? { key: 'change-password', icon: <KeyOutlined />, label: 'Change password', onClick: () => setPasswordModalOpen(true) }
        : { key: 'request-reset', icon: <KeyOutlined />, label: 'Request password reset', onClick: handleRequestPasswordReset },
      { key: 'timezone', icon: <GlobalOutlined />, label: 'Timezone', onClick: () => setTimezoneModalOpen(true) },
    ],
  };

  const identityMenu = {
    items: [
      {
        key: 'who',
        disabled: true,
        label: (
          <div style={{ padding: '2px 0' }}>
            <div style={{ fontWeight: 700, color: inkColor }}>{user?.name}</div>
            <Text style={{ fontSize: 12, color: mutedColor }}>{formatStatus(user?.role)}</Text>
          </div>
        ),
      },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', danger: true, onClick: handleLogout },
    ],
  };

  // Full-width sidebar: one flat Menu per section, shown or hidden as a
  // whole — the section label doubles as its accordion trigger.
  const renderSection = (section) => {
    const isOpen = expandedSections.has(section.section);
    return (
      <div key={section.section}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleSection(section.section)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(section.section); } }}
          style={{
            ...microLabelStyle(isDark),
            fontSize: 10,
            padding: '13px 18px 4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span>{section.section}</span>
          <DownOutlined
            style={{
              fontSize: 9,
              transition: 'transform 140ms ease',
              transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
        </div>
        {isOpen && (
          // Just a whisper of tint behind an open section, not a boxed-off
          // card — full width, no radius, no margin. Enough that the group
          // reads as one region without looking like a panel dropped into
          // the sidebar.
          <Menu
            className="fade-in"
            mode="inline"
            theme={isDark ? 'dark' : 'light'}
            selectedKeys={[selectedKey]}
            items={section.items.map(({ key, icon, label }) => ({ key, icon, label }))}
            onClick={({ key }) => {
              navigate(key);
              if (broken) setCollapsed(true); // on mobile the drawer must close behind you
            }}
            style={{
              background: isDark ? 'rgba(255,255,255,0.012)' : 'rgba(17,24,54,0.015)',
              borderInlineEnd: 'none',
            }}
            inlineIndent={14}
          />
        )}
      </div>
    );
  };

  // Icon-only rail: one icon per SECTION, not per page — antd's own
  // `inlineCollapsed` Menu already does exactly what was asked for here: a
  // parent with `children` shows just its icon, and a click/hover pops the
  // section's pages out as a flyout, rather than every one of the 26
  // destinations getting its own permanently-visible icon. Each section
  // carries its own dedicated `icon` in config/navigation.js — it used to
  // borrow its first child's icon instead, which meant the rail's "Website"
  // glyph was just Pages' plain document icon and didn't read as the section.
  const collapsedMenuItems = useMemo(
    () => sections.map((section) => ({
      key: `section:${section.section}`,
      icon: section.icon,
      label: section.section,
      children: section.items.map(({ key, icon, label }) => ({ key, icon, label })),
    })),
    [sections]
  );

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={ADMIN_DENSITY.siderWidth}
      collapsedWidth={broken ? 0 : ADMIN_DENSITY.siderCollapsedWidth}
      breakpoint="lg"
      onBreakpoint={onBreakpoint}
      theme={isDark ? 'dark' : 'light'}
      style={{
        height: '100vh',
        position: 'sticky',
        top: 0,
        left: 0,
        background: surfaceBg,
        borderRight: `1px solid ${borderColor}`,
      }}
    >
      {/* ── Logo / collapse ── */}
      <div
        style={{
          height: ADMIN_DENSITY.headerHeight,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: collapsed ? 0 : '0 14px',
          justifyContent: collapsed ? 'center' : 'space-between',
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        {collapsed ? (
          // Collapsed, the mark doubles as the expand control — hovering swaps
          // it for the unfold icon so the affordance is discoverable.
          <Tooltip title="Expand menu" placement="right">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setCollapsed(false)}
              onKeyDown={(e) => e.key === 'Enter' && setCollapsed(false)}
              onMouseEnter={() => setLogoHover(true)}
              onMouseLeave={() => setLogoHover(false)}
              style={{
                width: 30, height: 30, borderRadius: 8, background: GRADIENT,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', cursor: 'pointer',
                boxShadow: '0 3px 10px rgba(79,107,237,0.3)',
              }}
            >
              {logoHover ? <MenuUnfoldOutlined /> : <ThunderboltFilled />}
            </div>
          </Tooltip>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 30, height: 30, borderRadius: 8, background: GRADIENT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', flexShrink: 0,
                  boxShadow: '0 3px 10px rgba(79,107,237,0.3)',
                }}
              >
                <ThunderboltFilled />
              </div>
              <span
                style={{
                  fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.02em',
                  color: inkColor, whiteSpace: 'nowrap',
                }}
              >
                Admin Center
              </span>
            </div>
            <Tooltip title="Collapse menu">
              <MenuFoldOutlined
                onClick={() => setCollapsed(true)}
                style={{ color: mutedColor, cursor: 'pointer', fontSize: 14 }}
              />
            </Tooltip>
          </>
        )}
      </div>

      {/* ── Scrolling nav ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 8 }}>
        {collapsed ? (
          <Menu
            mode="inline"
            inlineCollapsed
            theme={isDark ? 'dark' : 'light'}
            selectedKeys={[selectedKey]}
            items={collapsedMenuItems}
            onClick={({ key }) => {
              if (key.startsWith('section:')) return; // the parent itself isn't a route
              navigate(key);
            }}
            style={{ background: 'transparent', borderInlineEnd: 'none' }}
          />
        ) : (
          sections.map(renderSection)
        )}
      </div>

      {/* ── Identity dock ──
          Rail mode stacks the two dropdowns vertically instead of dropping
          the settings gear — same as the customer center's own collapsed
          dock, and pinned to its exact spacing (14px/0 padding, 10px gap, a
          10px-inset border, a Button-wrapped circular gear rather than a
          bare glyph, 36px avatar) rather than an approximation of it. */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${borderColor}`,
          margin: collapsed ? '0 10px' : 0,
          padding: collapsed ? '14px 0' : '10px 12px',
          display: 'flex',
          flexDirection: collapsed ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: collapsed ? 10 : 8,
        }}
      >
        {collapsed && (
          <Dropdown menu={accountMenu} trigger={['click']} placement="topLeft">
            <Tooltip title="Account settings" placement="right">
              <Button type="text" shape="circle" icon={<SettingOutlined />} style={{ color: mutedColor }} />
            </Tooltip>
          </Dropdown>
        )}

        <Dropdown menu={identityMenu} trigger={['click']} placement="topLeft">
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              cursor: 'pointer', minWidth: 0, flex: collapsed ? 'none' : 1,
            }}
          >
            <Avatar
              size={collapsed ? 36 : 32}
              className="avatar-interactive"
              src={user?.avatar || undefined}
              style={{ background: user?.avatar ? 'transparent' : GRADIENT, flexShrink: 0, fontWeight: 700 }}
            >
              {!user?.avatar && (user?.name ? getInitials(user.name) : <UserOutlined />)}
            </Avatar>
            {!collapsed && (
              <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                <div
                  style={{
                    fontSize: 13, fontWeight: 700, color: inkColor,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {user?.name}
                </div>
                <div
                  style={{
                    fontSize: 11.5, color: mutedColor,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {user?.email}
                </div>
              </div>
            )}
          </div>
        </Dropdown>

        {!collapsed && (
          <Dropdown menu={accountMenu} trigger={['click']} placement="topRight">
            <Tooltip title="Account settings">
              <SettingOutlined
                style={{ color: mutedColor, cursor: 'pointer', fontSize: 15, flexShrink: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = getBrand(isDark); }}
                onMouseLeave={(e) => { e.currentTarget.style.color = mutedColor; }}
              />
            </Tooltip>
          </Dropdown>
        )}
      </div>

      <ChangePasswordModal open={passwordModalOpen} onClose={() => setPasswordModalOpen(false)} />
      <TimezoneModal
        open={timezoneModalOpen}
        onClose={() => setTimezoneModalOpen(false)}
        currentTimezone={user?.timezone || 'UTC'}
        onTimezoneChange={(tz) => updateUserData && updateUserData({ timezone: tz })}
      />
    </Sider>
  );
};

export default AppSider;
