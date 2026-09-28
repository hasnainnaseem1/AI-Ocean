import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import axiosInstance from '../api/axiosInstance';
import {
  Layout, Menu, Avatar, Dropdown, Button, Typography, Tooltip, Input, Badge, Modal,
} from 'antd';
import {
  DashboardOutlined,
  LogoutOutlined, MoonOutlined, SunOutlined, MenuFoldOutlined,
  MenuUnfoldOutlined, RocketOutlined,
  WalletOutlined, SettingOutlined, AppstoreOutlined,
  CloudServerOutlined,
  HddOutlined, SearchOutlined, BellOutlined, ControlOutlined,
  MessageOutlined, CustomerServiceOutlined,
  CreditCardOutlined, CloseOutlined, SendOutlined, SafetyOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSite } from '../context/SiteContext';
import deploymentsApi from '../api/deploymentsApi';
import TeamSwitcher from './TeamSwitcher';
import { useTeam } from '../context/TeamContext';
import notificationsApi from '../api/notificationsApi';
import { GRADIENT, SURFACE, pageBg, microLabelStyle, STATUS_COLORS } from '../theme/colors';
import { IconTile } from './StatRow';
import { formatRelativeTime } from '../utils/format';
import LanguageSwitcher from './LanguageSwitcher';
import LanguageSelectionModal from './LanguageSelectionModal';
import { useLanguage } from '../context/LanguageContext';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

/**
 * Presentation for a real notification.
 *
 * The backend stores an open vocabulary of ~20 `type` values and no styling,
 * so the icon, tone and section label are derived here from the type. Anything
 * unrecognised still renders — it just gets the neutral treatment rather than
 * being dropped.
 */
const NOTIF_STYLE = [
  [/deployment.*(ready|running|provision)/i, { tone: 'green', icon: <RocketOutlined />, contextKey: 'context.deployments' }],
  [/deployment.*(suspend|paus|stop|reject|fail)/i, { tone: 'pink', icon: <CloudServerOutlined />, contextKey: 'context.deployments' }],
  [/deployment/i, { tone: 'blue', icon: <CloudServerOutlined />, contextKey: 'context.deployments' }],
  [/credit|wallet|balance|payment|invoice|topup|top_up|payg/i, { tone: 'amber', icon: <WalletOutlined />, contextKey: 'context.wallet' }],
  [/model|catalog/i, { tone: 'purple', icon: <AppstoreOutlined />, contextKey: 'context.modelCatalog' }],
  [/account|welcome|verif|password|security/i, { tone: 'blue', icon: <SafetyOutlined />, contextKey: 'context.account' }],
];

const styleFor = (type = '') =>
  (NOTIF_STYLE.find(([re]) => re.test(type)) || [null, { tone: 'blue', icon: <BellOutlined />, contextKey: 'context.updates' }])[1];

/**
 * "5 minutes ago" / "3 hours ago" — and a real date once that stops helping.
 *
 * Was a hand-built ladder of `'just now'`, `` `${mins}m ago` `` and friends,
 * which was English by construction and had no way to become anything else.
 * `Intl.RelativeTimeFormat` knows every language's phrasing and its plural
 * rules, so this is now the same one-line call in all of them.
 */
const timeAgo = (iso) => formatRelativeTime(iso);


/**
 * Nav label with an optional count on the right — matching the reference
 * design's badge treatment. Counts are only ever rendered from real data;
 * a nav item with nothing to report simply shows its label.
 */
const NavLabel = ({ label, count, isDark }) => {
  if (count === null || count === undefined) return label;
  return (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span>{label}</span>
      <span style={{
        fontSize: 11, fontWeight: 700, lineHeight: 1,
        padding: '3px 7px', borderRadius: 6,
        background: isDark ? 'rgba(155,161,188,0.16)' : '#F1F3F9',
        color: isDark ? '#9BA1BC' : '#8A90AB',
      }}>
        {count}
      </span>
    </span>
  );
};

// Every page wraps itself in its own <AppLayout>, so navigating to a
// different page unmounts the old sidebar and mounts a fresh one rather than
// re-rendering a persistent layout — a plain `useState(false)` would forget
// the user just collapsed it. Reading/writing the collapsed flag through
// localStorage carries it across that remount instead.
const SIDEBAR_COLLAPSED_KEY = 'aio_sidebar_collapsed';
const readStoredCollapsed = () => {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

const AppLayout = () => {
  const navigate       = useNavigate();
  const location       = useLocation();
  const { t } = useTranslation('nav');
  const { t: tn } = useTranslation('notifications');
  const { t: tt } = useTranslation('teams');
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { promptFor, dismissPrompt, isRtl, language } = useLanguage();
  const { siteConfig } = useSite();
  const {
    canSeeMoney, isPersonal, can, ready: teamReady, version: teamVersion,
  } = useTeam();
  const [collapsed, setCollapsedState] = useState(readStoredCollapsed);
  const setCollapsed = useCallback((value) => {
    setCollapsedState(value);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0');
    } catch {
      // Ignore — worst case the preference just doesn't persist.
    }
  }, []);
  const [broken, setBroken] = useState(false);
  const [logoHover, setLogoHover] = useState(false);
  // Clicking the collapsed logo to expand the sidebar removes that very
  // element from under the cursor — the click that triggers `setCollapsed`
  // unmounts it before a real mouseleave can fire, so `logoHover` is left
  // stuck `true`. Next time the sidebar collapses, the icon then renders
  // already swapped to the hover state with no hover having happened yet.
  // Resetting on every collapse/expand transition closes that gap outright
  // rather than relying on the browser firing a mouseleave it may skip.
  useEffect(() => { setLogoHover(false); }, [collapsed]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifDetail, setNotifDetail] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(true);
  const [deploymentCount, setDeploymentCount] = useState(null);
  const [search, setSearch] = useState('');

  const catalogEnabled     = siteConfig?.enableModelCatalog !== false;
  const deploymentsEnabled = siteConfig?.enableDeployments !== false;

  // Below the breakpoint, the sidebar hides entirely (collapsedWidth 0)
  // instead of squeezing the content column — a fixed sider on a phone-width
  // screen otherwise forces every card and table into an unreadably narrow
  // column. Navigating away closes it again.
  // `broken` belongs in the dependency list: keyed only on the path, this
  // never fired when the viewport itself crossed the breakpoint, so a phone
  // that loaded straight onto a page kept the full-width sider and squeezed
  // the content column.
  useEffect(() => {
    if (broken) setCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broken, location.pathname]);

  // A single cheap call (limit 1, we only want pagination.total) so the
  // Deployments nav badge shows a real number rather than a decorative one.
  useEffect(() => {
    if (!deploymentsEnabled) return;
    let cancelled = false;
    deploymentsApi.list({ limit: 1 })
      .then((d) => !cancelled && setDeploymentCount(d.pagination?.total ?? null))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [deploymentsEnabled, location.pathname, teamVersion]);

  /**
   * The customer's real notifications. Refreshed on navigation and whenever the
   * bell is opened, so acting somewhere in the app is reflected without a
   * reload. A failure leaves the list empty and simply shows no unread dot —
   * better than inventing something.
   */
  const loadNotifications = useCallback(() => {
    let cancelled = false;
    notificationsApi.list({ limit: 12 })
      .then((d) => {
        if (cancelled) return;
        setNotifications(d.notifications || []);
        setUnreadCount(d.unreadCount || 0);
      })
      .catch(() => { if (!cancelled) setNotifications([]); })
      .finally(() => { if (!cancelled) setNotifLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // `language` is a dependency because the server renders each notification's
  // wording in the reader's language. Without it, switching language would
  // translate the whole app while the bell sat in the old one until the next
  // navigation — the exact half-translated state this feature exists to remove.
  useEffect(loadNotifications, [loadNotifications, location.pathname, language]);

  const openNotification = useCallback((n) => {
    setNotifDetail(n);
    setNotifOpen(false);
    if (n.isRead) return;
    // Optimistic — the bell shouldn't wait on the round trip to stop nagging
    setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    setUnreadCount((c) => Math.max(0, c - 1));
    notificationsApi.markAsRead(n.id).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((list) => list.map((x) => ({ ...x, isRead: true })));
    setUnreadCount(0);
    notificationsApi.markAllAsRead().catch(() => {});
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await axiosInstance.post('/api/v1/auth/customer/logout');
    } catch {
      // Ignore — we still want to clear local state
    }
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const submitSearch = () => {
    const term = search.trim();
    if (!term) return;
    navigate(`/models?q=${encodeURIComponent(term)}`);
    setSearch('');
  };

  /* ── Primary nav — the core product flow, top to bottom ── */
  const featureItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: t('item.overview') },
    ...(catalogEnabled     ? [{ key: '/models',      icon: <AppstoreOutlined />,     label: t('item.models') }] : []),
    // Gated on the same flag as Models: the machine catalogue is served by
    // the same `enableModelCatalog`-protected routes, so showing it while
    // that flag is off would be a nav item that only ever 403s.
    ...(catalogEnabled     ? [{ key: '/machines',    icon: <HddOutlined />,          label: t('item.machineTypes') }] : []),
    ...(deploymentsEnabled ? [{ key: '/deployments', icon: <CloudServerOutlined />,  label: t('item.deployments'), count: deploymentCount }] : []),
    // The team's members and invitations — only inside a team.
    ...(!isPersonal && can('team.view') ? [{ key: '/team', icon: <TeamOutlined />, label: tt('menu.teamSettings') }] : []),
  ];

  const supportItems = [
    { key: 'ticket', icon: <CustomerServiceOutlined />, label: t('item.supportTicket'), isNew: true },
  ];

  // Behind the sidebar's gear icon — account/plan management, separate from
  // the quick sign-out behind the name (mirrors the split most apps use
  // between "who am I" and "manage my account").
  const accountQuickItems = [
    { key: 'profile', icon: <SettingOutlined />, label: t('item.myProfile'), onClick: () => navigate('/settings') },
    // Money pages only for roles that may see this account's money — the
    // server refuses them for the others anyway (Developer / Viewer).
    ...(canSeeMoney ? [
      { key: 'limits', icon: <ControlOutlined />, label: t('item.usageLimits'), onClick: () => navigate('/limits') },
      { key: 'billing', icon: <CreditCardOutlined />, label: t('item.billing'), onClick: () => navigate('/billing') },
    ] : []),
    // Anyone can start an organization later — the signup question was never
    // a one-way door. Shown only while the admin has teams switched on.
    ...(siteConfig?.teams?.enabled ? [{
      key: 'create-org', icon: <TeamOutlined />, label: tt('menu.createOrganization'), onClick: () => navigate('/onboarding/team'),
    }] : []),
  ];

  const surfaceBg   = isDark ? SURFACE.siderBgDark : SURFACE.siderBgLight;
  const borderColor = isDark ? SURFACE.borderDark : SURFACE.borderLight;
  const textMuted   = isDark ? '#9BA1BC' : '#6B7290';
  const textStrong  = isDark ? '#E8EAF4' : '#1B1F35';

  const siderStyle = {
    background:    surfaceBg,
    borderInlineEnd:   `1px solid ${borderColor}`,
    overflow:      'hidden',
    height:        '100vh',
    position:      'sticky',
    top:           0,
    left:          0,
    display:       'flex',
    flexDirection: 'column',
  };

  // Three-column grid rather than flex space-between — a search bar
  // centered with `justify-content` would drift toward whichever side has
  // less content next to it. Two equal 1fr side columns keep the middle
  // (auto-width) column visually centered regardless of what's in them.
  const headerStyle = {
    background:    surfaceBg,
    borderBottom:  `1px solid ${borderColor}`,
    padding:       '0 24px',
    display:       'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems:    'center',
    gap:           16,
    height:        68,
    position:      'sticky',
    top:           0,
    zIndex:        100,
  };

  // Some accounts (test/demo signups) have `name` set to a copy of the
  // email rather than a real display name — showing that same string twice
  // (once as "name", once as "email") reads as a bug, so anywhere identity
  // is displayed, fall back to a single line when there's no distinct name.
  const trimmedName = user?.name?.trim();
  const hasDistinctName = !!trimmedName && trimmedName.toLowerCase() !== user?.email?.toLowerCase();
  const emailLocalPart = user?.email?.split('@')[0] || '';

  const initials = hasDistinctName
    ? trimmedName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : emailLocalPart.slice(0, 2).toUpperCase() || 'U';

  const menuStyle = { background: 'transparent', border: 'none', fontSize: 14, padding: '0 12px' };

  const toMenuItems = (items) =>
    items.map(({ count, label, ...rest }) => ({
      ...rest,
      label: <NavLabel label={label} count={count} isDark={isDark} />,
    }));

  const sectionLabel = (text) => (
    !collapsed && (
      <div style={{ ...microLabelStyle(isDark), padding: '18px 24px 6px', fontSize: 10.5 }}>
        {text}
      </div>
    )
  );

  return (
    <Layout style={{ minHeight: '100vh', background: pageBg(isDark) }}>
      {/* ── Sidebar ── */}
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        breakpoint="lg"
        onBreakpoint={setBroken}
        width={248}
        collapsedWidth={broken ? 0 : 76}
        style={siderStyle}
        theme={isDark ? 'dark' : 'light'}
      >
        {/* Logo — doubles as the sidebar's own expand/collapse trigger
            (matching the reference: hovering the mark while collapsed
            reveals an "open sidebar" affordance, and a close icon sits
            inline next to the wordmark once expanded), so the header no
            longer needs a separate toggle button on desktop. */}
        {collapsed && !broken ? (
          <div style={{ height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Tooltip title={t('sidebar.open')} placement="right">
              <div
                onClick={() => setCollapsed(false)}
                onMouseEnter={() => setLogoHover(true)}
                onMouseLeave={() => setLogoHover(false)}
                style={{
                  width: 34, height: 34, borderRadius: 10, cursor: 'pointer',
                  background: logoHover ? (isDark ? 'rgba(255,255,255,0.08)' : '#EEF2FF') : GRADIENT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: logoHover ? 'none' : '0 4px 12px rgba(79,107,237,0.32)',
                  transition: 'background 120ms ease',
                }}
              >
                {logoHover
                  ? <MenuUnfoldOutlined style={{ color: isDark ? '#A9BBFF' : '#4F6BED', fontSize: 15 }} />
                  : <RocketOutlined style={{ color: '#fff', fontSize: 16 }} />}
              </div>
            </Tooltip>
          </div>
        ) : (
          <div style={{
            height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            // Split into block/inline so the wider gutter stays on the leading
            // edge in both directions; as a 4-value shorthand it would sit on
            // the left in Arabic, where the leading edge is the right.
            paddingBlock: 0, paddingInline: '22px 14px', flexShrink: 0, gap: 11,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: GRADIENT,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(79,107,237,0.32)',
              }}>
                <RocketOutlined style={{ color: '#fff', fontSize: 16 }} />
              </div>
              <Text strong ellipsis style={{ fontSize: 16.5, color: textStrong, letterSpacing: '-0.02em' }}>
                {siteConfig?.siteName || 'AppCenter'}
              </Text>
            </div>
            {!broken && (
              <Tooltip title={t('sidebar.close')}>
                <Button
                  type="text" shape="circle"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setCollapsed(true)}
                  style={{ color: textMuted, flexShrink: 0 }}
                />
              </Tooltip>
            )}
          </div>
        )}

        {/* Which account the app acts on — hidden unless the customer is in a team. */}
        <TeamSwitcher collapsed={collapsed && !broken} />

        {/* ── Primary nav (scrolls independently if it overflows) ── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {sectionLabel(t('section.infrastructure'))}
          <Menu
            mode="inline"
            selectedKeys={[
              featureItems.find((i) => location.pathname.startsWith(i.key) && i.key !== '/')?.key
              || location.pathname,
            ]}
            items={toMenuItems(featureItems)}
            onClick={({ key }) => navigate(key)}
            style={menuStyle}
            theme={isDark ? 'dark' : 'light'}
          />
        </div>

        {/* ── Bottom dock — Support + identity, always flush to the true
             bottom of the sidebar rather than floating under the nav with
             blank space below it. ── */}
        <div style={{ flexShrink: 0 }}>
          {sectionLabel(t('section.support'))}
          {!collapsed && (
            <div style={{ padding: '0 12px 8px' }}>
              {supportItems.map((item) => (
                <div
                  key={item.key}
                  onClick={() => navigate('/support')}
                  className="row-hover"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    borderRadius: 10, padding: '11px 12px',
                    cursor: 'pointer', color: textMuted, fontSize: 14,
                  }}
                >
                  <span style={{ fontSize: 15, display: 'flex' }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.isNew && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                      color: STATUS_COLORS.success.light,
                      background: STATUS_COLORS.success.bg(isDark),
                      padding: '2px 6px', borderRadius: 999,
                    }}>
                      NEW
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* User identity — two separate affordances, same as most apps
              that put a fuller settings surface behind a distinct gear
              icon: the name/avatar opens a quick sign-out, the gear opens
              account/billing. */}
          {user && !collapsed && (
            <div style={{ padding: '10px 12px 14px', borderTop: `1px solid ${borderColor}` }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
              }}>
                <Dropdown
                  trigger={['click']}
                  placement="topLeft"
                  popupRender={() => (
                    <div style={{
                      width: 220, borderRadius: 14, overflow: 'hidden',
                      background: isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight,
                      border: `1px solid ${borderColor}`,
                      boxShadow: '0 8px 24px rgba(30,40,90,0.14)',
                    }}>
                      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${borderColor}` }}>
                        <Text strong ellipsis style={{ display: 'block', fontSize: 13.5, color: textStrong }}>
                          {hasDistinctName ? trimmedName : user.email}
                        </Text>
                        {hasDistinctName && (
                          <Text ellipsis style={{ display: 'block', fontSize: 11.5, color: textMuted, marginTop: 2 }}>
                            {user.email}
                          </Text>
                        )}
                      </div>
                      <div style={{ padding: 6 }}>
                        <div
                          onClick={handleLogout}
                          className="row-hover"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 11,
                            padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
                            fontSize: 13.5, color: '#E5484D', fontWeight: 600,
                          }}
                        >
                          <LogoutOutlined style={{ fontSize: 15 }} />
                          {t("account.signOut")}
                        </div>
                      </div>
                    </div>
                  )}
                >
                  <div className="row-hover" style={{
                    display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
                    cursor: 'pointer', borderRadius: 9, padding: '5px 6px',
                  }}>
                    <Avatar size={34} style={{ background: GRADIENT, fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}>
                      {initials}
                    </Avatar>
                    <div style={{ minWidth: 0 }}>
                      <Text strong ellipsis style={{ display: 'block', fontSize: 13, color: textStrong }}>
                        {hasDistinctName ? trimmedName : user.email}
                      </Text>
                      {hasDistinctName && (
                        <Text ellipsis style={{ display: 'block', fontSize: 11, color: textMuted }}>
                          {user.email}
                        </Text>
                      )}
                    </div>
                  </div>
                </Dropdown>

                <Dropdown
                  trigger={['click']}
                  placement="topRight"
                  popupRender={() => (
                    <div style={{
                      width: 210, borderRadius: 14, overflow: 'hidden', padding: 6,
                      background: isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight,
                      border: `1px solid ${borderColor}`,
                      boxShadow: '0 8px 24px rgba(30,40,90,0.14)',
                    }}>
                      {accountQuickItems.map((item) => (
                        <div
                          key={item.key}
                          onClick={item.onClick}
                          className="row-hover"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 11,
                            padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
                            fontSize: 13.5, color: textStrong,
                          }}
                        >
                          <span style={{ fontSize: 15, display: 'flex', color: textMuted }}>{item.icon}</span>
                          {item.label}
                        </div>
                      ))}
                    </div>
                  )}
                >
                  <Button
                    type="text" shape="circle"
                    icon={<SettingOutlined />}
                    style={{ color: textMuted, flexShrink: 0 }}
                  />
                </Dropdown>
              </div>
            </div>
          )}
          {user && collapsed && !broken && (
            <div style={{
              padding: '14px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              borderTop: `1px solid ${borderColor}`, margin: '0 10px',
            }}>
              <Dropdown
                trigger={['click']}
                placement="topLeft"
                popupRender={() => (
                  <div style={{
                    width: 210, borderRadius: 14, overflow: 'hidden', padding: 6,
                    background: isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight,
                    border: `1px solid ${borderColor}`,
                    boxShadow: '0 8px 24px rgba(30,40,90,0.14)',
                  }}>
                    {accountQuickItems.map((item) => (
                      <div
                        key={item.key}
                        onClick={item.onClick}
                        className="row-hover"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 11,
                          padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
                          fontSize: 13.5, color: textStrong,
                        }}
                      >
                        <span style={{ fontSize: 15, display: 'flex', color: textMuted }}>{item.icon}</span>
                        {item.label}
                      </div>
                    ))}
                  </div>
                )}
              >
                <Button
                  type="text" shape="circle"
                  icon={<SettingOutlined />}
                  style={{ color: textMuted }}
                />
              </Dropdown>

              <Dropdown
                trigger={['click']}
                placement="topLeft"
                popupRender={() => (
                  <div style={{
                    width: 220, borderRadius: 14, overflow: 'hidden',
                    background: isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight,
                    border: `1px solid ${borderColor}`,
                    boxShadow: '0 8px 24px rgba(30,40,90,0.14)',
                  }}>
                    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${borderColor}` }}>
                      <Text strong ellipsis style={{ display: 'block', fontSize: 13.5, color: textStrong }}>
                        {hasDistinctName ? trimmedName : user.email}
                      </Text>
                      {hasDistinctName && (
                        <Text ellipsis style={{ display: 'block', fontSize: 11.5, color: textMuted, marginTop: 2 }}>
                          {user.email}
                        </Text>
                      )}
                    </div>
                    <div style={{ padding: 6 }}>
                      <div
                        onClick={handleLogout}
                        className="row-hover"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 11,
                          padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
                          fontSize: 13.5, color: '#E5484D', fontWeight: 600,
                        }}
                      >
                        <LogoutOutlined style={{ fontSize: 15 }} />
                        {t("account.signOut")}
                      </div>
                    </div>
                  </div>
                )}
              >
                <Avatar className="avatar-interactive" size={36} style={{ background: GRADIENT, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {initials}
                </Avatar>
              </Dropdown>
            </div>
          )}
        </div>
      </Sider>

      <Layout>
        {/* ── Header ── */}
        <Header style={headerStyle}>
          {/* Left — mobile only. On desktop the sidebar's own logo handles
              expand/collapse, and the page's own H1 already names it, so
              there's nothing left for this column to hold. */}
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {broken && (
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                style={{ fontSize: 16, width: 38, height: 38, color: textMuted }}
              />
            )}
          </div>

          {/* Center — search stays the sole focus of the header now that the
              page title and profile identity (already in the sidebar) are
              gone from it. */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {catalogEnabled && !broken && (
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onPressEnter={submitSearch}
                placeholder={t('header.searchPlaceholder')}
                prefix={<SearchOutlined style={{ color: textMuted }} />}
                style={{
                  width: 380, height: 40, borderRadius: 10,
                  background: isDark ? 'rgba(255,255,255,0.04)' : '#F5F7FD',
                  border: 'none',
                }}
                className="header-search"
              />
            )}
            {catalogEnabled && broken && (
              <Button
                type="text" shape="circle"
                icon={<SearchOutlined />}
                onClick={() => navigate('/models')}
                style={{ fontSize: 16, color: textMuted, width: 38, height: 38 }}
              />
            )}
          </div>

          {/* Right — language, theme and notifications; identity now lives
              entirely in the sidebar's own name/gear dropdowns. Language goes
              first because it changes everything else on the screen, and it
              renders nothing at all unless the platform offers more than one. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
            <LanguageSwitcher variant="icon" />

            <Tooltip title={isDark ? t('header.lightMode') : t('header.darkMode')}>
              <Button
                type="text" shape="circle"
                icon={isDark ? <SunOutlined /> : <MoonOutlined />}
                onClick={toggleTheme}
                style={{ fontSize: 16, color: textMuted, width: 38, height: 38 }}
              />
            </Tooltip>

            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              open={notifOpen}
              onOpenChange={setNotifOpen}
              popupRender={() => (
                <div style={{
                  width: 340, borderRadius: 14, overflow: 'hidden',
                  background: isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight,
                  border: `1px solid ${borderColor}`,
                  boxShadow: '0 8px 24px rgba(30,40,90,0.14)',
                  display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{
                    padding: '14px 16px', borderBottom: `1px solid ${borderColor}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  }}>
                    <Text strong style={{ fontSize: 14.5, color: textStrong }}>{tn('title')}</Text>
                    {unreadCount > 0 && (
                      <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={markAllRead}>
                        {tn("markAllRead")}
                      </Button>
                    )}
                  </div>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {notifLoading && (
                      <div style={{ padding: '28px 16px', textAlign: 'center' }}>
                        <Text style={{ fontSize: 12.5, color: textMuted }}>{tn('loading')}</Text>
                      </div>
                    )}
                    {!notifLoading && notifications.length === 0 && (
                      <div style={{ padding: '28px 16px', textAlign: 'center' }}>
                        <Text style={{ fontSize: 12.5, color: textMuted }}>{tn('empty')}</Text>
                      </div>
                    )}
                    {notifications.map((n) => {
                      const s = styleFor(n.type);
                      return (
                        <div
                          key={n.id}
                          onClick={() => openNotification(n)}
                          className="row-hover"
                          style={{
                            display: 'flex', gap: 12, padding: '12px 16px', cursor: 'pointer',
                            background: n.isRead ? 'transparent' : (isDark ? 'rgba(112,137,245,0.08)' : 'rgba(112,137,245,0.05)'),
                          }}
                        >
                          <IconTile icon={s.icon} tone={s.tone} size={36} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{
                              fontSize: 13, fontWeight: n.isRead ? 500 : 600, color: textStrong,
                              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            }}>
                              {n.title}
                            </Text>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 3 }}>
                              <Text style={{ fontSize: 11.5, color: textMuted }}>{tn(s.contextKey)}</Text>
                              <Text style={{ fontSize: 11.5, color: textMuted, whiteSpace: 'nowrap' }}>{timeAgo(n.createdAt)}</Text>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            >
              {/* antd mirrors most things under direction="rtl" but not a
                  Badge offset — the x value is applied as a raw translate, so
                  it has to flip sign or the count drifts off the wrong corner. */}
              <Badge count={unreadCount} size="small" offset={[isRtl ? 4 : -4, 4]}>
                <Button
                  type="text" shape="circle"
                  icon={<BellOutlined />}
                  style={{ fontSize: 16, color: textMuted, width: 38, height: 38 }}
                />
              </Badge>
            </Dropdown>
          </div>
        </Header>

        {/*
          * Asked once, on a customer's first sign-in, when their country
          * suggests another language. Mounted here because it belongs to the
          * signed-in shell and must not appear on the auth screens, where there
          * is no account yet to record the answer against.
          *
          * `promptFor` is null today — nothing in this stack can tell what
          * country a visitor is in. See src/i18n/detectCountry.js.
          */}
        <LanguageSelectionModal
          open={!!promptFor}
          suggested={promptFor}
          onDone={dismissPrompt}
        />

        <Modal
          open={!!notifDetail}
          onCancel={() => setNotifDetail(null)}
          footer={null}
        >
          {notifDetail && (
            <div style={{ paddingTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <IconTile icon={styleFor(notifDetail.type).icon} tone={styleFor(notifDetail.type).tone} size={44} />
                <div>
                  <Text strong style={{ fontSize: 15.5, color: textStrong, display: 'block' }}>{notifDetail.title}</Text>
                  <Text style={{ fontSize: 12.5, color: textMuted }}>
                    {tn(styleFor(notifDetail.type).contextKey)} · {timeAgo(notifDetail.createdAt)}
                  </Text>
                </div>
              </div>
              <Text style={{ fontSize: 13.5, lineHeight: 1.7, color: textStrong }}>{notifDetail.message}</Text>
              {notifDetail.action?.url && (
                <div style={{ marginTop: 20 }}>
                  <Button
                    type="primary"
                    onClick={() => { const url = notifDetail.action.url; setNotifDetail(null); navigate(url); }}
                  >
                    {notifDetail.action.label || tn('open')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Modal>

        {/* ── Main Content ── */}
        <Content
          // Re-mounted per page AND per account, so switching accounts never
          // leaves the previous account's figures on screen.
          key={`${location.pathname}:${teamVersion}`}
          className="fade-in"
          style={{
            margin: '24px 28px',
            minHeight: 'calc(100vh - 116px)',
            /*
             * Room for the floating chat button, which is fixed at bottom: 24
             * and 52px tall. Without this it sits on top of whatever the page
             * ends with — on a deployment's billing history that was the last
             * row's charge, so the one number a customer scrolled down to read
             * was the one covered up.
             */
            paddingBottom: 92,
          }}
        >
          {/* Wait for the account's role before rendering a page, so a page never
              renders for the wrong role and then snaps. */}
          {teamReady ? <Outlet /> : null}
        </Content>
      </Layout>

      {/* ── Floating support chat — lives on the persistent layout, not any
           one page, so it follows the user everywhere. The widget shell is
           ready now; wiring it to a real conversation is a backend task for
           later, so the composer stays visibly not-yet-live rather than
           pretending to send. ── */}
      {chatOpen && (
        <div style={{
          position: 'fixed', right: 24, bottom: 92, zIndex: 1000,
          width: 340, maxHeight: 480, display: 'flex', flexDirection: 'column',
          borderRadius: 16, overflow: 'hidden',
          background: isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight,
          border: `1px solid ${borderColor}`,
          boxShadow: '0 12px 36px rgba(30,40,90,0.20)',
        }}>
          <div style={{
            padding: '14px 16px', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 10,
            background: GRADIENT, color: '#fff',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CustomerServiceOutlined style={{ fontSize: 15 }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ color: '#fff', fontSize: 14, display: 'block' }}>{t('chat.title')}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11.5 }}>{t('chat.subtitle')}</Text>
            </div>
            <Button
              type="text" shape="circle" icon={<CloseOutlined />}
              onClick={() => setChatOpen(false)}
              style={{ color: '#fff', flexShrink: 0 }}
            />
          </div>

          <div style={{
            flex: 1, overflowY: 'auto', padding: 20,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', textAlign: 'center', gap: 8,
          }}>
            <MessageOutlined style={{ fontSize: 28, color: textMuted, opacity: 0.6 }} />
            <Text style={{ color: textStrong, fontSize: 13.5, fontWeight: 600 }}>
              Start a conversation
            </Text>
            <Text style={{ color: textMuted, fontSize: 12.5, maxWidth: 240 }}>
              Live chat isn't connected yet — turn this into a ticket instead and our team will follow up.
            </Text>
            <Button
              size="small"
              icon={<CustomerServiceOutlined />}
              onClick={() => {
                const draftText = chatDraft.trim();
                setChatOpen(false);
                setChatDraft('');
                navigate(`/support?new=1${draftText ? `&draft=${encodeURIComponent(draftText)}` : ''}`);
              }}
              style={{ marginTop: 4 }}
            >
              Turn this into a ticket
            </Button>
          </div>

          <div style={{ padding: 12, borderTop: `1px solid ${borderColor}`, flexShrink: 0, display: 'flex', gap: 8 }}>
            <Input
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder={t('chat.placeholder')}
              style={{ borderRadius: 10 }}
            />
            <Tooltip title={t('chat.notConnected')}>
              <Button type="primary" shape="circle" icon={<SendOutlined />} disabled style={{ flexShrink: 0 }} />
            </Tooltip>
          </div>
        </div>
      )}

      <Tooltip title={chatOpen ? '' : 'Chat with support'} placement="left">
        <Button
          shape="circle"
          className="no-print"
          onClick={() => setChatOpen((v) => !v)}
          icon={chatOpen ? <CloseOutlined /> : <MessageOutlined />}
          style={{
            position: 'fixed', right: 24, bottom: 24, zIndex: 1000,
            width: 52, height: 52, minWidth: 52,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: GRADIENT, border: 'none', color: '#fff', fontSize: 19,
            boxShadow: '0 6px 20px rgba(79,107,237,0.38)',
          }}
        />
      </Tooltip>
    </Layout>
  );
};

export default AppLayout;
