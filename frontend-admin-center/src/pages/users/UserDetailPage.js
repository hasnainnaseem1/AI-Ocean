import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Space, Spin, message, Tag, Timeline, Popconfirm, Modal, Upload, Tabs,
  Drawer, Form, Input, Select, Row, Col, Result, Avatar, Typography, Divider, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, StopOutlined, CheckCircleOutlined, DeleteOutlined,
  UserOutlined, MailOutlined, IdcardOutlined, SafetyOutlined, CalendarOutlined,
  EnvironmentOutlined, CheckCircleOutlined as VerifiedIcon, ClockCircleOutlined,
  CrownOutlined, TeamOutlined, DownloadOutlined, GlobalOutlined, CameraOutlined,
  UploadOutlined, LinkOutlined, KeyOutlined, CopyOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import StatusTag from '../../components/common/StatusTag';
import RoleTag from '../../components/common/RoleTag';
import PermissionGuard from '../../components/guards/PermissionGuard';
import DateTimeRangePicker from '../../components/common/DateTimeRangePicker';
import usersApi from '../../api/usersApi';
import departmentsApi from '../../api/departmentsApi';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted, subtle } from '../../theme/colors';
import { PERMISSIONS } from '../../utils/permissions';
import { formatDateTime, timeAgo, formatIPAddress } from '../../utils/helpers';

const { Title, Text } = Typography;

const UserDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const blue = TILE.blue.fg(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const warning = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [allActivity, setAllActivity] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityDateRange, setActivityDateRange] = useState(null);
  const [loginHistory, setLoginHistory] = useState([]);
  const [loginHistoryLoading, setLoginHistoryLoading] = useState(false);
  const [exportingActivity, setExportingActivity] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm] = Form.useForm();
  const [error, setError] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [uploadMethod, setUploadMethod] = useState('url');
  const [fileList, setFileList] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [resetPasswordModalOpen, setResetPasswordModalOpen] = useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    try {
      const data = await usersApi.getUser(id);
      setUser(data.user);
      setAllActivity(data.recentActivity || []);
      setActivity(data.recentActivity || []);
      setError(false);
    } catch {
      setError(true);
      message.error('Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchLoginHistory = useCallback(async () => {
    setLoginHistoryLoading(true);
    try {
      const data = await usersApi.getLoginHistory(id, 10);
      if (data.success) {
        setLoginHistory(data.loginHistory || []);
      }
    } catch (err) {
      console.error('Failed to fetch login history:', err);
    } finally {
      setLoginHistoryLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchUser();
    fetchLoginHistory();
  }, [fetchUser, fetchLoginHistory]);

  // Fetch departments for dropdown
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

  // Filter activity based on date range
  useEffect(() => {
    if (!activityDateRange || activityDateRange.length !== 2) {
      setActivity(allActivity);
      return;
    }

    const [start, end] = activityDateRange;
    const filtered = allActivity.filter((log) => {
      const logDate = new Date(log.createdAt);
      return logDate >= start.toDate() && logDate <= end.toDate();
    });
    setActivity(filtered);
  }, [activityDateRange, allActivity]);

  const handleEdit = async (values) => {
    setEditLoading(true);
    try {
      await usersApi.updateUser(id, values);
      message.success('User updated');
      setEditOpen(false);
      fetchUser();
    } catch (err) {
      message.error(err.response?.data?.message || 'Update failed');
    } finally {
      setEditLoading(false);
    }
  };

  const handleSuspend = async () => {
    try {
      await usersApi.suspendUser(id);
      message.success('User suspended');
      fetchUser();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed');
    }
  };

  const handleActivate = async () => {
    try {
      await usersApi.activateUser(id);
      message.success('User activated');
      fetchUser();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed');
    }
  };

  const handleDelete = async () => {
    try {
      await usersApi.deleteUser(id);
      message.success('User deleted');
      navigate('/users');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed');
    }
  };

  const handleResetPassword = async () => {
    setResetPasswordLoading(true);
    try {
      // Generate a temporary password
      const tempPassword = Math.random().toString(36).slice(-12) + 'T1!';
      const data = await usersApi.resetUserPassword(id, tempPassword);
      message.success(data.message || 'Password reset successfully');

      // Show the new password
      Modal.success({
        title: 'Password Reset Successful',
        width: 410,
        content: (
          <div>
            <p style={{ marginBottom: 16 }}>Password has been reset for <strong>{user.name}</strong></p>
            <div style={{ background: STATUS_COLORS.neutral.bg(isDark), padding: 12, borderRadius: 6, marginBottom: 16 }}>
              <p style={{ marginBottom: 8 }}>
                <strong>New Temporary Password:</strong>
              </p>
              <Space>
                <Input
                  value={tempPassword}
                  readOnly
                  style={{ fontFamily: 'monospace', flex: 1 }}
                />
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(tempPassword);
                    message.success('Password copied to clipboard');
                  }}
                >
                  Copy
                </Button>
              </Space>
            </div>
            <div style={{ background: STATUS_COLORS.info.bg(isDark), padding: 12, borderRadius: 6 }}>
              <p style={{ marginBottom: 0, fontSize: 12 }}>
                <strong>Next Steps:</strong>
                <ol style={{ marginTop: 8, marginBottom: 0 }}>
                  <li>Share this temporary password with <strong>{user.name}</strong></li>
                  <li>They will log in with this password</li>
                  <li>On first login, they will be <strong>required</strong> to change to a new secure password</li>
                  <li>After that, only the Super Admin can reset their password again</li>
                </ol>
              </p>
            </div>
          </div>
        ),
        onOk() {
          setResetPasswordModalOpen(false);
          fetchUser();
        }
      });
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const confirmResetPassword = () => {
    Modal.confirm({
      title: 'Reset Password',
      content: `Reset password for ${user.name}? They will receive a new temporary password and must change it on next login.`,
      okText: 'Yes, Reset Password',
      cancelText: 'Cancel',
      onOk: handleResetPassword,
    });
  };

  const handleExportActivity = async () => {
    setExportingActivity(true);
    try {
      const params = { userId: id };
      if (activityDateRange && activityDateRange.length === 2) {
        params.startDate = activityDateRange[0].toISOString();
        params.endDate = activityDateRange[1].toISOString();
      }
      await usersApi.exportUserActivity(params);
      message.success('Activity logs exported successfully');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to export activity');
    } finally {
      setExportingActivity(false);
    }
  };

  const handleAvatarUpdate = async () => {
    let avatarValue = null;

    if (uploadMethod === 'url') {
      if (!avatarUrl.trim() && !user.avatar) {
        message.warning('Please enter an avatar URL');
        return;
      }
      avatarValue = avatarUrl.trim() || null;
    } else if (uploadMethod === 'upload') {
      if (fileList.length === 0 && !user.avatar) {
        message.warning('Please select an image to upload');
        return;
      }
      if (fileList.length > 0) {
        avatarValue = fileList[0].base64;
      }
    }

    setAvatarLoading(true);
    try {
      await usersApi.updateUser(id, { avatar: avatarValue });
      message.success('Avatar updated successfully');
      setAvatarModalOpen(false);
      setAvatarUrl('');
      setFileList([]);
      fetchUser();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to update avatar');
    } finally {
      setAvatarLoading(false);
    }
  };

  const openAvatarModal = () => {
    setAvatarUrl(user.avatar || '');
    setFileList([]);
    setUploadMethod('url');
    setAvatarModalOpen(true);
  };

  const getBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleUploadChange = async ({ fileList: newFileList }) => {
    const limitedFileList = newFileList.slice(-1); // Keep only the last file

    if (limitedFileList.length > 0 && limitedFileList[0].originFileObj) {
      const base64 = await getBase64(limitedFileList[0].originFileObj);
      limitedFileList[0].base64 = base64;
    }

    setFileList(limitedFileList);
  };

  const beforeUpload = (file) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('You can only upload image files!');
      return false;
    }
    const isLt5M = file.size / 1024 / 1024 < 5;
    if (!isLt5M) {
      message.error('Image must be smaller than 5MB!');
      return false;
    }
    return false; // Prevent automatic upload
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (error || !user) return <Result status="error" title="User not found" extra={<Button onClick={() => navigate('/users')}>Back to Users</Button>} />;

  const getInitials = (name) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div>
      <PageHeader
        title="User Details"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Users', path: '/users' }, { label: user.name }]}
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/users')}>Back</Button>
            <PermissionGuard permission={PERMISSIONS.USERS_EDIT}>
              <Button type="primary" icon={<EditOutlined />} onClick={() => { editForm.setFieldsValue({ name: user.name, role: user.role, department: user.department, status: user.status }); setEditOpen(true); }}>
                Edit
              </Button>
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.USERS_EDIT}>
              <Button icon={<KeyOutlined />} onClick={confirmResetPassword} loading={resetPasswordLoading}>
                Reset Password
              </Button>
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.USERS_SUSPEND}>
              {user.status === 'active' && (
                <Popconfirm title="Suspend this user?" onConfirm={handleSuspend}>
                  <Button icon={<StopOutlined />} danger>Suspend</Button>
                </Popconfirm>
              )}
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.USERS_ACTIVATE}>
              {user.status === 'suspended' && (
                <Popconfirm title="Activate this user?" onConfirm={handleActivate}>
                  <Button icon={<CheckCircleOutlined />} type="primary" style={{ background: success, borderColor: success }}>Activate</Button>
                </Popconfirm>
              )}
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.USERS_DELETE}>
              <Popconfirm title="Permanently delete?" onConfirm={handleDelete}>
                <Button icon={<DeleteOutlined />} danger>Delete</Button>
              </Popconfirm>
            </PermissionGuard>
          </Space>
        }
      />

      {/* Profile Header Card */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24} align="middle">
          <Col>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Avatar
                size={80}
                src={user.avatar}
                style={{ backgroundColor: blue, fontSize: 32 }}
              >
                {!user.avatar && getInitials(user.name)}
              </Avatar>
              <PermissionGuard permission={PERMISSIONS.USERS_EDIT}>
                <Tooltip title="Change avatar">
                  <Button
                    type="primary"
                    shape="circle"
                    size="small"
                    icon={<CameraOutlined />}
                    onClick={openAvatarModal}
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                  />
                </Tooltip>
              </PermissionGuard>
            </div>
          </Col>
          <Col flex="auto">
            <Title level={3} style={{ marginBottom: 4 }}>{user.name}</Title>
            <Space size={16} wrap>
              <Space>
                <MailOutlined style={{ color: muted(isDark) }} />
                <Text>{user.email}</Text>
              </Space>
              <Space>
                <IdcardOutlined style={{ color: muted(isDark) }} />
                <Text>{user.accountType === 'admin' ? 'Admin Account' : 'Customer Account'}</Text>
              </Space>
              {user.department && (
                <Space>
                  <TeamOutlined style={{ color: muted(isDark) }} />
                  <Text>{departments.find(d => d.value === user.department)?.label || user.department}</Text>
                </Space>
              )}
            </Space>
            <div style={{ marginTop: 12 }}>
              <Space size={8}>
                <RoleTag role={user.role} />
                <StatusTag status={user.status} />
                {user.isEmailVerified && <Tag icon={<VerifiedIcon />} color="success">Email Verified</Tag>}
              </Space>
            </div>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        {/* Left Column - Information Cards */}
        <Col xs={24} lg={16}>
          {/* Account Details */}
          <Card title={<Space><SafetyOutlined />Account Details</Space>} style={{ marginBottom: 16 }}>
            <Row gutter={[24, 24]}>
              <Col xs={24} sm={24}>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>ROLE</Text>
                  <div style={{ marginTop: 4 }}>
                    <Space>
                      <CrownOutlined style={{ color: warning }} />
                      <Text strong>{user.role?.charAt(0).toUpperCase() + user.role?.slice(1)}</Text>
                    </Space>
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>DEPARTMENT</Text>
                  <div style={{ marginTop: 4 }}>
                    <Space>
                      <TeamOutlined style={{ color: blue }} />
                      <Text strong>{user.department ? (departments.find(d => d.value === user.department)?.label || user.department) : '—'}</Text>
                    </Space>
                  </div>
                </div>
              </Col>
            </Row>
          </Card>

          {/* Activity Information */}
          <Card title={<Space><ClockCircleOutlined />Activity Information</Space>} style={{ marginBottom: 16 }}>
            <Row gutter={[24, 24]}>
              <Col xs={24} sm={12}>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>LAST LOGIN</Text>
                  <div style={{ marginTop: 4 }}>
                    <Space>
                      <CalendarOutlined style={{ color: blue }} />
                      <Text strong>{user.lastLogin ? formatDateTime(user.lastLogin) : 'Never'}</Text>
                    </Space>
                  </div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>CREATED</Text>
                  <div style={{ marginTop: 4 }}>
                    <Space>
                      <CalendarOutlined style={{ color: muted(isDark) }} />
                      <Text>{formatDateTime(user.createdAt)}</Text>
                    </Space>
                  </div>
                </div>
              </Col>
              <Col xs={24} sm={12}>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>LAST LOGIN IP</Text>
                  <div style={{ marginTop: 4 }}>
                    <Space>
                      <EnvironmentOutlined style={{ color: blue }} />
                      <Text strong>{formatIPAddress(user.lastLoginIP)}</Text>
                    </Space>
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>CREATED BY</Text>
                  <div style={{ marginTop: 4 }}>
                    <Space>
                      <UserOutlined style={{ color: muted(isDark) }} />
                      <Text>{user.assignedBy ? user.assignedBy.name : 'Self Registered'}</Text>
                    </Space>
                  </div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>LAST UPDATED</Text>
                  <div style={{ marginTop: 4 }}>
                    <Space>
                      <CalendarOutlined style={{ color: muted(isDark) }} />
                      <Text>{formatDateTime(user.updatedAt)}</Text>
                    </Space>
                  </div>
                </div>
              </Col>
            </Row>
          </Card>

          {/* Permissions */}
          {user.permissions && user.permissions.length > 0 && (
            <Card title={<Space><SafetyOutlined />Permissions ({user.permissions.length})</Space>}>
              <Space wrap>
                {user.permissions.map((p) => (
                  <Tag key={p} color="blue" style={{ marginBottom: 8 }}>
                    {p.replace('_', ' ').replace('.', ' › ')}
                  </Tag>
                ))}
              </Space>
            </Card>
          )}
        </Col>

        {/* Right Column - Activity Timeline */}
        <Col xs={24} lg={8}>
          <Card
            title="Recent Activity"
            extra={
              <Button
                icon={<DownloadOutlined />}
                onClick={handleExportActivity}
                loading={exportingActivity}
                size="small"
              >
                Export
              </Button>
            }
            style={{ position: 'sticky', top: 16 }}
          >
            <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>FILTER BY DATE RANGE</Text>
              <DateTimeRangePicker
                value={activityDateRange}
                onChange={setActivityDateRange}
                placeholder={['Start Date & Time', 'End Date & Time']}
                use24HourFormat={false}
              />
            </Space>

            {activity.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <ClockCircleOutlined style={{ fontSize: 48, color: subtle(isDark), marginBottom: 16 }} />
                <div style={{ color: muted(isDark) }}>No recent activity</div>
              </div>
            ) : (
              <Timeline
                items={activity.map((a) => ({
                  color: a.status === 'success' ? 'green' : a.status === 'failed' ? 'red' : 'gray',
                  children: (
                    <div>
                      <div style={{ fontWeight: 500 }}>{a.action}</div>
                      <div style={{ fontSize: 12, color: muted(isDark), marginTop: 4 }}>{a.description}</div>
                      {a.ipAddress && (
                        <div style={{ fontSize: 11, color: blue, marginTop: 2 }}>
                          <GlobalOutlined style={{ marginRight: 4 }} />
                          {formatIPAddress(a.ipAddress)}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: subtle(isDark), marginTop: 2 }}>{timeAgo(a.createdAt)}</div>
                    </div>
                  ),
                }))}
              />
            )}
          </Card>

          {/* Login History */}
          <Card
            title={<Space><GlobalOutlined />Login History</Space>}
            loading={loginHistoryLoading}
            style={{ position: 'sticky', top: 16 }}
          >
            {loginHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <GlobalOutlined style={{ fontSize: 48, color: subtle(isDark), marginBottom: 16 }} />
                <div style={{ color: muted(isDark) }}>No login history available</div>
              </div>
            ) : (
              <Timeline
                items={loginHistory.map((login) => ({
                  color: login.status === 'success' ? 'green' : 'red',
                  children: (
                    <div>
                      <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <GlobalOutlined style={{ color: blue }} />
                        {formatIPAddress(login.ipAddress)}
                      </div>
                      <div style={{ fontSize: 12, color: muted(isDark), marginTop: 4 }}>
                        {login.description || 'Admin login'}
                      </div>
                      <div style={{ fontSize: 11, color: subtle(isDark), marginTop: 2 }}>
                        {formatDateTime(login.createdAt)}
                      </div>
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* Avatar Update Modal */}
      <Modal
        title="Update Avatar"
        open={avatarModalOpen}
        onCancel={() => {
          setAvatarModalOpen(false);
          setAvatarUrl('');
          setFileList([]);
        }}
        onOk={handleAvatarUpdate}
        okText="Save"
        confirmLoading={avatarLoading}
        width={550}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div style={{ textAlign: 'center' }}>
            <Avatar
              size={100}
              src={
                uploadMethod === 'upload' && fileList.length > 0
                  ? fileList[0].base64
                  : uploadMethod === 'url'
                    ? avatarUrl
                    : user.avatar
              }
              style={{ backgroundColor: blue, fontSize: 40 }}
            >
              {(!avatarUrl && !user.avatar && fileList.length === 0) && getInitials(user.name)}
            </Avatar>
            <div style={{ marginTop: 8, color: muted(isDark), fontSize: 12 }}>
              Preview
            </div>
          </div>

          <Tabs
            activeKey={uploadMethod}
            onChange={setUploadMethod}
            items={[
              {
                key: 'url',
                label: (
                  <span>
                    <LinkOutlined /> URL
                  </span>
                ),
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Input
                      placeholder="Enter image URL (e.g., https://example.com/avatar.jpg)"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      prefix={<LinkOutlined />}
                      allowClear
                      size="large"
                    />
                    <div style={{ fontSize: 12, color: muted(isDark) }}>
                      <div style={{ marginBottom: 4 }}>💡 Tips:</div>
                      <ul style={{ paddingLeft: 20, margin: 0 }}>
                        <li>Use any publicly accessible image URL</li>
                        <li>Recommended size: 200x200 pixels or larger</li>
                        <li>Example: https://i.pravatar.cc/200</li>
                      </ul>
                    </div>
                  </Space>
                )
              },
              {
                key: 'upload',
                label: (
                  <span>
                    <UploadOutlined /> Upload
                  </span>
                ),
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Upload
                      listType="picture-card"
                      fileList={fileList}
                      onChange={handleUploadChange}
                      beforeUpload={beforeUpload}
                      accept="image/*"
                      maxCount={1}
                    >
                      {fileList.length === 0 && (
                        <div>
                          <UploadOutlined />
                          <div style={{ marginTop: 8 }}>Upload</div>
                        </div>
                      )}
                    </Upload>
                    <div style={{ fontSize: 12, color: muted(isDark) }}>
                      <div style={{ marginBottom: 4 }}>💡 Tips:</div>
                      <ul style={{ paddingLeft: 20, margin: 0 }}>
                        <li>Supported formats: JPG, PNG, GIF, WebP</li>
                        <li>Maximum file size: 5MB</li>
                        <li>Recommended size: 200x200 pixels or larger</li>
                      </ul>
                    </div>
                  </Space>
                )
              }
            ]}
          />

          {(user.avatar || avatarUrl || fileList.length > 0) && (
            <Button
              danger
              block
              onClick={async () => {
                setAvatarLoading(true);
                try {
                  await usersApi.updateUser(id, { avatar: null });
                  message.success('Avatar removed successfully');
                  setAvatarModalOpen(false);
                  setAvatarUrl('');
                  setFileList([]);
                  fetchUser();
                } catch (err) {
                  message.error('Failed to remove avatar');
                } finally {
                  setAvatarLoading(false);
                }
              }}
              loading={avatarLoading}
            >
              Remove Avatar
            </Button>
          )}
        </Space>
      </Modal>

      {/* Edit Drawer */}
      <Drawer
        title="Edit User"
        open={editOpen}
        onClose={() => setEditOpen(false)}
        width={400}
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="primary" loading={editLoading} onClick={() => editForm.submit()}>Save</Button>
          </Space>
        }
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="role" label="Role">
            <Select
              options={[
                { value: 'admin', label: 'Admin' },
                { value: 'moderator', label: 'Moderator' },
                { value: 'viewer', label: 'Viewer' },
              ]}
              suffixIcon={<CrownOutlined />}
            />
          </Form.Item>
          <Form.Item name="department" label="Department">
            <Select
              options={departments}
              allowClear
              showSearch
              suffixIcon={<TeamOutlined />}
            />
          </Form.Item>
          <Form.Item name="status" label="Status">
            <Select options={[
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'inactive', label: 'Inactive' },
            ]} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default UserDetailPage;
