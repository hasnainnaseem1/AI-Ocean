import React from 'react';
import {
  DashboardOutlined,
  BarChartOutlined,
  FileTextOutlined,
  BellOutlined,
  CloudServerOutlined,
  ExperimentOutlined,
  ClusterOutlined,
  DollarOutlined,
  QuestionCircleOutlined,
  BulbOutlined,
  TeamOutlined,
  WalletOutlined,
  AccountBookOutlined,
  FileOutlined,
  ReadOutlined,
  MenuOutlined,
  BgColorsOutlined,
  GlobalOutlined,
  SwapOutlined,
  BugOutlined,
  UserOutlined,
  SafetyOutlined,
  ApartmentOutlined,
  SettingOutlined,
  ApiOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { PERMISSIONS } from '../utils/permissions';

/**
 * The admin center's navigation, as data.
 *
 * This used to be built imperatively inside AppSider's `useMemo` — a long run
 * of `if (hasPermission(...)) children.push(...)`. Moving it to a declarative
 * array buys three things:
 *
 *   1. The sidebar and the Ctrl+K command palette render from the same list,
 *      so a new page can never appear in one and be missing from the other.
 *   2. Permission filtering becomes a single `.filter()` over data rather than
 *      branching spread through the render.
 *   3. It removes a whole bug class. The old sider decided "is this a group
 *      header?" with a hardcoded string blocklist that had drifted out of sync
 *      with the actual group keys ('infra' and 'billing' were missing). With a
 *      flat list there are no group keys to mis-handle.
 *
 * ── Flat items under section labels, not collapsible submenus ──
 * The customer center's sidebar has three destinations, so it labels them and
 * lists them. This app has 26, which is why it previously used accordions. The
 * accordion cost a click on the way to anywhere and hid the app's own scope
 * from whoever was looking at it. Flat-under-labels is one click to every
 * page; the list scrolls, which is what admin consoles normally do, and the
 * command palette added in the next phase is the fast path for people who know
 * where they are going.
 *
 * `keywords` exist for that palette — the terms someone would actually type
 * when they don't remember the page's exact name.
 */

/** A section renders as an uppercase micro-label with its items beneath it. */
export const NAV_SECTIONS = [
  {
    section: 'Overview',
    icon: <DashboardOutlined />,
    items: [
      { key: '/', icon: <DashboardOutlined />, label: 'Dashboard', keywords: ['home', 'overview', 'kpi', 'stats'] },
      { key: '/analytics', icon: <BarChartOutlined />, label: 'Analytics', permission: PERMISSIONS.ANALYTICS_VIEW, keywords: ['charts', 'reports', 'growth', 'revenue'] },
      { key: '/logs', icon: <FileTextOutlined />, label: 'Activity Logs', permission: PERMISSIONS.LOGS_VIEW, feature: 'enableActivityLogs', keywords: ['audit', 'history', 'events'] },
      { key: '/notifications', icon: <BellOutlined />, label: 'Notifications', keywords: ['alerts', 'messages', 'bell'] },
    ],
  },
  {
    section: 'AI Infrastructure',
    icon: <CloudServerOutlined />,
    items: [
      { key: '/deployments', icon: <CloudServerOutlined />, label: 'Deployments', permission: PERMISSIONS.DEPLOYMENTS_VIEW, keywords: ['instances', 'running', 'gpu', 'endpoints'] },
      { key: '/models', icon: <ExperimentOutlined />, label: 'AI Models', permission: PERMISSIONS.MODELS_VIEW, keywords: ['catalog', 'llm', 'weights'] },
      // "Tiers" is the platform's own name for its machines — not "GPU tiers",
      // since non-GPU machine types exist too.
      { key: '/tiers', icon: <ClusterOutlined />, label: 'Tiers', permission: PERMISSIONS.MODELS_VIEW, keywords: ['machines', 'hardware', 'gpu', 'capacity', 'stock'] },
      { key: '/resource-pricing', icon: <DollarOutlined />, label: 'Resource Pricing', permission: PERMISSIONS.MODELS_VIEW, keywords: ['rates', 'hourly', 'cost', 'storage'] },
      { key: '/questionnaire', icon: <QuestionCircleOutlined />, label: 'Questionnaire', permission: PERMISSIONS.MODELS_VIEW, keywords: ['questions', 'journey', 'signals', 'onboarding'] },
      { key: '/recommendation-policy', icon: <BulbOutlined />, label: 'Recommendation Policy', permission: PERMISSIONS.MODELS_VIEW, keywords: ['scoring', 'weights', 'suggestion', 'sizing'] },
    ],
  },
  {
    section: 'Customers',
    icon: <TeamOutlined />,
    items: [
      { key: '/customers', icon: <TeamOutlined />, label: 'Customers', permission: PERMISSIONS.CUSTOMERS_VIEW, keywords: ['accounts', 'users', 'signups'] },
      { key: '/teams', icon: <ApartmentOutlined />, label: 'Organizations', permission: PERMISSIONS.CUSTOMERS_VIEW, keywords: ['teams', 'companies', 'seats', 'members'] },
    ],
  },
  {
    // Everything about what a customer owes or holds on the prepaid-credits
    // wallet system — as opposed to the "Customers" section above, which is
    // the account directory itself.
    section: 'Billing',
    icon: <WalletOutlined />,
    items: [
      { key: '/wallets', icon: <WalletOutlined />, label: 'Customer Wallets', permission: PERMISSIONS.BILLING_VIEW, keywords: ['credit', 'balance', 'topup'] },
      { key: '/receivables', icon: <AccountBookOutlined />, label: 'Receivables', permission: PERMISSIONS.BILLING_VIEW, keywords: ['debt', 'outstanding', 'owed', 'collections'] },
    ],
  },
  {
    section: 'Website',
    // A dedicated icon, not borrowed from the first child (Pages'
    // FileOutlined) — a plain document icon didn't read as "the whole
    // marketing site" in the collapsed rail. Globe is the one icon this
    // section's items already use for the same idea (SEO Settings).
    icon: <GlobalOutlined />,
    items: [
      { key: '/marketing/pages', icon: <FileOutlined />, label: 'Pages', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['landing', 'content', 'blocks', 'website'] },
      { key: '/blog/posts', icon: <ReadOutlined />, label: 'Blog Posts', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['articles', 'writing', 'news'] },
      { key: '/marketing/navigation', icon: <MenuOutlined />, label: 'Navigation', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['menu', 'header', 'footer', 'links'] },
      { key: '/marketing/branding', icon: <BgColorsOutlined />, label: 'Branding', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['logo', 'colors', 'theme', 'identity'] },
      { key: '/seo/settings', icon: <GlobalOutlined />, label: 'SEO Settings', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['meta', 'sitemap', 'robots', 'search'] },
      { key: '/seo/redirects', icon: <SwapOutlined />, label: 'Redirects', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['301', 'forward', 'url'] },
      { key: '/seo/debug', icon: <BugOutlined />, label: 'SEO Debug', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['inspect', 'preview', 'diagnose'] },
    ],
  },
  {
    // Who works on this platform and what they may do — as opposed to the
    // "Administration" section below, which is how the platform itself
    // behaves. "Administration" used to hold both: Admin Users/Roles/
    // Departments (people) sat in the same list as Settings/Integrations
    // (system configuration), so a section named after "administering"
    // covered two unrelated questions — "who has access" and "how does this
    // thing run". Splitting them is also why "Customers", one item above,
    // stops looking like an anomaly: it was never thin because it was
    // mis-scoped, it was thin because everything else nearby was
    // over-scoped into one catch-all.
    section: 'Team & Access',
    icon: <UserOutlined />,
    items: [
      { key: '/users', icon: <UserOutlined />, label: 'Users', permission: PERMISSIONS.USERS_VIEW, keywords: ['staff', 'team', 'operators', 'admin users'] },
      { key: '/roles', icon: <SafetyOutlined />, label: 'Roles & Permissions', permission: PERMISSIONS.ROLES_VIEW, feature: 'enableCustomRoles', keywords: ['access', 'rbac', 'grants'] },
      { key: '/departments', icon: <ApartmentOutlined />, label: 'Departments', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['teams', 'org'] },
    ],
  },
  {
    section: 'Administration',
    icon: <SettingOutlined />,
    items: [
      { key: '/settings', icon: <SettingOutlined />, label: 'Settings', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['config', 'preferences', 'platform', 'billing mode'] },
      { key: '/integrations', icon: <ApiOutlined />, label: 'Integrations', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['stripe', 'email', 'webhook', 'smtp', 'gateway'] },
      // The platform's own internal scheduler, not a connection to anything
      // external — that's why it isn't in Integrations — and a full record
      // list (create/edit/run-now/delete), not a form of toggles, which is
      // why it isn't a Settings tab either.
      { key: '/jobs', icon: <ClockCircleOutlined />, label: 'Jobs', permission: PERMISSIONS.SETTINGS_VIEW, keywords: ['cron', 'scheduled', 'tasks', 'background', 'automation'] },
    ],
  },
];

/**
 * Pages that are reachable but deliberately absent from the sidebar — they
 * live in the sidebar's account menu instead. The palette should still find
 * them, so they are listed here rather than being invisible.
 */
export const UNLISTED_DESTINATIONS = [
  { key: '/profile', icon: <UserOutlined />, label: 'My Profile', keywords: ['account', 'me', 'password', 'timezone'] },
];

/**
 * Filters the nav down to what this admin may actually see.
 *
 * @param hasPermission  from usePermission()
 * @param features       from useFeatures() — flags default to on when absent,
 *                       matching the previous `!== false` checks
 */
export const visibleSections = (hasPermission, features = {}) =>
  NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (!item.permission || hasPermission(item.permission)) &&
          (!item.feature || features[item.feature] !== false)
      ),
    }))
    .filter((section) => section.items.length > 0);

/** Every destination the current admin can reach — the palette's index. */
export const visibleDestinations = (hasPermission, features = {}) => [
  ...visibleSections(hasPermission, features).flatMap((s) =>
    s.items.map((item) => ({ ...item, section: s.section }))
  ),
  ...UNLISTED_DESTINATIONS.map((item) => ({ ...item, section: 'Account' })),
];

/**
 * Which nav key is "current" for a given pathname.
 *
 * Longest match wins so that `/marketing/pages` beats a hypothetical
 * `/marketing`, and detail routes (`/customers/abc123`) keep their list page
 * highlighted. `/` is exact-only, or it would match everything.
 */
export const selectedKeyFor = (pathname, sections) => {
  if (pathname === '/') return '/';
  const keys = sections.flatMap((s) => s.items.map((i) => i.key)).filter((k) => k !== '/');
  return (
    keys
      .slice()
      .sort((a, b) => b.length - a.length)
      .find((k) => pathname === k || pathname.startsWith(`${k}/`)) || ''
  );
};
