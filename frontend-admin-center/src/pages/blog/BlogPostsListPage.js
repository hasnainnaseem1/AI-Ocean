import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, Tag, message,
  Tooltip, Image, DatePicker, Popconfirm,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  EyeOutlined, StarFilled,
  FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import blogApi from '../../api/blogApi';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, muted } from '../../theme/colors';

const { RangePicker } = DatePicker;

const BlogPostsListPage = () => {
  const { isDark } = useTheme();
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState({});
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [sorter, setSorter] = useState({});
  const [filters, setFilters] = useState({
    search: '',
    status: [],
    category: [],
    dateRange: null,
  });
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const fetchPosts = useCallback(async (page = 1, pageSize = pagination.pageSize) => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (filters.search) params.search = filters.search;
      if (filters.status.length) params.status = filters.status.join(',');
      if (filters.category.length) params.category = filters.category.join(',');
      if (filters.dateRange && filters.dateRange[0]) {
        params.dateFrom = filters.dateRange[0].toISOString();
        params.dateTo = filters.dateRange[1].toISOString();
      }
      if (sorter.field) {
        params.sortField = sorter.field;
        params.sortOrder = sorter.order;
      }

      const res = await blogApi.getPosts(params);
      if (res.success) {
        setPosts(res.posts);
        setPagination(prev => ({
          ...prev,
          current: res.pagination.page,
          total: res.pagination.total,
          pageSize,
        }));
      }
    } catch {
      message.error('Failed to fetch blog posts');
    } finally {
      setLoading(false);
    }
  }, [filters, sorter, pagination.pageSize]);

  const fetchMeta = async () => {
    try {
      const [catRes, statsRes] = await Promise.all([
        blogApi.getCategories(),
        blogApi.getStats(),
      ]);
      if (catRes.success) setCategories(catRes.categories);
      if (statsRes.success) setStats(statsRes.stats);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    fetchMeta();
  }, []);

  const handleDelete = async (id) => {
    try {
      await blogApi.deletePost(id);
      message.success('Post deleted');
      fetchPosts(pagination.current);
      fetchMeta();
    } catch {
      message.error('Failed to delete post');
    }
  };

  const handleBulkDelete = async () => {
    try {
      const res = await blogApi.bulkDeletePosts(selectedRowKeys);
      message.success(res.message || `${res.deletedCount} post(s) deleted`);
      setSelectedRowKeys([]);
      fetchPosts(1);
      fetchMeta();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete posts');
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await blogApi.updatePostStatus(id, status);
      message.success(`Post ${status}`);
      fetchPosts(pagination.current);
      fetchMeta();
    } catch {
      message.error('Failed to update status');
    }
  };

  const handleTableChange = (pag, _filters, sort) => {
    if (sort.field) {
      setSorter({ field: sort.field, order: sort.order });
    } else {
      setSorter({});
    }
    fetchPosts(pag.current, pag.pageSize);
  };

  const handleSearch = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ search: '', status: [], category: [], dateRange: null });
    setSorter({});
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const statusColors = {
    published: 'green',
    draft: 'orange',
    archived: 'red',
  };

  const columns = [
    {
      title: 'Image',
      dataIndex: 'featuredImage',
      key: 'featuredImage',
      width: 50,
      render: (img) => img ? (
        <Image src={img} width={60} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
      ) : (
        <div style={{ width: 60, height: 40, background: STATUS_COLORS.neutral.bg(isDark), borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: muted(isDark), fontSize: 12 }}>
          No img
        </div>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      width: 150,
      ellipsis: true,
      render: (text, record) => (
        <Space>
          {record.isFeatured && <StarFilled style={{ color: warning }} />}
          <span style={{ fontWeight: 500 }}>{text}</span>
        </Space>
      ),
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      width: 110,
      ellipsis: true,
      render: (text) => <code style={{ fontSize: 12 }}>/blog/{text}</code>,
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 112,
      render: (cat) => <Tag>{cat}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => <Tag color={statusColors[status]}>{status?.toUpperCase()}</Tag>,
    },
    {
      title: 'Views',
      dataIndex: 'views',
      key: 'views',
      width: 74,
      sorter: true,
      render: (v) => (
        <Space>
          <EyeOutlined />
          {v || 0}
        </Space>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 100,
      sorter: true,
      render: (d) => d ? new Date(d).toLocaleDateString() : '—',
    },
    {
      title: 'Published',
      dataIndex: 'publishedAt',
      key: 'publishedAt',
      width: 100,
      sorter: true,
      render: (d) => d ? new Date(d).toLocaleDateString() : '—',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 170,
      render: (_, record) => (
        <Space>
          {hasPermission(PERMISSIONS.SETTINGS_EDIT) && (
            <>
              <Tooltip title="Edit">
                <Button type="link" icon={<EditOutlined />} onClick={() => navigate(`/blog/posts/${record.id}/edit`)} />
              </Tooltip>
              {record.status === 'draft' && (
                <Tooltip title="Publish">
                  <Button type="link" style={{ color: success }} onClick={() => handleStatusChange(record.id, 'published')}>
                    Publish
                  </Button>
                </Tooltip>
              )}
              {record.status === 'published' && (
                <Tooltip title="Unpublish">
                  <Button type="link" style={{ color: warning }} onClick={() => handleStatusChange(record.id, 'draft')}>
                    Draft
                  </Button>
                </Tooltip>
              )}
              <Popconfirm title="Delete this post?" onConfirm={() => handleDelete(record.id)}>
                <Button type="link" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Blog Posts"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Blog' }, { label: 'Posts' }]}
        extra={
          hasPermission(PERMISSIONS.SETTINGS_EDIT) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/blog/posts/new')}>
              New Post
            </Button>
          )
        }
      />

      <StatRow>
        <StatCard count={4} tone="blue" icon={<FileTextOutlined />} label="Total Posts" value={stats.total || 0} />
        <StatCard count={4} tone="green" icon={<CheckCircleOutlined />} label="Published" value={stats.published || 0} />
        <StatCard count={4} tone="amber" icon={<ClockCircleOutlined />} label="Drafts" value={stats.draft || 0} />
        <StatCard count={4} tone="purple" icon={<EyeOutlined />} label="Total Views" value={stats.totalViews || 0} />
      </StatRow>

      <DataTable
        title="Posts"
        count={pagination.total}
        search={{ value: filters.search, onChange: (e) => handleSearch('search', e.target.value), placeholder: 'Search posts...' }}
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
            key: 'category', placeholder: 'Category', mode: 'multiple',
            options: categories.map((c) => ({ value: c, label: c })),
          },
        ]}
        filterValues={filters}
        onFilterChange={handleSearch}
        onClearFilters={handleClearFilters}
        onRefresh={() => { fetchPosts(1); fetchMeta(); }}
        refreshLoading={loading}
        toolbarExtra={
          <RangePicker
            showTime={{ format: 'hh:mm A', use12Hours: true }}
            format="YYYY-MM-DD hh:mm A"
            value={filters.dateRange}
            onChange={(dates) => handleSearch('dateRange', dates)}
            placeholder={['From Date/Time', 'To Date/Time']}
          />
        }
        selection={hasPermission(PERMISSIONS.SETTINGS_EDIT) ? {
          enabled: true,
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          actions: [{
            key: 'delete', label: 'Delete Selected', danger: true, icon: <DeleteOutlined />,
            confirm: { title: `Delete ${selectedRowKeys.length} post(s)?`, description: 'This action cannot be undone.' },
            onClick: handleBulkDelete,
          }],
        } : undefined}
        empty={{ title: 'No posts found', description: 'Try adjusting your search or filters.' }}
        dataSource={posts}
        columns={columns}
        rowKey="id"
        loading={loading}
        onChange={handleTableChange}
        scroll={{ x: 1000 }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} posts`,
          onChange: (page, pageSize) => fetchPosts(page, pageSize),
        }}
      />
    </div>
  );
};

export default BlogPostsListPage;
