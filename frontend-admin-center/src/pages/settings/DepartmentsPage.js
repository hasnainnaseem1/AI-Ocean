import React, { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Space,
  Tag,
  message,
  Modal,
  Form,
  Input,
  Switch,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  TeamOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import PermissionGuard from '../../components/guards/PermissionGuard';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import departmentsApi from '../../api/departmentsApi';
import { PERMISSIONS } from '../../utils/permissions';
import { formatDateTime } from '../../utils/helpers';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, muted, subtle, hairline } from '../../theme/colors';

const DepartmentsPage = () => {
  const { isDark } = useTheme();
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState(null);
  const [form] = Form.useForm();

  const fetchDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await departmentsApi.getDepartments();
      setDepartments(data.departments || []);
    } catch (err) {
      message.error('Failed to load departments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleSeedDefaults = async () => {
    try {
      const data = await departmentsApi.seedDefaultDepartments();
      message.success(data.message || 'Default departments seeded successfully');
      fetchDepartments();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to seed default departments');
    }
  };

  const handleCreate = () => {
    setEditingDepartment(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true });
    setModalOpen(true);
  };

  const handleEdit = (department) => {
    setEditingDepartment(department);
    form.setFieldsValue({
      name: department.name,
      description: department.description,
      isActive: department.isActive,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id) => {
    try {
      await departmentsApi.deleteDepartment(id);
      message.success('Department deleted successfully');
      fetchDepartments();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete department');
    }
  };

  const handleSubmit = async (values) => {
    try {
      if (editingDepartment) {
        await departmentsApi.updateDepartment(editingDepartment.id, values);
        message.success('Department updated successfully');
      } else {
        await departmentsApi.createDepartment(values);
        message.success('Department created successfully');
      }
      setModalOpen(false);
      form.resetFields();
      fetchDepartments();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save department');
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Space>
          <strong>{name}</strong>
          {record.isDefault && <Tag color="blue">Default</Tag>}
        </Space>
      ),
    },
    {
      title: 'Value',
      dataIndex: 'value',
      key: 'value',
      render: (value) => <code style={{ fontSize: 12, color: muted(isDark) }}>{value}</code>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (desc) => desc || <span style={{ color: subtle(isDark) }}>—</span>,
    },
    {
      title: 'Users',
      dataIndex: 'userCount',
      key: 'userCount',
      width: 80,
      render: (count) => (
        <Badge count={count || 0} style={{ backgroundColor: count > 0 ? success : muted(isDark) }} />
      ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (active) =>
        active ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (date) => formatDateTime(date),
    },
    rowActions([
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        permission: PERMISSIONS.SETTINGS_EDIT, onClick: handleEdit,
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        permission: PERMISSIONS.SETTINGS_EDIT, visible: (r) => !r.isDefault,
        confirm: { title: 'Delete this department?', description: 'Users assigned to it will need reassignment.' },
        onClick: (r) => handleDelete(r.id),
      },
    ]),
  ];

  const activeDepartments = departments.filter((d) => d.isActive).length;
  const totalUsers = departments.reduce((sum, d) => sum + (d.userCount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Departments"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Settings' }, { label: 'Departments' }]}
        extra={
          <Space>
            <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
              <Button onClick={handleSeedDefaults} icon={<DatabaseOutlined />}>
                Seed Defaults
              </Button>
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.SETTINGS_EDIT}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                Create Department
              </Button>
            </PermissionGuard>
          </Space>
        }
      />

      <StatRow>
        <StatCard count={3} tone="blue" icon={<TeamOutlined />} label="Total Departments" value={departments.length} />
        <StatCard count={3} tone="green" icon={<TeamOutlined />} label="Active Departments" value={activeDepartments} />
        <StatCard count={3} tone="purple" icon={<TeamOutlined />} label="Total Users" value={totalUsers} />
      </StatRow>

      <DataTable
        title="Departments"
        count={departments.length}
        onRefresh={fetchDepartments}
        refreshLoading={loading}
        empty={{ title: 'No departments yet' }}
        dataSource={departments}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `Total ${total} departments` }}
        size="middle"
      />

      {/* Create/Edit Modal */}
      <Modal
        title={editingDepartment ? 'Edit Department' : 'Create Department'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText={editingDepartment ? 'Update' : 'Create'}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Department Name"
            rules={[{ required: true, message: 'Please enter department name' }]}
          >
            <Input placeholder="e.g., Engineering, Sales, Marketing" />
          </Form.Item>

          <Form.Item name="description" label="Description">
            <Input.TextArea
              rows={3}
              placeholder="Brief description of this department's responsibilities"
            />
          </Form.Item>

          <Form.Item name="isActive" label="Status" valuePropName="checked">
            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
          </Form.Item>

          {editingDepartment && editingDepartment.isDefault && (
            <div style={{ padding: '8px 12px', background: STATUS_COLORS.info.bg(isDark), border: `1px solid ${hairline(isDark)}`, borderRadius: 4 }}>
              <small>
                <strong>Note:</strong> This is a default department. It can be edited but not deleted.
              </small>
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default DepartmentsPage;
