import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, message, Tag,
  Typography, Badge,
} from 'antd';
import {
  CloudServerOutlined, ClockCircleOutlined,
  ThunderboltOutlined, EyeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import deploymentsApi from '../../api/deploymentsApi';

const { Text } = Typography;

export const STATUS_META = {
  pending_review: { color: 'blue', label: 'Pending review' },
  approved: { color: 'cyan', label: 'Approved' },
  rejected: { color: 'red', label: 'Rejected' },
  provisioning: { color: 'processing', label: 'Provisioning' },
  running: { color: 'green', label: 'Running' },
  paused: { color: 'orange', label: 'Paused' },
  stopped: { color: 'default', label: 'Stopped' },
  failed: { color: 'red', label: 'Failed' },
  terminated: { color: 'default', label: 'Terminated' },
};

const DeploymentsListPage = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [deployments, setDeployments] = useState([]);
  const [statusCounts, setStatusCounts] = useState({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState();

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (search) params.search = search;
      if (status) params.status = status;
      const data = await deploymentsApi.getDeployments(params);
      setDeployments(data.deployments || []);
      setStatusCounts(data.statusCounts || {});
    } catch {
      message.error('Failed to load deployments');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => { fetch(); }, [fetch]);

  const pending = statusCounts.pending_review || 0;
  const running = statusCounts.running || 0;
  const burnRate = deployments
    .filter((d) => d.status === 'running')
    .reduce((sum, d) => sum + d.pricePerHour * (1 - (d.planDiscountPercent || 0) / 100), 0);

  const columns = [
    {
      title: 'Deployment',
      width: 255,
      dataIndex: 'deploymentName',
      render: (name, row) => (
        <Space direction="vertical" size={2}>
          <Button type="link" style={{ padding: 0, height: 'auto', fontWeight: 600 }} onClick={() => navigate(`/deployments/${row.id}`)}>
            {name}
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.model?.name} on {row.tier?.name}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Customer',
      key: 'customer',
      width: 195,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>{row.userId?.name || '—'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.userId?.email}</Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (s, row) => {
        const meta = STATUS_META[s] || { color: 'default', label: s };
        return (
          <Space direction="vertical" size={2}>
            <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
            {row.autoSuspendedForCredit && <Text type="danger" style={{ fontSize: 11 }}>No credit</Text>}
          </Space>
        );
      },
    },
    {
      title: 'Rate',
      dataIndex: 'pricePerHour',
      width: 104,
      align: 'right',
      sorter: (a, b) => a.pricePerHour - b.pricePerHour,
      render: (p, row) => (
        <Text>{row.currency} {(p * (1 - (row.planDiscountPercent || 0) / 100)).toFixed(2)}<Text type="secondary" style={{ fontSize: 11 }}>/hr</Text></Text>
      ),
    },
    {
      title: 'Revenue',
      dataIndex: 'totalCost',
      width: 104,
      align: 'right',
      sorter: (a, b) => (a.totalCost || 0) - (b.totalCost || 0),
      render: (c, row) => <Text strong>{row.currency} {(c || 0).toFixed(2)}</Text>,
    },
    {
      title: 'Assigned',
      key: 'assigned',
      width: 92,
      render: (_, row) =>
        row.assignedTo ? <Text style={{ fontSize: 12 }}>{row.assignedTo.name}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>Unassigned</Text>,
    },
    {
      title: 'Requested',
      dataIndex: 'createdAt',
      width: 95,
      sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      render: (d) => <Text type="secondary" style={{ fontSize: 12 }}>{new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>,
    },
    rowActions([
      { key: 'view', icon: <EyeOutlined />, label: 'View', onClick: (r) => navigate(`/deployments/${r.id}`) },
    ], { width: 60 }),
  ];

  return (
    <div>
      <PageHeader
        title="Deployments"
        subtitle="Every deployment request across the platform"
        count={deployments.length}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'AI Infrastructure' }, { label: 'Deployments' }]}
      />

      <StatRow>
        <StatCard
          count={3} tone="blue" icon={<ClockCircleOutlined />} label="Awaiting Review"
          value={pending} onClick={() => setStatus('pending_review')}
        />
        <StatCard
          count={3} tone="green" icon={<CloudServerOutlined />} label="Running"
          value={running} onClick={() => setStatus('running')}
        />
        <StatCard
          count={3} tone="amber" icon={<ThunderboltOutlined />} label="Platform Burn Rate"
          value={burnRate.toFixed(2)} suffix="/hr"
        />
      </StatRow>

      <DataTable
        title="Deployments"
        count={deployments.length}
        search={{ value: search, onChange: (e) => setSearch(e.target.value), placeholder: 'Search by deployment name…' }}
        filters={[
          {
            key: 'status', placeholder: 'Any status',
            options: Object.entries(STATUS_META).map(([value, m]) => ({
              value,
              label: (
                <Space>
                  <Badge color={m.color === 'processing' ? 'blue' : m.color} />
                  {m.label}
                  {statusCounts[value] ? <Text type="secondary">({statusCounts[value]})</Text> : null}
                </Space>
              ),
            })),
          },
        ]}
        filterValues={{ status }}
        onFilterChange={(_, v) => setStatus(v)}
        onClearFilters={() => { setSearch(''); setStatus(undefined); }}
        onRefresh={fetch}
        refreshLoading={loading}
        empty={{ title: 'No deployment requests yet' }}
        columns={columns}
        dataSource={deployments}
        rowKey="id"
        loading={loading}
        pagination={deployments.length > 20 ? { pageSize: 20 } : false}
        scroll={{ x: 980 }}
      />
    </div>
  );
};

export default DeploymentsListPage;
