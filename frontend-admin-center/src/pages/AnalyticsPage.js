import React, { useState, useEffect, useCallback } from 'react';
import {
  Row, Col, Segmented, Card, Table, Empty, Statistic, Typography,
  Avatar, Timeline, Badge, Tabs, Space, Button, Alert,
} from 'antd';
import {
  TeamOutlined, UserOutlined,
  DollarOutlined, ArrowUpOutlined, ArrowDownOutlined,
  ClockCircleOutlined, CrownOutlined, TrophyOutlined, ReloadOutlined,
  BarChartOutlined, LineChartOutlined,
  CheckCircleOutlined, WarningOutlined, LockOutlined,
  FundOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { usePermission } from '../hooks/usePermission';
import GrowthChart from '../components/charts/GrowthChart';
import PermissionGuard from '../components/guards/PermissionGuard';
import { useTheme } from '../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted, hairline, solidBg } from '../theme/colors';
import { chartConfig } from '../theme/chartTheme';
import analyticsApi from '../api/analyticsApi';
import { formatNumber } from '../utils/helpers';

const { Text } = Typography;

// ─── Dynamic chart imports ───
let Line, Column;
try {
  const charts = require('@ant-design/charts');
  Line = charts.Line;
  Column = charts.Column;
} catch {
  Line = null;
  Column = null;
}

// ─── Stat Card ───
const StatCard = ({ title, value, icon, color, prefix, suffix, onClick, loading: cardLoading }) => (
  <Card
    hoverable={!!onClick}
    onClick={onClick}
    style={{ cursor: onClick ? 'pointer' : 'default', height: '100%', borderTop: `3px solid ${color}` }}
    styles={{ body: { padding: '20px 24px' } }}
    loading={cardLoading}
  >
    <Statistic
      title={<Text type="secondary" style={{ fontSize: 13 }}>{title}</Text>}
      value={value ?? 0}
      formatter={(val) => (prefix ? `${prefix}${formatNumber(val)}` : formatNumber(val))}
      prefix={
        <span style={{
          color, marginRight: 8, fontSize: 20, background: `${color}15`,
          padding: '6px 8px', borderRadius: 8, display: 'inline-flex',
        }}>
          {icon}
        </span>
      }
      valueStyle={{ fontSize: 28, fontWeight: 700 }}
    />
    {suffix && <div style={{ marginTop: 4 }}>{suffix}</div>}
  </Card>
);

// ─── Mini Line Chart ───
const MiniLineChart = ({ data, xField, yField, height = 250, color, loading, isDark }) => {
  if (!Line || !data?.length) {
    return <Card loading={loading}><Empty description="No data" /></Card>;
  }
  return (
    <Line
      {...chartConfig(isDark)}
      data={data}
      xField={xField}
      yField={yField}
      smooth
      height={height}
      style={{ lineWidth: 2 }}
      color={color}
      point={{ shapeField: 'square', sizeField: 2 }}
      interaction={{ tooltip: { marker: true } }}
    />
  );
};

const AnalyticsPage = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [timeframe, setTimeframe] = useState('30d');
  const [activeTab, setActiveTab] = useState('overview');

  // Data states
  const [overview, setOverview] = useState(null);
  const [growthData, setGrowthData] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [loginAnalytics, setLoginAnalytics] = useState(null);
  const [revenueStats, setRevenueStats] = useState(null);
  const [advancedRevenue, setAdvancedRevenue] = useState(null);

  const navigate = useNavigate();
  const { isDark } = useTheme();
  const purple = TILE.purple.fg(isDark);
  const blue = TILE.blue.fg(isDark);
  const green = TILE.green.fg(isDark);
  const amber = TILE.amber.fg(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];
  const error = STATUS_COLORS.error[isDark ? 'dark' : 'light'];
  const info = STATUS_COLORS.info[isDark ? 'dark' : 'light'];

  // Revenue is its own permission, granted from Admin Center → Roles, rather
  // than a hardcoded role name — so an operator can build a role that sees
  // usage and growth but not money.
  const { hasPermission } = usePermission();
  const canSeeRevenue = hasPermission('analytics.revenue');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const calls = [
        analyticsApi.getOverview(timeframe),
        analyticsApi.getUsersGrowth(timeframe),
        analyticsApi.getTopCustomers(10),
        analyticsApi.getRecentActivities(15),
        analyticsApi.getLoginAnalytics(timeframe),
      ];
      // Revenue — admin/super_admin only
      if (canSeeRevenue) {
        calls.push(analyticsApi.getRevenueStats(timeframe));
        calls.push(analyticsApi.getRevenueAdvanced(timeframe));
      }

      const results = await Promise.allSettled(calls);

      if (results[0].status === 'fulfilled') setOverview(results[0].value.overview);
      if (results[1].status === 'fulfilled') setGrowthData(results[1].value.data || []);
      if (results[2].status === 'fulfilled') setTopCustomers(results[2].value.topCustomers || []);
      if (results[3].status === 'fulfilled') setRecentActivities(results[3].value.activities || []);
      if (results[4].status === 'fulfilled') setLoginAnalytics(results[4].value.loginAnalytics);
      if (results[5]?.status === 'fulfilled') setRevenueStats(results[5].value.revenue);
      if (results[6]?.status === 'fulfilled') setAdvancedRevenue(results[6].value.advanced);

      // allSettled never rejects, so the catch below can't report an outage —
      // without this the page renders zeros as though they were real figures.
      const failed = results.filter((r) => r.status === 'rejected').length;
      setLoadError(failed
        ? (results[0].status === 'rejected'
          ? 'Could not load analytics. The figures below are not current.'
          : 'Some analytics panels could not be loaded. What is shown may be incomplete.')
        : null);
    } catch {
      setLoadError('Could not load analytics. The figures below are not current.');
    } finally {
      setLoading(false);
    }
  }, [timeframe, canSeeRevenue]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ═══════════════════════════════════════════════════════════
  // TAB 1: OVERVIEW & USERS
  // ═══════════════════════════════════════════════════════════
  const renderOverviewTab = () => {
    const activityColor = (action) => {
      if (action?.includes('login')) return 'green';
      if (action?.includes('create')) return 'blue';
      if (action?.includes('delete')) return 'red';
      if (action?.includes('update') || action?.includes('edit')) return 'orange';
      return 'gray';
    };

    return (
      <>
        {/* KPI Row */}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              title="Total Users"
              value={overview?.users?.total}
              icon={<TeamOutlined />}
              color={purple}
              onClick={() => navigate('/users')}
              loading={loading}
              suffix={overview?.users?.growth && overview.users.growth !== '0%' ? (
                <Text style={{ fontSize: 12, color: success }}><ArrowUpOutlined /> {overview.users.growth} growth</Text>
              ) : null}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              title="Active Customers"
              value={overview?.customers?.active}
              icon={<UserOutlined />}
              color={blue}
              onClick={() => navigate('/customers')}
              loading={loading}
            />
          </Col>
          {canSeeRevenue && (
            <Col xs={24} sm={12} lg={6}>
              <StatCard
                title="Monthly Revenue"
                value={overview?.revenue?.monthly}
                icon={<DollarOutlined />}
                color={amber}
                prefix="$"
                loading={loading}
              />
            </Col>
          )}
        </Row>

        {/* User Growth */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24}>
            <GrowthChart data={growthData} loading={loading} />
          </Col>
        </Row>

        {/* Login Trend + Most Active Users */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={12}>
            <Card
              title={<><LineChartOutlined style={{ marginRight: 8, color: green }} />Login Activity Trend</>}
              loading={loading}
            >
              {loginAnalytics?.trend?.length > 0 && Line ? (
                <MiniLineChart data={loginAnalytics.trend} xField="date" yField="logins" color={green} isDark={isDark} />
              ) : (
                <Empty description="No login data" />
              )}
              {loginAnalytics?.stats && (
                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col span={8}>
                    <Statistic title="Successful" value={loginAnalytics.stats.success || 0} valueStyle={{ color: success, fontSize: 18 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Failed" value={loginAnalytics.stats.failed || 0} valueStyle={{ color: error, fontSize: 18 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="Failure Rate"
                      value={
                        (loginAnalytics.stats.success || 0) + (loginAnalytics.stats.failed || 0) > 0
                          ? (((loginAnalytics.stats.failed || 0) / ((loginAnalytics.stats.success || 0) + (loginAnalytics.stats.failed || 0))) * 100).toFixed(1)
                          : 0
                      }
                      suffix="%"
                      valueStyle={{ fontSize: 18 }}
                    />
                  </Col>
                </Row>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card
              title={<><TrophyOutlined style={{ marginRight: 8, color: amber }} />Most Active Users (by Logins)</>}
              loading={loading}
            >
              {loginAnalytics?.topUsers?.length > 0 ? (
                <Table
                  scroll={{ x: 'max-content' }}
                  dataSource={loginAnalytics.topUsers}
                  columns={[
                    {
                      title: '#', key: 'rank', width: 40,
                      render: (_, __, i) => <Badge count={i + 1} style={{ backgroundColor: i < 3 ? solidBg.warning : solidBg.neutral }} />,
                    },
                    { title: 'User', dataIndex: 'userName', key: 'userName', ellipsis: true },
                    { title: 'Logins', dataIndex: 'loginCount', key: 'loginCount', width: 80, sorter: (a, b) => a.loginCount - b.loginCount, defaultSortOrder: 'descend' },
                    {
                      title: 'Last Login', dataIndex: 'lastLogin', key: 'lastLogin', width: 150,
                      render: (d) => d ? new Date(d).toLocaleDateString() : '—',
                    },
                  ]}
                  rowKey="id"
                  pagination={false}
                  size="small"
                />
              ) : (
                <Empty description="No login data" />
              )}
            </Card>
          </Col>
        </Row>

        {/* Top Customers + Recent Activity */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <PermissionGuard permission="customers.view" fallback={null}>
            <Col xs={24} lg={12}>
              <Card
                title={<><CrownOutlined style={{ marginRight: 8, color: purple }} />Top Customers</>}
                loading={loading}
                extra={<Button type="link" size="small" onClick={() => navigate('/customers')}>View All</Button>}
              >
                {topCustomers.length > 0 ? (
                  <Table
                    scroll={{ x: 'max-content' }}
                    dataSource={topCustomers}
                    columns={[
                      {
                        title: '#', key: 'rank', width: 50,
                        render: (_, __, i) => <Badge count={i + 1} style={{ backgroundColor: i < 3 ? solidBg.warning : solidBg.neutral }} />,
                      },
                      {
                        title: 'Customer', key: 'name',
                        render: (_, record) => (
                          <Space>
                            <Avatar size="small" style={{ backgroundColor: solidBg.purple }}>
                              {(record.customer?.name || record.customer?.email || '?')[0].toUpperCase()}
                            </Avatar>
                            <div>
                              <Text strong>{record.customer?.name || 'Unknown'}</Text>
                              <br /><Text type="secondary" style={{ fontSize: 12 }}>{record.customer?.email}</Text>
                            </div>
                          </Space>
                        ),
                      },
                      { title: 'GPU hours', dataIndex: 'totalHours', key: 'totalHours', width: 90, render: (h) => (h || 0).toFixed(1) },
                      { title: 'Spend', dataIndex: 'totalSpend', key: 'totalSpend', width: 100, render: (v) => `$${(v || 0).toFixed(2)}` },
                    ]}
                    rowKey={(r, i) => r.customer?.email || `row-${i}`}
                    pagination={false}
                    size="small"
                  />
                ) : (
                  <Empty description="No customer data" />
                )}
              </Card>
            </Col>
          </PermissionGuard>

          <PermissionGuard permission="logs.view" fallback={null}>
            <Col xs={24} lg={12}>
              <Card
                title={<><ClockCircleOutlined style={{ marginRight: 8, color: blue }} />Recent Activity</>}
                loading={loading}
                extra={<Button type="link" size="small" onClick={() => navigate('/logs')}>View All</Button>}
                styles={{ body: { maxHeight: 450, overflowY: 'auto' } }}
              >
                {recentActivities.length > 0 ? (
                  <Timeline
                    items={recentActivities.map((a) => ({
                      color: activityColor(a.action),
                      children: (
                        <div>
                          <Text strong>{a.action}</Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {a.performedBy?.name || a.userName || 'System'} — {new Date(a.createdAt).toLocaleString()}
                          </Text>
                          {a.description && <><br /><Text type="secondary" style={{ fontSize: 11 }}>{a.description}</Text></>}
                        </div>
                      ),
                    }))}
                  />
                ) : (
                  <Empty description="No recent activity" />
                )}
              </Card>
            </Col>
          </PermissionGuard>
        </Row>
      </>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // TAB 2: REVENUE & BILLING (admin/super_admin ONLY)
  // ═══════════════════════════════════════════════════════════
  const renderRevenueTab = () => {
    if (!canSeeRevenue) {
      return (
        <Card>
          <Empty
            image={<LockOutlined style={{ fontSize: 48, color: muted(isDark) }} />}
            description={<Text type="secondary">Revenue data is restricted to Admin and Super Admin roles.</Text>}
          />
        </Card>
      );
    }

    return (
      <>
        {/* Revenue KPIs */}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <StatCard title="Monthly Revenue" value={revenueStats?.mrr} icon={<DollarOutlined />} color={purple} prefix="$" loading={loading}
              suffix={revenueStats?.mrrGrowth && revenueStats.mrrGrowth !== '0%' ? (
                <Text style={{ fontSize: 12, color: parseFloat(revenueStats.mrrGrowth) >= 0 ? success : error }}>
                  {parseFloat(revenueStats.mrrGrowth) >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {revenueStats.mrrGrowth} vs last month
                </Text>
              ) : null}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <StatCard title="Annual Run Rate" value={revenueStats?.arr} icon={<FundOutlined />} color={blue} prefix="$" loading={loading} />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <StatCard title="ARPU" value={revenueStats?.arpu} icon={<UserOutlined />} color={green} prefix="$" loading={loading}
              suffix={<Text type="secondary" style={{ fontSize: 12 }}>per paying customer/month</Text>}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <StatCard title="Total Revenue" value={revenueStats?.totalAllTime} icon={<CrownOutlined />} color={amber} prefix="$" loading={loading}
              suffix={<Text type="secondary" style={{ fontSize: 12 }}>{formatNumber(revenueStats?.totalPayments || 0)} payments</Text>}
            />
          </Col>
        </Row>

        {/* Revenue Trend Chart */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24}>
            <Card
              title={<><LineChartOutlined style={{ marginRight: 8, color: purple }} />Revenue Trend</>}
              loading={loading}
            >
              {revenueStats?.trend?.length > 0 && Line ? (
                <Line
                  {...chartConfig(isDark)}
                  data={revenueStats.trend}
                  xField="date"
                  yField="revenue"
                  smooth
                  height={300}
                  style={{ lineWidth: 2 }}
                  color={purple}
                  point={{ shapeField: 'square', sizeField: 2 }}
                  interaction={{ tooltip: { marker: true } }}
                  area={{ style: { fill: `l(270) 0:${purple}20 1:${purple}05` } }}
                />
              ) : (
                <Empty description="No revenue data for this period" />
              )}
            </Card>
          </Col>
        </Row>

        {/* Advanced Metrics Row */}
        {advancedRevenue && (
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} sm={12} lg={6}>
              <StatCard title="Net Revenue" value={advancedRevenue.netRevenue} icon={<DollarOutlined />} color={green} prefix="$" loading={loading} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard title="Avg Transaction" value={advancedRevenue.averageTransaction} icon={<DollarOutlined />} color={blue} prefix="$" loading={loading} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard title="Success Rate" value={advancedRevenue.paymentSuccessRate} icon={<CheckCircleOutlined />} color={success} loading={loading}
                suffix={<Text type="secondary" style={{ fontSize: 12 }}>{advancedRevenue.succeededPayments} / {advancedRevenue.succeededPayments + advancedRevenue.failedPayments}</Text>}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard title="Refunds" value={advancedRevenue.refunds?.total} icon={<WarningOutlined />} color={amber} prefix="$" loading={loading}
                suffix={<Text type="secondary" style={{ fontSize: 12 }}>{advancedRevenue.refunds?.count || 0} refunded</Text>}
              />
            </Col>
          </Row>
        )}

        {/* Monthly Revenue Trend (bar chart) */}
        {advancedRevenue && (
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24}>
              <Card
                title={<><BarChartOutlined style={{ marginRight: 8, color: green }} />Monthly Revenue (Last 12 Months)</>}
                loading={loading}
              >
                {advancedRevenue.monthlyRevenueTrend?.length > 0 && Column ? (
                  <Column
                    {...chartConfig(isDark)}
                    data={advancedRevenue.monthlyRevenueTrend}
                    xField="month"
                    yField="revenue"
                    height={280}
                    color={purple}
                    label={{ text: (d) => `$${d.revenue}`, position: 'outside' }}
                    interaction={{ tooltip: { marker: true } }}
                  />
                ) : (
                  <Empty description="No monthly data" />
                )}
              </Card>
            </Col>
          </Row>
        )}

        {/* Payment Status Breakdown */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={12}>
            <Card
              title={<><CheckCircleOutlined style={{ marginRight: 8, color: success }} />Payment Status Breakdown</>}
              loading={loading}
            >
              {revenueStats?.paymentStatus?.length > 0 ? (
                <>
                  {revenueStats.paymentStatus.map((s) => {
                    const color = { succeeded: success, pending: warning, failed: error, refunded: info, cancelled: muted(isDark) }[s.status] || muted(isDark);
                    return (
                      <div key={s.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${hairline(isDark)}` }}>
                        <Space>
                          <Badge color={color} />
                          <Text style={{ textTransform: 'capitalize' }}>{s.status}</Text>
                        </Space>
                        <Space size={20}>
                          <Text type="secondary">{s.count} payments</Text>
                          <Text strong>${formatNumber(s.total)}</Text>
                        </Space>
                      </div>
                    );
                  })}
                </>
              ) : (
                <Empty description="No payment data" />
              )}
            </Card>
          </Col>
        </Row>

        {/* Recent Payments */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={advancedRevenue?.topPayers?.length > 0 ? 14 : 24}>
            <Card
              title={<><ClockCircleOutlined style={{ marginRight: 8, color: amber }} />Recent Payments</>}
              loading={loading}
            >
              {revenueStats?.recentPayments?.length > 0 ? (
                <Table
                  scroll={{ x: 'max-content' }}
                  dataSource={revenueStats.recentPayments}
                  columns={[
                    {
                      title: 'Customer', key: 'user',
                      render: (_, record) => (
                        <Space>
                          <Avatar size="small" style={{ backgroundColor: solidBg.purple }}>
                            {(record.user?.name || record.user?.email || '?')[0].toUpperCase()}
                          </Avatar>
                          <div>
                            <Text strong>{record.user?.name || 'Unknown'}</Text>
                            <br /><Text type="secondary" style={{ fontSize: 12 }}>{record.user?.email}</Text>
                          </div>
                        </Space>
                      ),
                    },
                    {
                      title: 'Amount', dataIndex: 'amount', key: 'amount',
                      render: (v) => <Text strong style={{ color: success }}>${v}</Text>,
                    },
                    {
                      title: 'Date', dataIndex: 'paidAt', key: 'paidAt',
                      render: (d) => d ? new Date(d).toLocaleDateString() : '—',
                    },
                  ]}
                  rowKey="id"
                  pagination={{ pageSize: 5 }}
                  size="small"
                />
              ) : (
                <Empty description="No payments yet" />
              )}
            </Card>
          </Col>

          {/* Top Paying Customers */}
          {advancedRevenue?.topPayers?.length > 0 && (
            <Col xs={24} lg={10}>
              <Card
                title={<><TrophyOutlined style={{ marginRight: 8, color: amber }} />Top Paying Customers</>}
                loading={loading}
              >
                <Table
                  scroll={{ x: 'max-content' }}
                  dataSource={advancedRevenue.topPayers}
                  columns={[
                    {
                      title: '#', key: 'rank', width: 40,
                      render: (_, __, i) => <Badge count={i + 1} style={{ backgroundColor: i < 3 ? solidBg.warning : solidBg.neutral }} />,
                    },
                    {
                      title: 'Customer', key: 'name',
                      render: (_, r) => (
                        <div>
                          <Text strong>{r.name}</Text>
                          <br /><Text type="secondary" style={{ fontSize: 11 }}>{r.email}</Text>
                        </div>
                      ),
                    },
                    {
                      title: 'Total Spent', dataIndex: 'totalSpent', key: 'totalSpent',
                      render: (v) => <Text strong style={{ color: success }}>${formatNumber(v)}</Text>,
                      sorter: (a, b) => a.totalSpent - b.totalSpent,
                      defaultSortOrder: 'descend',
                    },
                    { title: 'Payments', dataIndex: 'payments', key: 'payments', width: 80 },
                  ]}
                  rowKey="userId"
                  pagination={false}
                  size="small"
                />
              </Card>
            </Col>
          )}
        </Row>
      </>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════
  const tabItems = [
    {
      key: 'overview',
      label: <span><BarChartOutlined /> Overview & Users</span>,
      children: renderOverviewTab(),
    },
    {
      key: 'revenue',
      label: (
        <span>
          <DollarOutlined /> Revenue & Billing
          {!canSeeRevenue && <LockOutlined style={{ marginLeft: 4, fontSize: 11 }} />}
        </span>
      ),
      children: renderRevenueTab(),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Analytics Dashboard"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Analytics' }]}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>Refresh</Button>
            <Segmented
              options={[
                { label: '7 Days', value: '7d' },
                { label: '30 Days', value: '30d' },
                { label: '90 Days', value: '90d' },
              ]}
              value={timeframe}
              onChange={setTimeframe}
            />
          </Space>
        }
      />

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          title={loadError}
          action={<Button size="small" onClick={fetchData}>Retry</Button>}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="card"
        size="large"
        items={tabItems}
        style={{ marginTop: 8 }}
      />
    </div>
  );
};

export default AnalyticsPage;
