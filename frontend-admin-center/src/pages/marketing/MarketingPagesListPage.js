import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, message, Tag, DatePicker,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  GlobalOutlined, EyeOutlined, EyeInvisibleOutlined,
  HomeOutlined, FileTextOutlined, CheckCircleOutlined, CopyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import PermissionGuard from '../../components/guards/PermissionGuard';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import { usePermission } from '../../hooks/usePermission';
import marketingApi from '../../api/marketingApi';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted, subtle } from '../../theme/colors';

const { RangePicker } = DatePicker;

const MarketingPagesListPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { isDark } = useTheme();
  const purple = TILE.purple.fg(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: [], navigation: [], dateRange: null });
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      const data = await marketingApi.getPages(params);
      setPages(data.pages || []);
    } catch {
      message.error('Failed to load pages');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  // Client-side filtering
  const filteredPages = pages.filter((p) => {
    // Status filter (OR)
    if (filters.status.length > 0 && !filters.status.includes(p.status)) return false;
    // Navigation filter (OR)
    if (filters.navigation.length > 0) {
      const navVal = p.showInNavigation ? 'yes' : 'no';
      if (!filters.navigation.includes(navVal)) return false;
    }
    // Date range filter
    if (filters.dateRange && filters.dateRange[0] && filters.dateRange[1]) {
      const updated = new Date(p.updatedAt);
      const start = filters.dateRange[0].startOf('day').toDate();
      const end = filters.dateRange[1].endOf('day').toDate();
      if (updated < start || updated > end) return false;
    }
    return true;
  });

  const totalPages = pages.length;
  const publishedPages = pages.filter((p) => p.status === 'published').length;
  const draftPages = pages.filter((p) => p.status === 'draft').length;
  const navPages = pages.filter((p) => p.showInNavigation).length;

  const handleClearFilters = () => {
    setSearch('');
    setFilters({ status: [], navigation: [], dateRange: null });
  };

  const handleDelete = async (id) => {
    try {
      await marketingApi.deletePage(id);
      message.success('Page deleted');
      fetchPages();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete page');
    }
  };

  const handleBulkDelete = async (keys) => {
    try {
      const res = await marketingApi.bulkDeletePages(keys);
      message.success(res.message || `${res.deletedCount} page(s) deleted`);
      setSelectedRowKeys([]);
      fetchPages();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete pages');
    }
  };

  const handleStatusToggle = async (record) => {
    const newStatus = record.status === 'published' ? 'draft' : 'published';
    try {
      await marketingApi.updatePageStatus(record.id, newStatus);
      message.success(`Page ${newStatus}`);
      fetchPages();
    } catch {
      message.error('Failed to update status');
    }
  };

  const handleClone = async (id) => {
    try {
      const data = await marketingApi.clonePage(id);
      message.success(data.message || 'Page cloned');
      fetchPages();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to clone page');
    }
  };

  const statusColorMap = {
    published: 'green',
    draft: 'orange',
    archived: 'red',
  };

  const columns = [
    {
      title: 'Page',
      dataIndex: 'title',
      key: 'title',
      render: (title, record) => (
        <Space>
          {record.isHomePage && <HomeOutlined style={{ color: purple }} />}
          <span style={{ fontWeight: 600 }}>{title}</span>
        </Space>
      ),
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      render: (slug, record) => (
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: muted(isDark) }}>
          /{record.isHomePage ? '' : slug}
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status) => (
        <Tag color={statusColorMap[status]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Tag>
      ),
    },
    {
      title: 'Navigation',
      dataIndex: 'showInNavigation',
      key: 'showInNavigation',
      width: 90,
      align: 'center',
      render: (show) => show ? <CheckCircleOutlined style={{ color: success }} /> : <span style={{ color: subtle(isDark) }}>—</span>,
    },
    {
      title: 'Order',
      dataIndex: 'navigationOrder',
      key: 'navigationOrder',
      width: 65,
      align: 'center',
    },
    {
      title: 'Last Updated',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 165,
      render: (date) => date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
    },
    rowActions([
      {
        key: 'unpublish', icon: <EyeInvisibleOutlined />, label: 'Unpublish',
        permission: PERMISSIONS.SETTINGS_EDIT, visible: (r) => r.status === 'published',
        onClick: handleStatusToggle,
      },
      {
        key: 'publish', icon: <EyeOutlined />, label: 'Publish',
        permission: PERMISSIONS.SETTINGS_EDIT, visible: (r) => r.status !== 'published',
        onClick: handleStatusToggle,
      },
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        onClick: (r) => navigate(`/marketing/pages/${r.id}/edit`),
      },
      {
        key: 'clone', icon: <CopyOutlined />, label: 'Clone',
        permission: PERMISSIONS.SETTINGS_EDIT, onClick: (r) => handleClone(r.id),
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        permission: PERMISSIONS.SETTINGS_EDIT, visible: (r) => !r.isHomePage,
        confirm: { title: 'Delete this page?', description: 'This action cannot be undone.' },
        onClick: (r) => handleDelete(r.id),
      },
    ], { maxVisible: 4 }),
  ];

  return (
    <div>
      <PageHeader
        title="Marketing Pages"
        subtitle="Every page on the public marketing site"
        count={totalPages}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Website' }, { label: 'Pages' }]}
        extra={
          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/marketing/pages/new')}>
              New Page
            </Button>
          </PermissionGuard>
        }
      />

      <StatRow>
        <StatCard count={4} tone="blue" icon={<FileTextOutlined />} label="Total Pages" value={totalPages} />
        <StatCard count={4} tone="green" icon={<GlobalOutlined />} label="Published" value={publishedPages} />
        <StatCard count={4} tone="amber" icon={<EditOutlined />} label="Drafts" value={draftPages} />
        <StatCard count={4} tone="purple" icon={<CheckCircleOutlined />} label="In Navigation" value={navPages} />
      </StatRow>

      <DataTable
        title="Pages"
        count={filteredPages.length}
        search={{ value: search, onChange: (e) => setSearch(e.target.value), placeholder: 'Search pages...' }}
        filters={[
          {
            key: 'status', placeholder: 'Status', mode: 'multiple',
            options: [
              { value: 'published', label: 'Published' },
              { value: 'draft', label: 'Draft' },
              { value: 'archived', label: 'Archived' },
            ],
          },
          {
            key: 'navigation', placeholder: 'Navigation', mode: 'multiple',
            options: [
              { value: 'yes', label: 'In Navigation' },
              { value: 'no', label: 'Not in Navigation' },
            ],
          },
        ]}
        filterValues={filters}
        onFilterChange={(key, v) => setFilters((prev) => ({ ...prev, [key]: v || [] }))}
        onClearFilters={handleClearFilters}
        onRefresh={fetchPages}
        refreshLoading={loading}
        toolbarExtra={
          <RangePicker
            showTime={{ use12Hours: true, format: 'hh:mm A' }}
            format="YYYY-MM-DD hh:mm A"
            value={filters.dateRange}
            onChange={(dates) => setFilters((prev) => ({ ...prev, dateRange: dates }))}
            placeholder={['Updated From', 'Updated To']}
          />
        }
        selection={hasPermission(PERMISSIONS.SETTINGS_EDIT) ? {
          enabled: true,
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          actions: [{
            key: 'delete', label: 'Delete Selected', danger: true, icon: <DeleteOutlined />,
            confirm: { title: `Delete ${selectedRowKeys.length} page(s)?`, description: 'Home page cannot be deleted.' },
            onClick: handleBulkDelete,
          }],
        } : undefined}
        empty={{ title: 'No pages found', description: 'Try adjusting your search or filters.' }}
        dataSource={filteredPages}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="middle"
      />
    </div>
  );
};

export default MarketingPagesListPage;
