import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, Checkbox, Row, Col, message, Button, Typography, Badge } from 'antd';
import {
  UserOutlined, TeamOutlined, AppstoreOutlined,
  SafetyOutlined, LineChartOutlined, FileTextOutlined,
  SettingOutlined, BellOutlined, CloudServerOutlined, CheckOutlined, CloseOutlined,
} from '@ant-design/icons';
import rolesApi from '../../api/rolesApi';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS, GRADIENT, getBrand, brandSoft, muted, hairline } from '../../theme/colors';
import { PERMISSION_GROUPS, getPermissionLabel } from '../../utils/permissions';

const { Text } = Typography;

// Cycled across the six pastel tiles rather than one hex per group — 11 groups
// share 6 tones, but no two cards adjacent in the two-column grid land on the
// same one.
const GROUP_META = {
  'User Management': { icon: <UserOutlined />, tone: 'blue' },
  'Customer Management': { icon: <TeamOutlined />, tone: 'cyan' },
  'Role Management': { icon: <SafetyOutlined />, tone: 'purple' },
  Analytics: { icon: <LineChartOutlined />, tone: 'blue' },
  'Activity Logs': { icon: <FileTextOutlined />, tone: 'cyan' },
  Settings: { icon: <SettingOutlined />, tone: 'green' },
  Notifications: { icon: <BellOutlined />, tone: 'amber' },
  System: { icon: <CloudServerOutlined />, tone: 'pink' },
};

const RoleFormModal = ({ open, onClose, editingRole, availablePermissions }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { isDark } = useTheme();
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];

  const isEditing = !!editingRole;

  useEffect(() => {
    if (open) {
      if (editingRole) {
        form.setFieldsValue({
          name: editingRole.name,
          description: editingRole.description,
          permissions: editingRole.permissions || [],
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, editingRole, form]);

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      if (isEditing) {
        await rolesApi.updateRole(editingRole.id, values);
        message.success('Role updated');
      } else {
        await rolesApi.createRole(values);
        message.success('Role created');
      }
      onClose(true);
    } catch (err) {
      message.error(err.response?.data?.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  // Group check/uncheck all
  const handleGroupCheckAll = (groupPerms, checked) => {
    const current = form.getFieldValue('permissions') || [];
    if (checked) {
      const merged = [...new Set([...current, ...groupPerms])];
      form.setFieldsValue({ permissions: merged });
    } else {
      form.setFieldsValue({ permissions: current.filter((p) => !groupPerms.includes(p)) });
    }
  };

  // Track how many are selected per group
  const PermissionGroupCard = ({ groupName, groupPerms }) => {
    const meta = GROUP_META[groupName] || { icon: <AppstoreOutlined />, tone: 'blue' };
    const fg = TILE[meta.tone].fg(isDark);
    const currentPerms = Form.useWatch('permissions', form) || [];
    const selectedCount = useMemo(
      () => groupPerms.filter((p) => currentPerms.includes(p)).length,
      [groupPerms, currentPerms]
    );
    const allSelected = selectedCount === groupPerms.length;
    const noneSelected = selectedCount === 0;

    return (
      <div
        style={{
          border: `1px solid ${noneSelected ? hairline(isDark) : `${fg}40`}`,
          borderRadius: 10,
          padding: '14px 16px',
          background: noneSelected ? STATUS_COLORS.neutral.bg(isDark) : `${fg}06`,
          transition: 'all 0.2s ease',
          height: '100%',
        }}
      >
        {/* Group Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 8,
              background: `${fg}15`, color: fg, fontSize: 14,
            }}>
              {meta.icon}
            </span>
            <Text strong style={{ fontSize: 13 }}>{groupName}</Text>
            <Badge
              count={`${selectedCount}/${groupPerms.length}`}
              style={{
                backgroundColor: allSelected ? success : noneSelected ? muted(isDark) : fg,
                fontSize: 11,
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <Button
              type={allSelected ? 'primary' : 'default'}
              size="small"
              icon={<CheckOutlined />}
              onClick={() => handleGroupCheckAll(groupPerms, true)}
              style={{
                fontSize: 11, height: 24, padding: '0 8px', borderRadius: 6,
                ...(allSelected ? { background: fg, borderColor: fg } : {}),
              }}
            >
              All
            </Button>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => handleGroupCheckAll(groupPerms, false)}
              disabled={noneSelected}
              style={{ fontSize: 11, height: 24, padding: '0 8px', borderRadius: 6 }}
            >
              Clear
            </Button>
          </div>
        </div>

        {/* Checkboxes */}
        <Row gutter={[4, 6]}>
          {groupPerms.map((perm) => (
            <Col xs={12} key={perm}>
              <Checkbox value={perm} style={{ fontSize: 13 }}>{getPermissionLabel(perm)}</Checkbox>
            </Col>
          ))}
        </Row>
      </div>
    );
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 8,
            background: GRADIENT,
            color: '#fff', fontSize: 16,
          }}>
            <SafetyOutlined />
          </span>
          <span>{isEditing ? 'Edit Role' : 'Create Custom Role'}</span>
        </div>
      }
      open={open}
      onCancel={() => onClose(false)}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={780}
      destroyOnClose
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 } }}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 8 }}>
        <Row gutter={16}>
          <Col xs={24} sm={14}>
            <Form.Item
              name="name"
              label="Role Name"
              rules={[{ required: true, message: 'Role name is required' }]}
            >
              <Input placeholder="e.g. support_agent" disabled={isEditing} size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="description" label="Description">
              <Input placeholder="Brief description" size="large" />
            </Form.Item>
          </Col>
        </Row>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 16px',
          padding: '10px 14px', borderRadius: 8,
          background: brandSoft(isDark),
          border: `1px solid ${hairline(isDark)}`,
        }}>
          <SafetyOutlined style={{ color: getBrand(isDark), fontSize: 16 }} />
          <Text strong style={{ fontSize: 14 }}>Permissions</Text>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
            Select the permissions this role should have
          </Text>
        </div>

        <Form.Item
          name="permissions"
          rules={[{ required: true, message: 'Select at least one permission' }]}
          style={{ marginBottom: 0 }}
        >
          <Checkbox.Group style={{ width: '100%' }}>
            <Row gutter={[12, 12]}>
              {Object.entries(PERMISSION_GROUPS).map(([groupName, groupPerms]) => (
                <Col xs={24} sm={12} key={groupName}>
                  <PermissionGroupCard groupName={groupName} groupPerms={groupPerms} />
                </Col>
              ))}
            </Row>
          </Checkbox.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RoleFormModal;
