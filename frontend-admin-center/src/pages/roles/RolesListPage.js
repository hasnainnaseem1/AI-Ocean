import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Tag, message, Row, Col, Badge,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SafetyOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import PermissionGuard from '../../components/guards/PermissionGuard';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { usePermission } from '../../hooks/usePermission';
import RoleFormModal from './RoleFormModal';
import rolesApi from '../../api/rolesApi';
import { PERMISSIONS } from '../../utils/permissions';
import { formatDateTime } from '../../utils/helpers';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, muted } from '../../theme/colors';

const ROLE_DESCRIPTIONS = {
  super_admin: 'Full system access — all permissions',
  admin: 'All except role management',
  moderator: 'User & customer management, view analytics',
  viewer: 'Read-only access to users, customers, and analytics',
};

const ROLE_COLORS = {
  super_admin: 'red',
  admin: 'volcano',
  moderator: 'blue',
  viewer: 'green',
};

const RolesListPage = () => {
  const { hasPermission } = usePermission();
  const { isDark } = useTheme();
  const purple = TILE.purple.fg(isDark);
  const [loading, setLoading] = useState(false);
  const [builtInRoles, setBuiltInRoles] = useState([]);
  const [customRoles, setCustomRoles] = useState([]);
  const [availablePermissions, setAvailablePermissions] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await rolesApi.getRoles();
      setBuiltInRoles(data.builtInRoles || []);
      setCustomRoles(data.customRoles || []);
      setAvailablePermissions(data.availablePermissions || []);
    } catch {
      message.error('Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const handleDelete = async (id) => {
    try {
      await rolesApi.deleteRole(id);
      message.success('Role deleted');
      fetchRoles();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete role');
    }
  };

  const handleBulkDelete = async (keys) => {
    try {
      const res = await rolesApi.bulkDeleteRoles(keys);
      message.success(res.message || `${res.deletedCount} role(s) deleted`);
      setSelectedRowKeys([]);
      fetchRoles();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete roles');
    }
  };

  const handleModalClose = (refreshNeeded) => {
    setModalOpen(false);
    setEditingRole(null);
    if (refreshNeeded) fetchRoles();
  };

  const customColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name) => <strong>{name}</strong>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: 'Permissions',
      dataIndex: 'permissions',
      key: 'permissions',
      width: 100,
      render: (perms) => <Badge count={perms?.length || 0} style={{ backgroundColor: purple }} />,
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 85,
      render: (active) => active ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
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
        permission: PERMISSIONS.ROLES_EDIT,
        onClick: (r) => { setEditingRole(r); setModalOpen(true); },
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        permission: PERMISSIONS.ROLES_DELETE,
        confirm: { title: 'Delete this role?', description: 'Users assigned to it will lose access.' },
        onClick: (r) => handleDelete(r.id),
      },
    ]),
  ];

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Roles & Permissions' }]}
        extra={
          <PermissionGuard permission={PERMISSIONS.ROLES_CREATE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingRole(null); setModalOpen(true); }}>
              Create Role
            </Button>
          </PermissionGuard>
        }
      />

      {/* Built-in Roles */}
      <Card title="Built-in Roles" style={{ marginBottom: 16 }} loading={loading}>
        <Row gutter={[16, 16]}>
          {builtInRoles.map((role) => (
            <Col xs={24} sm={12} lg={6} key={role.name}>
              <Card
                size="small"
                hoverable
                styles={{ body: { textAlign: 'center', padding: '20px 16px' } }}
              >
                <SafetyOutlined style={{ fontSize: 28, color: ROLE_COLORS[role.name] ? undefined : muted(isDark), marginBottom: 8 }} />
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
                  <Tag color={ROLE_COLORS[role.name]}>{role.name.replace('_', ' ').toUpperCase()}</Tag>
                </div>
                <div style={{ color: muted(isDark), fontSize: 12 }}>
                  {ROLE_DESCRIPTIONS[role.name] || role.description}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Badge
                    count={role.permissions?.includes('*') ? 'ALL' : role.permissions?.length || 0}
                    style={{ backgroundColor: ROLE_COLORS[role.name] ? undefined : purple }}
                  />
                  <span style={{ fontSize: 12, color: muted(isDark), marginLeft: 4 }}>permissions</span>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {/* Custom Roles */}
      <DataTable
        title="Custom Roles"
        count={customRoles.length}
        selection={hasPermission(PERMISSIONS.ROLES_DELETE) ? {
          enabled: true,
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          actions: [{
            key: 'delete', label: 'Delete Selected', danger: true, icon: <DeleteOutlined />,
            confirm: { title: `Delete ${selectedRowKeys.length} role(s)?`, description: 'Users assigned to these roles will lose access.' },
            onClick: handleBulkDelete,
          }],
        } : undefined}
        empty={{ title: 'No custom roles created yet' }}
        columns={customColumns}
        dataSource={customRoles}
        loading={loading}
        rowKey={(r) => r.id}
        pagination={false}
        size="middle"
      />

      {/* Create/Edit Modal */}
      <RoleFormModal
        open={modalOpen}
        onClose={handleModalClose}
        editingRole={editingRole}
        availablePermissions={availablePermissions}
      />
    </div>
  );
};

export default RolesListPage;
