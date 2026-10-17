import React, { useCallback, useEffect, useState } from 'react';
import { message, Tag, Button, Typography } from 'antd';
import {
  CustomerServiceOutlined, ClockCircleOutlined, UserAddOutlined, EyeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import supportApi from '../../api/supportApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { DEFAULT_PAGE_SIZE } from '../../utils/constants';
import { formatDateTime } from '../../utils/helpers';

const { Text } = Typography;

const STATUS_COLOR = { open: 'blue', pending: 'orange', solved: 'green' };
const STATUS_LABEL = { open: 'Open', pending: 'Pending', solved: 'Solved' };
const CATEGORY_LABEL = {
  general: 'General', billing: 'Billing', technical: 'Technical', deployment: 'Deployment',
};

/**
 * Every support ticket, for whoever is answering them.
 *
 * The columns are what an operator scans a queue for: who is asking, what
 * about, whether it is theirs to handle, and how long it has sat. The detail
 * page is one click away for the actual thread.
 */
const SupportTicketsListPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canManage = hasPermission(PERMISSIONS.SUPPORT_MANAGE);

  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0 });
  const [filters, setFilters] = useState({
    search: '', status: '', category: '', assigned: '',
  });

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await supportApi.getTickets({
        page: pagination.current,
        limit: pagination.pageSize,
        search: filters.search,
        status: filters.status,
        category: filters.category,
        assigned: filters.assigned,
      });
      setTickets(data.tickets || []);
      setPagination((prev) => ({ ...prev, total: data.pagination?.total || 0 }));
    } catch {
      // A silent background poll failing shouldn't interrupt someone
      // reading the queue with a toast — the next poll just tries again.
      if (!silent) message.error('Failed to load tickets');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [pagination.current, pagination.pageSize, filters]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // A new ticket, or a reply that moves one's status, should show up on
  // this queue without anyone having to hit refresh — the same 30s cadence
  // the notification bell already polls at (NotificationsDropdown.js).
  useEffect(() => {
    const interval = setInterval(() => fetchTickets(true), 30000);
    return () => clearInterval(interval);
  }, [fetchTickets]);

  const awaiting = tickets.filter((t) => t.status !== 'solved').length;
  const unassigned = tickets.filter((t) => !t.assignedAdmin).length;

  const columns = [
    {
      title: 'Ticket',
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
      render: (subject, record) => (
        <div>
          <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/support-tickets/${record.id}`)}>
            #{record.number} — {subject}
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.customer?.name || record.customer?.email || '—'}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (c) => <Tag>{CATEGORY_LABEL[c] || c}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s) => <Tag color={STATUS_COLOR[s] || 'default'}>{STATUS_LABEL[s] || s}</Tag>,
    },
    {
      title: 'Assigned to',
      key: 'assignedAdmin',
      width: 160,
      render: (_, r) => (r.assignedAdmin
        ? r.assignedAdmin.name
        : <Text type="secondary">Unassigned</Text>),
    },
    {
      title: 'Last activity',
      dataIndex: 'lastMessageAt',
      key: 'lastMessageAt',
      width: 170,
      render: (d) => formatDateTime(d),
    },
    rowActions([
      { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: (r) => navigate(`/support-tickets/${r.id}`) },
    ]),
  ];

  return (
    <div>
      <PageHeader
        title="Support Tickets"
        subtitle="Requests customers have raised, and who's answering them"
        count={pagination.total}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Support Tickets' }]}
      />

      <StatRow>
        <StatCard count={3} tone="blue" icon={<CustomerServiceOutlined />} label="On this page" value={tickets.length} />
        <StatCard count={3} tone="orange" icon={<ClockCircleOutlined />} label="Awaiting resolution" value={awaiting} />
        <StatCard count={3} tone="purple" icon={<UserAddOutlined />} label="Unassigned" value={unassigned} />
      </StatRow>

      <DataTable
        title="Support Tickets"
        count={pagination.total}
        search={{
          value: filters.search,
          onChange: (e) => {
            setFilters((p) => ({ ...p, search: e.target.value }));
            setPagination((p) => ({ ...p, current: 1 }));
          },
          placeholder: 'Search by subject or customer email',
        }}
        filters={[
          {
            key: 'status',
            placeholder: 'Status',
            options: [
              { value: 'open', label: 'Open' },
              { value: 'pending', label: 'Pending' },
              { value: 'solved', label: 'Solved' },
            ],
          },
          {
            key: 'category',
            placeholder: 'Category',
            options: [
              { value: 'general', label: 'General' },
              { value: 'billing', label: 'Billing' },
              { value: 'technical', label: 'Technical' },
              { value: 'deployment', label: 'Deployment' },
            ],
          },
          {
            key: 'assigned',
            placeholder: 'Assignment',
            options: [
              { value: 'me', label: 'Assigned to me' },
              { value: 'unassigned', label: 'Unassigned' },
            ],
          },
        ]}
        filterValues={filters}
        onFilterChange={(key, value) => {
          setFilters((p) => ({ ...p, [key]: value || '' }));
          setPagination((p) => ({ ...p, current: 1 }));
        }}
        onClearFilters={() => {
          setFilters({
            search: '', status: '', category: '', assigned: '',
          });
          setPagination((p) => ({ ...p, current: 1 }));
        }}
        onRefresh={fetchTickets}
        refreshLoading={loading}
        empty={{
          title: 'No support tickets',
          description: canManage ? 'Tickets customers raise will show up here.' : 'Nothing in the queue right now.',
        }}
        columns={columns}
        dataSource={tickets}
        rowKey="id"
        loading={loading}
        pagination={pagination}
        onChange={(pag) => setPagination((p) => ({ ...p, current: pag.current, pageSize: pag.pageSize }))}
      />
    </div>
  );
};

export default SupportTicketsListPage;
