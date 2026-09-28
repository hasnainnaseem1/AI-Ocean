import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Table, Segmented, Space, Typography, Avatar, Badge, Empty, Button, Alert } from 'antd';
import {
  TeamOutlined, UserOutlined, DollarOutlined,
  ArrowUpOutlined, ClockCircleOutlined,
  TrophyOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { usePermission } from '../hooks/usePermission';
import GrowthChart from '../components/charts/GrowthChart';
import TrendChart from '../components/charts/TrendChart';
import PermissionGuard from '../components/guards/PermissionGuard';
import { StatRow, StatCard } from '../components/StatRow';
import { StatCardsSkeleton } from '../components/Skeletons';
import analyticsApi from '../api/analyticsApi';
import { timeAgo, formatNumber } from '../utils/helpers';
import StatusTag from '../components/common/StatusTag';
import { useTheme } from '../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted, solidBg } from '../theme/colors';

const { Text } = Typography;

const DashboardPage = () => {
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState('30d');
  const [overview, setOverview] = useState(null);
  const [growthData, setGrowthData] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const navigate = useNavigate();
  const { isDark } = useTheme();
  const purple = TILE.purple.fg(isDark);
  const blue = TILE.blue.fg(isDark);
  const amber = TILE.amber.fg(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];

  // Revenue is its own permission, granted from Admin Center → Roles, rather
  // than a hardcoded role name — so an operator can build a role that sees
  // usage and growth but not money.
  const { hasPermission } = usePermission();
  const canSeeRevenue = hasPermission('analytics.revenue');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const results = await Promise.allSettled([
        analyticsApi.getOverview(timeframe),
        analyticsApi.getUsersGrowth(timeframe),
        analyticsApi.getDeploymentsTrend(timeframe),
        analyticsApi.getTopCustomers(5),
        analyticsApi.getRecentActivities(10),
      ]);
      const [overviewRes, growthRes, trendRes, topRes, recentRes] = results;

      if (overviewRes.status === 'fulfilled') setOverview(overviewRes.value.overview);
      if (growthRes.status === 'fulfilled') setGrowthData(growthRes.value.data || []);
      if (trendRes.status === 'fulfilled') setTrendData(trendRes.value.data || []);
      if (topRes.status === 'fulfilled') setTopCustomers(topRes.value.topCustomers || []);
      if (recentRes.status === 'fulfilled') setRecentActivities(recentRes.value.activities || []);

      /**
       * `Promise.allSettled` never rejects, so the catch below was dead code —
       * a total outage left every panel on its initial empty state and the page
       * confidently reported "0 users, 0 customers, $0 revenue". Failures have
       * to be surfaced explicitly, or the operator reads an outage as data.
       */
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) {
        setLoadError(overviewRes.status === 'rejected'
          ? 'Could not load dashboard data. The figures below are not current.'
          : 'Some dashboard panels could not be loaded. What is shown may be incomplete.');
      }
    } catch {
      setLoadError('Could not load dashboard data. The figures below are not current.');
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Activity Table Columns ───
  // This table lives in a half-width dashboard card (~500px), not on a full
  // page. Five separate columns left the Description — the only part that
  // says what actually happened — about 55px, so every row read
  // "Successful Super Admi…". Stacking the user over the description turns
  // the widest column into the flexible one and lets the two fixed columns
  // that follow keep their real widths.
  const activityColumns = [
    {
      title: 'Activity',
      key: 'activity',
      render: (_, r) => (
        <Space direction="vertical" size={0} style={{ minWidth: 0, display: 'flex' }}>
          <Text strong style={{ fontSize: 12.5 }}>{r.userName || 'System'}</Text>
          <Text type="secondary" style={{ fontSize: 11.5 }}>{r.description || r.action}</Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 92,
      render: (status) => <StatusTag status={status} />,
    },
    {
      title: 'Time',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 112,
      align: 'right',
      render: (date) => <Text type="secondary" style={{ fontSize: 11.5 }}>{timeAgo(date)}</Text>,
    },
  ];

  // ─── Top Customer Columns ───
  const topCustomerColumns = [
    {
      title: '#',
      key: 'rank',
      width: 46,
      render: (_, __, i) => (
        <Badge
          count={i + 1}
          style={{
            backgroundColor: i < 3 ? solidBg.warning : solidBg.neutral,
          }}
        />
      ),
    },
    {
      title: 'Customer',
      key: 'name',
      render: (_, record) => (
        <Space>
          <Avatar size="small" style={{ backgroundColor: solidBg.purple }}>
            {(record.customer?.name || record.customer?.email || '?')[0].toUpperCase()}
          </Avatar>
          <div>
            <Text strong>{record.customer?.name || 'Unknown'}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{record.customer?.email}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'GPU hrs',
      dataIndex: 'totalHours',
      key: 'totalHours',
      width: 82,
      align: 'right',
      render: (h) => (h || 0).toFixed(1),
    },
    {
      title: 'Spend',
      dataIndex: 'totalSpend',
      key: 'totalSpend',
      width: 88,
      align: 'right',
      render: (v) => `$${(v || 0).toFixed(2)}`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        breadcrumbs={[{ label: 'Dashboard' }]}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading} size="small">Refresh</Button>
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
          style={{ marginBottom: 16 }}
          title={loadError}
          action={<Button size="small" onClick={fetchData}>Retry</Button>}
        />
      )}

      {/* ─── KPI Row ─── */}
      {loading && !overview ? (
        <StatCardsSkeleton count={3} />
      ) : (
        <StatRow>
          <StatCard
            count={canSeeRevenue ? 3 : 2}
            tone="purple"
            icon={<TeamOutlined />}
            label="Total Users"
            value={formatNumber(overview?.users?.total ?? 0)}
            onClick={() => navigate('/users')}
            caption={overview?.users?.growth && overview.users.growth !== '0%' ? (
              <span style={{ color: success }}><ArrowUpOutlined /> {overview.users.growth} growth</span>
            ) : undefined}
          />
          <StatCard
            count={canSeeRevenue ? 3 : 2}
            tone="blue"
            icon={<UserOutlined />}
            label="Active Customers"
            value={formatNumber(overview?.customers?.active ?? 0)}
            onClick={() => navigate('/customers')}
            caption={overview?.customers?.pendingVerification > 0 ? (
              <span style={{ color: warning }}>{overview.customers.pendingVerification} pending</span>
            ) : undefined}
          />
          {canSeeRevenue && (
            <StatCard
              count={3}
              tone="amber"
              icon={<DollarOutlined />}
              label="Monthly Revenue"
              value={`$${formatNumber(overview?.revenue?.monthly ?? 0)}`}
              onClick={() => navigate('/analytics')}
            />
          )}
        </StatRow>
      )}

      {/* ─── Charts: User Growth + Analysis Trends ─── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={24}>
          <GrowthChart data={growthData} loading={loading} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={24}>
          <TrendChart data={trendData} loading={loading} />
        </Col>
      </Row>

      {/* ─── Top Customers + Recent Activity ─── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <PermissionGuard permission="customers.view" fallback={null}>
          <Col xs={24} lg={12}>
            <Card
              title={<><TrophyOutlined style={{ marginRight: 8, color: amber }} />Top Customers</>}
              loading={loading}
              extra={<Button type="link" size="small" onClick={() => navigate('/customers')}>View All</Button>}
            >
              {topCustomers.length > 0 ? (
                <Table
                  scroll={{ x: 'max-content' }}
                  dataSource={topCustomers}
                  columns={topCustomerColumns}
                  pagination={false}
                  size="small"
                  rowKey={(r, i) => r.customer?.email || `row-${i}`}
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
            >
              {recentActivities.length > 0 ? (
                <Table
                  scroll={{ x: 'max-content' }}
                  dataSource={recentActivities}
                  columns={activityColumns}
                  pagination={false}
                  size="small"
                  rowKey={(r, i) => r.id || `row-${i}`}
                />
              ) : (
                <Empty description="No recent activity" />
              )}
            </Card>
          </Col>
        </PermissionGuard>
      </Row>
    </div>
  );
};

export default DashboardPage;
