import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Modal, Form, Input, Select, Switch, Tag,
  message, Typography, Row, Col, Badge,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SwapRightOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import PermissionGuard from '../../components/guards/PermissionGuard';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import { usePermission } from '../../hooks/usePermission';
import seoApi from '../../api/seoApi';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, subtle } from '../../theme/colors';

const { Text, Paragraph } = Typography;
const { Option } = Select;

const statusCodeColors = {
  301: 'blue',
  302: 'orange',
  307: 'purple',
  308: 'cyan',
};

const RedirectsPage = () => {
  const { hasPermission } = usePermission();
  const { isDark } = useTheme();
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const [redirects, setRedirects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRedirect, setEditingRedirect] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const canUpdate = hasPermission(PERMISSIONS.SETTINGS_EDIT);

  const fetchRedirects = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: pagination.pageSize,
      };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;

      const data = await seoApi.getRedirects(params);
      if (data.success) {
        setRedirects(data.redirects);
        setPagination(prev => ({
          ...prev,
          current: data.pagination?.page || page,
          total: data.pagination?.total || 0,
        }));
      }
    } catch (err) {
      message.error('Failed to load redirects');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, pagination.pageSize]);

  useEffect(() => {
    fetchRedirects();
  }, [fetchRedirects]);

  const handleSearch = (value) => {
    setSearch(value);
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const handleTableChange = (paginationConfig) => {
    fetchRedirects(paginationConfig.current);
  };

  const openCreateModal = () => {
    setEditingRedirect(null);
    form.resetFields();
    form.setFieldsValue({ statusCode: 301, isActive: true });
    setModalOpen(true);
  };

  const openEditModal = (record) => {
    setEditingRedirect(record);
    form.setFieldsValue({
      fromPath: record.fromPath,
      toPath: record.toPath,
      statusCode: record.statusCode,
      isActive: record.isActive,
      note: record.note,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      if (editingRedirect) {
        await seoApi.updateRedirect(editingRedirect.id, values);
        message.success('Redirect updated');
      } else {
        await seoApi.createRedirect(values);
        message.success('Redirect created');
      }

      setModalOpen(false);
      fetchRedirects(pagination.current);
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.message || 'Failed to save redirect');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await seoApi.deleteRedirect(id);
      message.success('Redirect deleted');
      fetchRedirects(pagination.current);
    } catch (err) {
      message.error('Failed to delete redirect');
    }
  };

  const handleToggle = async (record) => {
    try {
      await seoApi.toggleRedirect(record.id);
      message.success(`Redirect ${record.isActive ? 'disabled' : 'enabled'}`);
      fetchRedirects(pagination.current);
    } catch (err) {
      message.error('Failed to toggle redirect');
    }
  };

  const columns = [
    {
      title: 'From',
      dataIndex: 'fromPath',
      key: 'fromPath',
      render: (val) => (
        <Text code style={{ fontSize: 13 }}>{val}</Text>
      ),
    },
    {
      title: '',
      key: 'arrow',
      width: 64,
      render: () => <SwapRightOutlined style={{ color: subtle(isDark) }} />,
    },
    {
      title: 'To',
      dataIndex: 'toPath',
      key: 'toPath',
      render: (val) => (
        <Text code style={{ fontSize: 13 }}>{val}</Text>
      ),
    },
    {
      title: 'Status Code',
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 90,
      render: (code) => (
        <Tag color={statusCodeColors[code] || 'default'}>{code}</Tag>
      ),
    },
    {
      title: 'Active',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 65,
      render: (val, record) => (
        <Switch
          size="small"
          checked={val}
          onChange={() => handleToggle(record)}
          disabled={!canUpdate}
        />
      ),
    },
    {
      title: 'Hits',
      dataIndex: 'hitCount',
      key: 'hitCount',
      width: 64,
      render: (val) => <Badge count={val || 0} showZero overflowCount={99999} style={{ backgroundColor: success }} />,
    },
    {
      title: 'Last Hit',
      dataIndex: 'lastHitAt',
      key: 'lastHitAt',
      width: 115,
      render: (val) =>
        val ? new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
    },
    {
      title: 'Note',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      width: 125,
      render: (val) => val || '—',
    },
    rowActions([
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        permission: PERMISSIONS.SETTINGS_EDIT, onClick: openEditModal,
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        permission: PERMISSIONS.SETTINGS_EDIT,
        confirm: { title: 'Delete this redirect?' }, onClick: (r) => handleDelete(r.id),
      },
    ]),
  ];

  // Summary stats
  const totalRedirects = redirects.length;
  const activeRedirects = redirects.filter(r => r.isActive).length;
  const totalHits = redirects.reduce((sum, r) => sum + (r.hitCount || 0), 0);

  return (
    <div>
      <PageHeader
        title="URL Redirects"
        breadcrumbs={[
          { label: 'Home', path: '/' },
          { label: 'Website' },
          { label: 'Redirects' },
        ]}
        extra={
          <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              Add Redirect
            </Button>
          </PermissionGuard>
        }
      />

      <StatRow>
        <StatCard count={3} tone="blue" icon={<LinkOutlined />} label="Total Redirects" value={pagination.total} />
        <StatCard count={3} tone="green" label="Active" value={activeRedirects} />
        <StatCard count={3} tone="purple" label="Total Hits" value={totalHits} />
      </StatRow>

      <DataTable
        title="Redirects"
        count={pagination.total}
        search={{ value: search, onChange: (e) => handleSearch(e.target.value), placeholder: 'Search by path...' }}
        filters={[
          {
            key: 'status', placeholder: 'All Status',
            options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }],
          },
        ]}
        filterValues={{ status: statusFilter === 'all' ? undefined : statusFilter }}
        onFilterChange={(_, v) => setStatusFilter(v || 'all')}
        onClearFilters={() => { setSearch(''); setStatusFilter('all'); }}
        onRefresh={() => fetchRedirects(pagination.current)}
        refreshLoading={loading}
        empty={{ title: 'No redirects found' }}
        columns={columns}
        dataSource={redirects}
        rowKey="id"
        loading={loading}
        pagination={{
          ...pagination,
          showSizeChanger: false,
          showTotal: (total) => `${total} redirects`,
        }}
        onChange={handleTableChange}
        scroll={{ x: 740 }}
        size="middle"
      />

      {/* Create / Edit Modal */}
      <Modal
        title={editingRedirect ? 'Edit Redirect' : 'New Redirect'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText={editingRedirect ? 'Update' : 'Create'}
        width={540}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="fromPath"
            label="From Path"
            rules={[{ required: true, message: 'From path is required' }]}
            help="The old URL path to redirect from (e.g., /old-page)"
          >
            <Input placeholder="/old-page" addonBefore="/" />
          </Form.Item>

          <Form.Item
            name="toPath"
            label="To Path"
            rules={[{ required: true, message: 'To path is required' }]}
            help="The new URL path to redirect to (e.g., /new-page)"
          >
            <Input placeholder="/new-page" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="statusCode"
                label="Status Code"
                rules={[{ required: true }]}
              >
                <Select>
                  <Option value={301}>301 — Permanent</Option>
                  <Option value={302}>302 — Temporary</Option>
                  <Option value={307}>307 — Temp (Strict)</Option>
                  <Option value={308}>308 — Perm (Strict)</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="isActive" label="Active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="note" label="Note (optional)">
            <Input placeholder="Reason for redirect..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default RedirectsPage;
