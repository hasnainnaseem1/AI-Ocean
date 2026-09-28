import React, { useState, useEffect, useCallback } from 'react';
import {
  Input, Select, Button, Space, Modal, Form, message, Avatar,
} from 'antd';
import {
  PlusOutlined, StopOutlined, CheckCircleOutlined, DeleteOutlined, EyeOutlined, EditOutlined,
  TeamOutlined, SafetyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import StatusTag from '../../components/common/StatusTag';
import RoleTag from '../../components/common/RoleTag';
import PermissionGuard from '../../components/guards/PermissionGuard';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import { usePermission } from '../../hooks/usePermission';
import usersApi from '../../api/usersApi';
import departmentsApi from '../../api/departmentsApi';
import rolesApi from '../../api/rolesApi';
import { PERMISSIONS } from '../../utils/permissions';
import { DEFAULT_PAGE_SIZE } from '../../utils/constants';
import { formatDateTime } from '../../utils/helpers';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE } from '../../theme/colors';

const UsersListPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { isDark } = useTheme();
  const blue = TILE.blue.fg(isDark);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0 });
  const [stats, setStats] = useState({});
  const [filters, setFilters] = useState({ search: '', role: [], status: [] });
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [exportLoading, setExportLoading] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm] = Form.useForm();
  const [customRoles, setCustomRoles] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: pagination.current,
        limit: pagination.pageSize,
        search: filters.search,
        accountType: 'admin', // Only show admin-type users in admin-center
      };
      if (filters.role.length > 0) params.role = filters.role.join(',');
      if (filters.status.length > 0) params.status = filters.status.join(',');

      const data = await usersApi.getUsers(params);
      setUsers(data.users || []);
      setPagination((prev) => ({ ...prev, total: data.pagination?.totalItems || 0 }));
      setStats(data.stats || {});
    } catch {
      message.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [pagination.current, pagination.pageSize, filters]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Fetch departments for filter dropdown
  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const data = await departmentsApi.getActiveDepartments();
        setDepartments(data.departments || []);
      } catch (err) {
        console.error('Failed to load departments:', err);
      }
    };
    loadDepartments();
  }, []);

  // Fetch custom roles for role dropdown
  useEffect(() => {
    const loadCustomRoles = async () => {
      try {
        const data = await rolesApi.getRoles();
        setCustomRoles(data.customRoles || []);
      } catch (err) {
        console.error('Failed to load custom roles:', err);
      }
    };
    loadCustomRoles();
  }, []);

  const handleTableChange = (pag) => {
    setPagination((prev) => ({ ...prev, current: pag.current, pageSize: pag.pageSize }));
  };

  // Build role options including built-in and custom roles
  const getRoleOptions = () => {
    const builtInRoles = [
      { value: 'admin', label: 'Admin' },
      { value: 'moderator', label: 'Moderator' },
      { value: 'viewer', label: 'Viewer' },
    ];

    const customRoleOptions = customRoles.map(role => ({
      value: role.id,
      label: role.name,
    }));

    return [...builtInRoles, ...customRoleOptions];
  };

  const handleSearch = (e) => {
    const value = e.target.value;
    setFilters((prev) => ({ ...prev, search: value }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value || [] }));
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ search: '', role: [], status: [] });
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleSuspend = async (id) => {
    try {
      await usersApi.suspendUser(id);
      message.success('User suspended');
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to suspend user');
    }
  };

  const handleActivate = async (id) => {
    try {
      await usersApi.activateUser(id);
      message.success('User activated');
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to activate user');
    }
  };

  const handleDelete = async (id) => {
    try {
      await usersApi.deleteUser(id);
      message.success('User deleted');
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete user');
    }
  };

  const handleBulkDelete = async (keys) => {
    try {
      const res = await usersApi.bulkDeleteUsers(keys);
      message.success(res.message || `${res.deletedCount} user(s) deleted`);
      setSelectedRowKeys([]);
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete users');
    }
  };

  const handleEditOpen = (user) => {
    setEditingUser(user);
    let roleValue = user.role;

    // If user has a custom role, use the custom role ID
    if (user.role === 'custom' && user.customRole) {
      roleValue = user.customRole.id || user.customRole;
    }

    editForm.setFieldsValue({
      name: user.name,
      role: roleValue,
      department: user.department,
      status: user.status,
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (values) => {
    setEditLoading(true);
    try {
      // Check if selected role is a custom role ID or built-in role
      const builtInRoles = ['admin', 'moderator', 'viewer', 'super_admin', 'custom'];
      const isCustomRole = !builtInRoles.includes(values.role);

      const userData = { ...values };
      if (isCustomRole) {
        // If it's a custom role ID, set role to 'custom' and include customRoleId
        userData.customRoleId = values.role;
        userData.role = 'custom';
      }

      await usersApi.updateUser(editingUser.id, userData);
      message.success('User updated successfully');
      setEditModalOpen(false);
      editForm.resetFields();
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to update user');
    } finally {
      setEditLoading(false);
    }
  };

  const handleCreate = async (values) => {
    setCreateLoading(true);
    try {
      // Check if selected role is a custom role ID or built-in role
      const builtInRoles = ['admin', 'moderator', 'viewer', 'super_admin', 'custom'];
      const isCustomRole = !builtInRoles.includes(values.role);

      const userData = { ...values };
      if (isCustomRole) {
        // If it's a custom role ID, set role to 'custom' and include customRoleId
        userData.customRoleId = values.role;
        userData.role = 'custom';
      }

      await usersApi.createUser(userData);
      message.success('Admin user created successfully');
      setCreateModalOpen(false);
      createForm.resetFields();
      fetchUsers();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to create user');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const params = {
        search: filters.search,
        accountType: 'admin', // Only export admin-type users
      };
      if (filters.role.length > 0) params.role = filters.role.join(',');
      if (filters.status.length > 0) params.status = filters.status.join(',');

      await usersApi.exportUsers(params);
      message.success('Users exported successfully');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to export users');
    } finally {
      setExportLoading(false);
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name, record) => {
        const getInitials = (name) => {
          return name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
        };

        return (
          <Space>
            <Avatar
              size={32}
              src={record.avatar}
              style={{ backgroundColor: blue, fontSize: 14 }}
            >
              {!record.avatar && getInitials(name)}
            </Avatar>
            <Button
              type="link"
              onClick={() => navigate(`/users/${record.id}`)}
              style={{ padding: 0 }}
            >
              {name}
            </Button>
          </Space>
        );
      },
    },
    { title: 'Email', dataIndex: 'email', key: 'email', ellipsis: true },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 105,
      render: (role) => <RoleTag role={role} />,
    },
    {
      title: 'Type',
      dataIndex: 'accountType',
      key: 'accountType',
      width: 80,
      render: (t) => t === 'admin' ? 'Admin' : 'Customer',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 115,
      render: (status) => <StatusTag status={status} />,
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLogin',
      key: 'lastLogin',
      width: 130,
      render: (date) => formatDateTime(date),
    },
    rowActions([
      {
        key: 'view', icon: <EyeOutlined />, label: 'View',
        onClick: (r) => navigate(`/users/${r.id}`),
      },
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        permission: PERMISSIONS.USERS_EDIT, onClick: handleEditOpen,
      },
      {
        key: 'suspend', icon: <StopOutlined />, label: 'Suspend', danger: true,
        permission: PERMISSIONS.USERS_SUSPEND, visible: (r) => r.status === 'active',
        confirm: 'Suspend this user?', onClick: (r) => handleSuspend(r.id),
      },
      {
        key: 'activate', icon: <CheckCircleOutlined />, label: 'Activate',
        permission: PERMISSIONS.USERS_ACTIVATE, visible: (r) => r.status === 'suspended',
        confirm: 'Activate this user?', onClick: (r) => handleActivate(r.id),
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        permission: PERMISSIONS.USERS_DELETE,
        confirm: 'Delete this user? This cannot be undone.', onClick: (r) => handleDelete(r.id),
      },
    ], { maxVisible: 4 }),
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Admin accounts with dashboard access"
        count={pagination.total}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Users' }]}
        extra={
          <PermissionGuard permission={PERMISSIONS.USERS_CREATE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
              Create Admin
            </Button>
          </PermissionGuard>
        }
      />

      <StatRow>
        <StatCard count={4} tone="blue" icon={<TeamOutlined />} label="Total Users" value={stats.totalUsers || 0} />
        <StatCard count={4} tone="purple" icon={<SafetyOutlined />} label="Admins" value={stats.totalAdmins || 0} />
        <StatCard count={4} tone="green" icon={<CheckCircleOutlined />} label="Active" value={stats.activeUsers || 0} />
        <StatCard count={4} tone="amber" icon={<StopOutlined />} label="Suspended" value={stats.suspendedUsers || 0} />
      </StatRow>

      <DataTable
        title="Users"
        count={pagination.total}
        search={{ value: filters.search, onChange: handleSearch, placeholder: 'Search by name or email' }}
        filters={[
          {
            key: 'role', placeholder: 'Role', mode: 'multiple',
            options: [
              { value: 'super_admin', label: 'Super Admin' },
              { value: 'admin', label: 'Admin' },
              { value: 'moderator', label: 'Moderator' },
              { value: 'viewer', label: 'Viewer' },
              { value: 'custom', label: 'Custom' },
            ],
          },
          {
            key: 'status', placeholder: 'Status', mode: 'multiple',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'banned', label: 'Banned' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'pending_verification', label: 'Pending' },
            ],
          },
        ]}
        filterValues={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        onRefresh={fetchUsers}
        refreshLoading={loading}
        onExport={handleExport}
        exportLoading={exportLoading}
        selection={hasPermission(PERMISSIONS.USERS_DELETE) ? {
          enabled: true,
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          actions: [{
            key: 'delete', label: 'Delete Selected', danger: true, icon: <DeleteOutlined />,
            confirm: { title: `Delete ${selectedRowKeys.length} user(s)?`, description: 'This action cannot be undone.' },
            onClick: handleBulkDelete,
          }],
        } : undefined}
        empty={{ title: 'No users found', description: 'Try adjusting your search or filters.' }}
        columns={columns}
        dataSource={users}
        loading={loading}
        rowKey={(r) => r.id}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: (total) => `Total ${total} users`,
        }}
        onChange={handleTableChange}
        scroll={{ x: 740 }}
        size="middle"
      />

      {/* Create Admin Modal */}
      <Modal
        title="Create Admin User"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        confirmLoading={createLoading}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Full Name" rules={[{ required: true, message: 'Please enter name' }]}>
            <Input placeholder="John Doe" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Please enter a valid email' }]}>
            <Input placeholder="admin@example.com" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 8, message: 'Min 8 characters' }]}>
            <Input.Password placeholder="Minimum 8 characters" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true, message: 'Please select a role' }]}>
            <Select placeholder="Select role" options={getRoleOptions()} />
          </Form.Item>
          <Form.Item name="department" label="Department">
            <Select
              placeholder="Select department"
              allowClear
              showSearch
              options={departments}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        title="Edit User"
        open={editModalOpen}
        onCancel={() => {
          setEditModalOpen(false);
          editForm.resetFields();
        }}
        onOk={() => editForm.submit()}
        confirmLoading={editLoading}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Please enter name' }]}>
            <Input placeholder="John Doe" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true, message: 'Please select a role' }]}>
            <Select placeholder="Select role" options={getRoleOptions()} />
          </Form.Item>
          <Form.Item name="department" label="Department">
            <Select
              placeholder="Select department"
              allowClear
              showSearch
              options={departments}
            />
          </Form.Item>
          <Form.Item name="status" label="Status">
            <Select placeholder="Select status" options={[
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'inactive', label: 'Inactive' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UsersListPage;
