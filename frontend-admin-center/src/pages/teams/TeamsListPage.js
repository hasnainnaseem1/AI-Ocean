import React, { useCallback, useEffect, useState } from 'react';
import { message, Tag, Button, Typography } from 'antd';
import {
  TeamOutlined, WarningOutlined, DollarOutlined, EyeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import teamsApi from '../../api/teamsApi';
import { DEFAULT_PAGE_SIZE } from '../../utils/constants';
import { formatDateTime } from '../../utils/helpers';

const { Text } = Typography;

const money = (value, currency) => `${currency || 'USD'} ${Number(value || 0).toFixed(2)}`;

/**
 * Every organization on the platform.
 *
 * The columns are the ones an operator scans for rather than everything an
 * organization has: how many people are in it, what it holds, what it owes,
 * and whether anything is currently stopping it from spending. The detail page
 * is one click away for the rest.
 */
const TeamsListPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0 });
  const [filters, setFilters] = useState({ search: '', status: '' });

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const data = await teamsApi.getTeams({
        page: pagination.current,
        limit: pagination.pageSize,
        search: filters.search,
        status: filters.status,
      });
      setTeams(data.teams || []);
      setPagination((prev) => ({ ...prev, total: data.pagination?.total || 0 }));
    } catch {
      message.error('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, [pagination.current, pagination.pageSize, filters]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  const owing = teams.filter((t) => t.outstanding > 0).length;
  const held = teams.filter((t) => t.disputeHold).length;

  const columns = [
    {
      title: 'Organization',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name, record) => (
        <div>
          <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/teams/${record.id}`)}>
            {name}
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.owner?.email || '—'}
              {record.domain ? ` · ${record.domain}` : ''}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Members',
      dataIndex: 'members',
      key: 'members',
      width: 100,
      align: 'right',
    },
    {
      title: 'Deployments',
      dataIndex: 'deployments',
      key: 'deployments',
      width: 120,
      align: 'right',
    },
    {
      title: 'Balance',
      dataIndex: 'balance',
      key: 'balance',
      width: 130,
      align: 'right',
      render: (v, r) => money(v, r.currency),
    },
    {
      title: 'Outstanding',
      dataIndex: 'outstanding',
      key: 'outstanding',
      width: 130,
      align: 'right',
      render: (v, r) => (v > 0
        ? <Text type="danger">{money(v, r.currency)}</Text>
        : <Text type="secondary">—</Text>),
    },
    {
      title: 'Status',
      key: 'status',
      width: 190,
      render: (_, r) => (
        <>
          {r.disputeHold && <Tag color="red">Dispute hold</Tag>}
          {r.paygAccess === 'blocked' && <Tag color="orange">PAYG blocked</Tag>}
          {r.paygAccess === 'allowed' && <Tag color="green">PAYG allowed</Tag>}
          {r.closedAt && <Tag>Closed</Tag>}
          {!r.disputeHold && r.paygAccess === 'default' && !r.closedAt && <Text type="secondary">—</Text>}
        </>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (d) => formatDateTime(d),
    },
    rowActions([
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: (r) => navigate(`/teams/${r.id}`) },
    ]),
  ];

  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="Shared customer accounts — their people, their money and what is holding them"
        count={pagination.total}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Organizations' }]}
      />

      <StatRow>
        <StatCard count={3} tone="blue" icon={<TeamOutlined />} label="On this page" value={teams.length} />
        <StatCard count={3} tone="red" icon={<DollarOutlined />} label="Owing money" value={owing} />
        <StatCard count={3} tone="orange" icon={<WarningOutlined />} label="On dispute hold" value={held} />
      </StatRow>

      <DataTable
        title="Organizations"
        count={pagination.total}
        search={{
          value: filters.search,
          onChange: (e) => {
            setFilters((p) => ({ ...p, search: e.target.value }));
            setPagination((p) => ({ ...p, current: 1 }));
          },
          placeholder: 'Search by organization or owner',
        }}
        filters={[{
          key: 'status',
          placeholder: 'Status',
          options: [
            { value: 'hold', label: 'On dispute hold' },
            { value: 'closed', label: 'Closed' },
          ],
        }]}
        filterValues={filters}
        onFilterChange={(key, value) => {
          setFilters((p) => ({ ...p, [key]: value || '' }));
          setPagination((p) => ({ ...p, current: 1 }));
        }}
        onClearFilters={() => {
          setFilters({ search: '', status: '' });
          setPagination((p) => ({ ...p, current: 1 }));
        }}
        onRefresh={fetchTeams}
        refreshLoading={loading}
        empty={{
          title: 'No organizations yet',
          description: 'Customers who choose "my team or company" at sign-up appear here.',
        }}
        columns={columns}
        dataSource={teams}
        rowKey="id"
        loading={loading}
        pagination={pagination}
        onChange={(pag) => setPagination((p) => ({ ...p, current: pag.current, pageSize: pag.pageSize }))}
      />
    </div>
  );
};

export default TeamsListPage;
