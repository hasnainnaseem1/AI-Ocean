import React, { Suspense, lazy, useMemo, useEffect } from 'react';
import { Tabs, Space, Typography } from 'antd';
import {
  ClusterOutlined, DollarOutlined, TeamOutlined, CustomerServiceOutlined,
  HeartOutlined, AlertOutlined, GlobalOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import RouteLoader from '../components/RouteLoader';
import { usePermission } from '../hooks/usePermission';
import { PERMISSIONS } from '../utils/permissions';

const { Text } = Typography;

/*
 * Each tab is still its own lazily-loaded module. The whole point of the
 * separate pages was that a domain nobody opens is not downloaded, and that
 * holds whether they are reached by a route or by a tab — otherwise putting
 * them together would mean shipping seven analytics domains to anyone who
 * glances at one.
 */
const InfrastructurePage = lazy(() => import('./analytics/InfrastructurePage'));
const RevenuePage = lazy(() => import('./analytics/RevenuePage'));
const CustomersPage = lazy(() => import('./analytics/CustomersPage'));
const SupportPage = lazy(() => import('./analytics/SupportPage'));
const RetentionPage = lazy(() => import('./analytics/RetentionPage'));
const ChurnRiskPage = lazy(() => import('./analytics/ChurnRiskPage'));
const TrafficPage = lazy(() => import('./analytics/TrafficPage'));
const ExportsTab = lazy(() => import('./analytics/ExportsTab'));

/**
 * Analytics, as one page with tabs.
 *
 * ── Why one page instead of seven ──
 *
 * The seven domains were originally seven routes, each filed under the
 * section of the admin centre it reported on — infrastructure analytics beside
 * the machines, revenue analytics beside the wallets, and so on. The idea was
 * that somebody asking "why can nobody deploy an A100" is already in that
 * section. In practice it scattered one subject across five menus: to compare
 * what customers are doing with what support is seeing, you had to know which
 * two unrelated places to look.
 *
 * So everything analytics lives here, and the tab bar is the directory. The
 * old URLs still work — `/analytics/retention` opens the Retention tab —
 * because a tab key IS the path segment, so bookmarks and deep links survived
 * the move and the back button still steps through tabs.
 *
 * ── Why the tabs are not all mounted at once ──
 *
 * antd keeps a tab's contents alive once opened. That is right here: switching
 * back to a tab you were just on should not re-fetch eight endpoints. But
 * mounting all eight up front would fire every request on arrival, so each tab
 * renders only once it has been opened (`destroyInactiveTabPane` off,
 * `forceRender` not set).
 */
const AnalyticsPage = () => {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();

  const canSeeRevenue = hasPermission(PERMISSIONS.ANALYTICS_REVENUE);
  const canExport = hasPermission(PERMISSIONS.ANALYTICS_EXPORT);

  const goToTab = (key) => navigate(`/analytics/${key}`);

  const items = useMemo(() => {
    const label = (icon, text) => <Space size={6}>{icon}{text}</Space>;
    const all = [
      {
        key: 'infrastructure',
        label: label(<ClusterOutlined />, 'Infrastructure'),
        children: <InfrastructurePage embedded />,
      },
      {
        key: 'customers',
        label: label(<TeamOutlined />, 'Customers'),
        children: <CustomersPage embedded />,
      },
      {
        key: 'revenue',
        label: label(<DollarOutlined />, 'Revenue & Billing'),
        children: <RevenuePage embedded />,
        // Money is a narrower right than analytics. Hidden, not disabled —
        // a tab that cannot be opened is just a question an operator asks.
        permission: PERMISSIONS.ANALYTICS_REVENUE,
      },
      {
        key: 'support',
        label: label(<CustomerServiceOutlined />, 'Support'),
        children: <SupportPage embedded />,
      },
      {
        key: 'retention',
        label: label(<HeartOutlined />, 'Retention'),
        children: <RetentionPage embedded onSwitchTab={goToTab} />,
      },
      {
        key: 'churn-risk',
        label: label(<AlertOutlined />, 'At-Risk Accounts'),
        children: <ChurnRiskPage embedded />,
      },
      {
        key: 'traffic',
        label: label(<GlobalOutlined />, 'Traffic'),
        children: <TrafficPage embedded />,
      },
      {
        key: 'exports',
        label: label(<DownloadOutlined />, 'Exports'),
        children: <ExportsTab />,
        permission: PERMISSIONS.ANALYTICS_EXPORT,
      },
    ];
    return all.filter((t) => !t.permission || hasPermission(t.permission));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeRevenue, canExport]);

  /*
   * An unknown or missing tab falls back to the first one the reader is
   * allowed to see, rather than rendering an empty shell — `/analytics` on its
   * own is a normal way to arrive, and so is a bookmark to a tab somebody has
   * since lost permission for.
   */
  const activeKey = items.some((t) => t.key === tab) ? tab : items[0]?.key;

  /*
   * Put the resolved tab in the URL.
   *
   * `/analytics` and `/analytics/<a tab you cannot see>` both fall back to the
   * first tab, which leaves the address bar naming something other than what
   * is on screen — so copying the URL hands somebody a link that does not say
   * where you were. `replace` rather than `push`: this is a correction, not a
   * navigation, and it must not put a step in the history that Back would
   * bounce off.
   */
  useEffect(() => {
    if (activeKey && activeKey !== tab) navigate(`/analytics/${activeKey}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, tab]);

  return (
    // `analytics-surface` is what the card-height rules in index.css hang off,
    // so every tab gets even rows without each page having to ask for it.
    <div className="analytics-surface">
      {/*
        No subtitle here on purpose. Each tab states what it answers in its
        own header strip, and a second sentence above the tab bar meant two
        subtitles stacked before any data — four lines of furniture between
        the breadcrumb and the first number.
      */}
      <PageHeader
        title="Analytics"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Analytics' }]}
      />

      {/* The boundary has to wrap the Tabs, not sit beside them: the lazy
          module resolves while the tab's pane is rendering, and a Suspense
          elsewhere in the tree cannot catch that. */}
      <Suspense fallback={<RouteLoader />}>
        <Tabs
          items={items}
          activeKey={activeKey}
          onChange={goToTab}
          /* The URL carries the tab, so switching is a navigation — that is
             what makes a tab bookmarkable and the back button useful. */
          destroyInactiveTabPane={false}
          renderTabBar={(props, DefaultTabBar) => (
            <DefaultTabBar {...props} style={{ marginBottom: 14 }} />
          )}
        />
      </Suspense>

      {!items.length && (
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          You do not have permission to see any analytics.
        </Text>
      )}
    </div>
  );
};

export default AnalyticsPage;
