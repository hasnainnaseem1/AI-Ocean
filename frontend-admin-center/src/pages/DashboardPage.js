import React, { useState, useMemo } from 'react';
import {
  Row, Col, Card, Table, Segmented, Space, Typography, Button, Alert, Empty, Tag, Tooltip,
} from 'antd';
import {
  ReloadOutlined, UserOutlined, CloudServerOutlined, ThunderboltOutlined,
  DollarOutlined, WalletOutlined, CustomerServiceOutlined, ClockCircleOutlined,
  TrophyOutlined, ApartmentOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import PermissionGuard from '../components/guards/PermissionGuard';
import StatusTag from '../components/common/StatusTag';
import { StatRow, StatCard } from '../components/StatRow';
import Sparkline from '../components/Sparkline';
import { StatCardsSkeleton } from '../components/Skeletons';
import AttentionList from '../components/analytics/AttentionList';
import ChartCard from '../components/charts/ChartCard';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import dashboardApi from '../api/dashboardApi';
import useAnalyticsQuery from '../hooks/useAnalyticsQuery';
import { usePermission } from '../hooks/usePermission';
import { PERMISSIONS } from '../utils/permissions';
import { useTheme } from '../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted, monoNumeric } from '../theme/colors';
import { timeAgo, formatNumber } from '../utils/helpers';

const { Text } = Typography;

/** Which tile colour and icon each KPI wears. Keyed by the server's `key`, so
 *  adding a KPI server-side degrades to a sensible default rather than crashing. */
const KPI_STYLE = {
  newCustomers: { tone: 'blue', icon: <UserOutlined />, href: '/customers' },
  runningDeployments: { tone: 'cyan', icon: <CloudServerOutlined />, href: '/deployments' },
  gpuHours: { tone: 'purple', icon: <ThunderboltOutlined />, href: '/deployments' },
  usageRevenue: { tone: 'green', icon: <DollarOutlined />, href: '/analytics' },
  topUps: { tone: 'amber', icon: <WalletOutlined />, href: '/wallets' },
  openTickets: { tone: 'pink', icon: <CustomerServiceOutlined />, href: '/support-tickets' },
};

/**
 * One line that gives way instead of pushing its neighbours.
 *
 * Names and email addresses are other people's text and have no upper bound.
 * Both tables below used to size to their content (`scroll.x: 'max-content'`),
 * so a single long address widened the first column and shoved Spend, Owed and
 * When 170–470px past the card edge — behind a sideways scroll, which hid the
 * one figure on the row that mattered most (what the account owes). The text
 * truncates here and the full value stays on hover via `title`.
 */
const CLIP = {
  display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const formatValue = (kpi) => {
  if (kpi.unit === 'currency') return `$${formatNumber(Number(kpi.value).toFixed(2))}`;
  if (kpi.unit === 'hours') return formatNumber(Math.round(Number(kpi.value)));
  return formatNumber(kpi.value ?? 0);
};

/**
 * The Dashboard.
 *
 * ── What changed, and why ──
 *
 * The old version opened on three counts (total users, active customers,
 * monthly revenue) and two charts. All true, almost none of it actionable: an
 * operator does not sign in to learn that eight users exist, they sign in to
 * find out whether anything is wrong. So the page now opens on a prioritised
 * list of conditions that need a person — a tier out of stock, an account past
 * its credit limit, a ticket nobody has answered, a billing job that failed —
 * each one carrying the real number, the threshold it crossed, and a link to
 * where it gets fixed.
 *
 * The numbers below it changed too. Each KPI now reports its own change
 * against the previous period and carries a sparkline, so "412 machine hours"
 * is readable as good or bad news rather than as a bare fact. `StatCard` has
 * had `delta` and `chart` props since it was written and nothing had ever used
 * them.
 *
 * Top accounts is now grouped by ACCOUNT rather than by person. Since the
 * Teams work every wallet and deployment belongs to a `Team`; grouping by user
 * split an organization's spend across whichever of its developers clicked
 * deploy, so the biggest customers on the platform were invisible here.
 *
 * `Promise.allSettled` partial-failure handling is kept — one dead endpoint
 * must not blank the page — but it is keyed by name now (see
 * `useAnalyticsQuery`), because reading it positionally meant inserting a
 * fetch silently re-pointed every assignment after it.
 */
const DashboardPage = () => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { hasPermission } = usePermission();
  const canSeeRevenue = hasPermission(PERMISSIONS.ANALYTICS_REVENUE);
  const canSeeLogs = hasPermission(PERMISSIONS.LOGS_VIEW);

  const [period, setPeriod] = useState('30d');

  const { data, errors, loading, failedCount, reload } = useAnalyticsQuery({
    summary: () => dashboardApi.getSummary({ period }),
    attention: () => dashboardApi.getAttention(),
    trends: () => dashboardApi.getTrends({ period }),
    topAccounts: () => dashboardApi.getTopAccounts({ period, limit: 8 }),
    ...(canSeeLogs ? { activity: () => dashboardApi.getActivity({ limit: 8 }) } : {}),
  }, [period, canSeeLogs]);

  const kpis = data.summary?.kpis || [];
  const windowLabel = data.summary?.window
    ? `${data.summary.window.label} · ${data.summary.window.granularity}ly · ${data.summary.window.timezone}`
    : '';

  const activity = data.trends?.activity || [];
  const money = data.trends?.money || [];
  const accounts = data.topAccounts?.accounts || [];
  const recent = data.activity?.activities || [];

  const refresh = () => reload({ quiet: true });

  const accountColumns = useMemo(() => [
    {
      title: 'Account',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name, r) => (
        <div style={{ minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
          }}
          >
            <Text strong title={name} style={{ fontSize: 12.5, ...CLIP }}>{name}</Text>
            {r.kind === 'team' && (
              <Tooltip title={`Organization · ${r.members} member${r.members === 1 ? '' : 's'}`}>
                <ApartmentOutlined style={{ fontSize: 11, color: muted(isDark), flexShrink: 0 }} />
              </Tooltip>
            )}
            {r.disputeHold && <Tag color="red" style={{ marginInlineEnd: 0, flexShrink: 0 }}>hold</Tag>}
          </div>
          <Text title={r.ownerEmail || ''} style={{ fontSize: 11, color: muted(isDark), ...CLIP }}>
            {r.ownerEmail || '—'}
          </Text>
        </div>
      ),
    },
    {
      title: 'Hours',
      dataIndex: 'gpuHours',
      key: 'gpuHours',
      width: 80,
      align: 'right',
      render: (v) => <span style={monoNumeric}>{formatNumber(Math.round(v))}</span>,
    },
    ...(canSeeRevenue ? [{
      title: 'Spend',
      dataIndex: 'spend',
      key: 'spend',
      width: 100,
      align: 'right',
      render: (v) => <span style={monoNumeric}>${formatNumber(Number(v).toFixed(2))}</span>,
    }, {
      title: 'Owed',
      dataIndex: 'outstanding',
      key: 'outstanding',
      width: 90,
      align: 'right',
      render: (v) => (Number(v) > 0
        ? <Text type="danger" style={monoNumeric}>${formatNumber(Number(v).toFixed(2))}</Text>
        : <Text type="secondary">—</Text>),
    }] : []),
  ], [canSeeRevenue, isDark]);

  const activityColumns = useMemo(() => [
    {
      title: 'Activity',
      key: 'activity',
      ellipsis: true,
      render: (_, r) => (
        <div style={{ minWidth: 0 }}>
          <Text strong title={r.userName || 'System'} style={{ fontSize: 12.5, ...CLIP }}>
            {r.userName || 'System'}
          </Text>
          <Text title={r.description || r.action} style={{ fontSize: 11, color: muted(isDark), ...CLIP }}>
            {r.description || r.action}
          </Text>
        </div>
      ),
    },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 92, render: (s) => <StatusTag status={s} /> },
    {
      title: 'When',
      dataIndex: 'createdAt',
      key: 'createdAt',
      // "a few seconds ago" is the longest thing this ever says and is ~102px
      // at this size; 110 left it wrapping in a fixed-width column.
      width: 128,
      render: (d) => (
        <Text style={{ fontSize: 11.5, color: muted(isDark), whiteSpace: 'nowrap' }}>{timeAgo(new Date(d))}</Text>
      ),
    },
  ], [isDark]);

  return (
    /*
      `analytics-surface` is what makes the cards in a row end level — see
      index.css. The Dashboard is made of the same rows of cards as the
      Analytics tabs and had the same ragged look (a one-row "Biggest accounts"
      beside a tall "Recent staff activity"), so it opts into the same rule
      rather than getting a second, slightly different one.
    */
    <div className="analytics-surface">
      <PageHeader
        title="Dashboard"
        subtitle="What the platform is doing, and what needs you today"
        breadcrumbs={[{ label: 'Home' }]}
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading} size="small">
              Refresh
            </Button>
            <Segmented
              size="small"
              value={period}
              onChange={setPeriod}
              options={[
                { label: '7 Days', value: '7d' },
                { label: '30 Days', value: '30d' },
                { label: '90 Days', value: '90d' },
                { label: '1 Year', value: '1y' },
              ]}
            />
          </Space>
        )}
      />

      {/*
        Partial failure is reported as partial, naming what is missing — the
        old banner said only "some data failed" and, because it was passed
        antd's `title` instead of `message`, rendered as an empty red box.
      */}
      {failedCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message={`${failedCount} of the dashboard's sections could not be loaded`}
          description={Object.entries(errors).map(([key, msg]) => `${key}: ${msg}`).join(' · ')}
          action={<Button size="small" onClick={() => reload()}>Retry</Button>}
        />
      )}

      {/* ── 1. What needs a human, before anything else on the page ── */}
      <AttentionList
        items={data.attention?.items || []}
        loading={loading && !data.attention}
        error={errors.attention}
        checkedAt={data.attention?.checkedAt}
      />

      {/* ── 2. Headline numbers, each with its change and its own trend ── */}
      {loading && !data.summary ? (
        <StatCardsSkeleton count={canSeeRevenue ? 6 : 4} />
      ) : (
        <StatRow>
          {kpis.map((kpi) => {
            const style = KPI_STYLE[kpi.key] || { tone: 'blue', icon: <ThunderboltOutlined /> };
            const values = (kpi.sparkline || []).map((p) => p.value);
            return (
              <StatCard
                key={kpi.key}
                count={kpis.length >= 6 ? 6 : 4}
                tone={style.tone}
                icon={style.icon}
                label={kpi.label}
                value={formatValue(kpi)}
                delta={kpi.delta}
                caption={kpi.caption}
                onClick={style.href ? () => navigate(style.href) : undefined}
                chart={values.length > 1 ? (
                  <Sparkline
                    fluid
                    values={values}
                    width={84}
                    height={26}
                    color={TILE[style.tone]?.fg(isDark)}
                  />
                ) : null}
              />
            );
          })}
        </StatRow>
      )}

      {/* ── 3. The series behind those numbers ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={canSeeRevenue ? 12 : 24}>
          <ChartCard
            title="Platform activity"
            subtitle="Signups, deployments and machine hours"
            loading={loading && !data.trends}
            error={errors.trends}
            onRetry={() => reload()}
            empty={!activity.some((r) => r.signups || r.deployments || r.gpuHours)}
            definition="Signups and deployments are counted when created; machine hours are billed compute time."
            window={windowLabel}
          >
            <TimeSeriesChart
              data={activity}
              series={[
                { field: 'signups', label: 'Signups' },
                { field: 'deployments', label: 'Deployments' },
                { field: 'gpuHours', label: 'Machine hours' },
              ]}
              height={260}
            />
          </ChartCard>
        </Col>

        {canSeeRevenue && (
          <Col xs={24} lg={12}>
            <ChartCard
              title="Money"
              subtitle="What came in against what was consumed"
              loading={loading && !data.trends}
              error={errors.trends}
              onRetry={() => reload()}
              empty={!money.some((r) => r.usageRevenue || r.topUps)}
              definition="Top-ups are money added to wallets. Billed usage is what the platform earned from running machines — the two are not the same thing."
              window={windowLabel}
            >
              <TimeSeriesChart
                data={money}
                kind="area"
                series={[
                  { field: 'topUps', label: 'Top-ups' },
                  { field: 'usageRevenue', label: 'Billed usage' },
                ]}
                height={260}
                valueFormat={(v) => `$${formatNumber(Number(v).toFixed(0))}`}
              />
            </ChartCard>
          </Col>
        )}
      </Row>

      {/* ── 4. Who the biggest accounts are, and what staff have been doing ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={canSeeLogs ? 13 : 24}>
          <Card
            size="small"
            title={<Space size={7}><TrophyOutlined style={{ color: TILE.amber.fg(isDark) }} />
              <Text strong style={{ fontSize: 14 }}>Biggest accounts</Text></Space>}
            extra={<Button type="link" size="small" onClick={() => navigate('/teams')}>Organizations</Button>}
          >
            {errors.topAccounts ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={errors.topAccounts} />
            ) : (
              <>
                <Table
                  size="small"
                  loading={loading && !data.topAccounts}
                  dataSource={accounts}
                  columns={accountColumns}
                  pagination={false}
                  rowKey="teamId"
                  tableLayout="fixed"
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No billed usage in this period" /> }}
                />
                <Text style={{ fontSize: 11, color: muted(isDark), display: 'block', marginTop: 8 }}>
                  <WarningOutlined style={{ marginRight: 5, opacity: 0.6 }} />
                  Grouped by account — an organization counts once, not once per member.
                </Text>
              </>
            )}
          </Card>
        </Col>

        <PermissionGuard permission={PERMISSIONS.LOGS_VIEW} fallback={null}>
          <Col xs={24} lg={11}>
            <Card
              size="small"
              title={<Space size={7}><ClockCircleOutlined style={{ color: TILE.blue.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>Recent staff activity</Text></Space>}
              extra={<Button type="link" size="small" onClick={() => navigate('/logs')}>View all</Button>}
            >
              <Table
                size="small"
                loading={loading && !data.activity}
                dataSource={recent}
                columns={activityColumns}
                pagination={false}
                rowKey={(r, i) => r.id || `row-${i}`}
                tableLayout="fixed"
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing yet" /> }}
              />
            </Card>
          </Col>
        </PermissionGuard>
      </Row>

      {/* ── 5. Can today's numbers be trusted? ── */}
      <DataHealthNote />
    </div>
  );
};

/**
 * Every figure above is only as fresh as the job that produced it. If hourly
 * billing has been failing since Tuesday the revenue line is not low, it is
 * missing — and an operator who cannot tell those apart will act on the wrong
 * one. So the page says it out loud rather than implying freshness it cannot
 * guarantee.
 */
const DataHealthNote = () => {
  const { isDark } = useTheme();
  const { data } = useAnalyticsQuery({ health: () => dashboardApi.getHealth() }, []);
  const health = data.health;
  if (!health) return null;

  const failing = (health.jobs || []).filter((j) => j.enabled && j.lastStatus === 'failed');
  const mins = health.dataFreshness?.minutesSinceLastBilling;

  return (
    <div style={{ marginTop: 14, textAlign: 'right' }}>
      <Text style={{ fontSize: 11, color: failing.length ? STATUS_COLORS.warning[isDark ? 'dark' : 'light'] : muted(isDark) }}>
        {failing.length
          ? `${failing.length} scheduled job${failing.length === 1 ? '' : 's'} failing — these numbers may be incomplete`
          : (mins === null || mins === undefined
            ? 'No usage billed yet'
            : `Usage last billed ${mins} minute${mins === 1 ? '' : 's'} ago`)}
        {health.cache?.hitRate !== undefined && ` · cache ${health.cache.hitRate}% hit`}
      </Text>
    </div>
  );
};

export default DashboardPage;
