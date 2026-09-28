import React, { useState, useEffect, useRef } from 'react';
import {
  Card, Form, Input, Button, Typography, Avatar, Row, Col, Divider,
  Space, message, Tag, Descriptions, Select, Upload, Spin
} from 'antd';
import {
  UserOutlined, MailOutlined, LockOutlined, SaveOutlined,
  SafetyOutlined, CrownOutlined, CalendarOutlined, EditOutlined,
  GlobalOutlined, CameraOutlined, DeleteOutlined
} from '@ant-design/icons';
import authApi from '../../api/authApi';
import { useTheme } from '../../contexts/ThemeContext';
import { GRADIENT, TILE } from '../../theme/colors';

const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Adak', 'America/Phoenix', 'America/Toronto',
  'America/Vancouver', 'America/Mexico_City', 'America/Bogota', 'America/Lima',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich',
  'Europe/Stockholm', 'Europe/Oslo', 'Europe/Helsinki', 'Europe/Warsaw',
  'Europe/Prague', 'Europe/Vienna', 'Europe/Athens', 'Europe/Bucharest',
  'Europe/Istanbul', 'Europe/Moscow', 'Europe/Kiev',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo',
  'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore',
  'Asia/Kuala_Lumpur', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Taipei',
  'Asia/Seoul', 'Asia/Tokyo', 'Asia/Riyadh', 'Asia/Tehran',
  'Asia/Almaty', 'Asia/Tashkent',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg',
  'Africa/Casablanca',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
  'Australia/Perth', 'Australia/Adelaide',
  'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Honolulu',
  'Pacific/Guam', 'Pacific/Chatham',
];

const { Title, Text } = Typography;

const ProfilePage = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef(null);
  const { isDark } = useTheme();
  const purple = TILE.purple.fg(isDark);

  const handleAvatarUpload = (file) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('You can only upload image files');
      return false;
    }
    const isLt2M = file.size / 1024 / 1024 < 2;
    if (!isLt2M) {
      message.error('Image must be smaller than 2MB');
      return false;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result;
      try {
        setAvatarUploading(true);
        const data = await authApi.updateProfile({ avatar: base64 });
        if (data.success) {
          setUser(data.user);
          message.success('Profile picture updated');
          const stored = JSON.parse(localStorage.getItem('admin_user') || '{}');
          localStorage.setItem('admin_user', JSON.stringify({ ...stored, ...data.user }));
        }
      } catch (err) {
        message.error('Failed to upload profile picture');
      } finally {
        setAvatarUploading(false);
      }
    };
    reader.readAsDataURL(file);
    return false; // prevent default upload
  };

  const handleRemoveAvatar = async () => {
    try {
      setAvatarUploading(true);
      const data = await authApi.updateProfile({ avatar: null });
      if (data.success) {
        setUser(data.user);
        message.success('Profile picture removed');
        const stored = JSON.parse(localStorage.getItem('admin_user') || '{}');
        localStorage.setItem('admin_user', JSON.stringify({ ...stored, ...data.user }));
      }
    } catch (err) {
      message.error('Failed to remove profile picture');
    } finally {
      setAvatarUploading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const data = await authApi.getMe();
      if (data.success) {
        setUser(data.user);
        profileForm.setFieldsValue({
          name: data.user.name,
          email: data.user.email,
          timezone: data.user.timezone,
        });
      }
    } catch {
      message.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (values) => {
    try {
      setProfileSaving(true);
      const data = await authApi.updateProfile({
        name: values.name,
        timezone: values.timezone,
      });
      if (data.success) {
        message.success('Profile updated successfully');
        setUser(data.user);
        // Update local storage
        const stored = JSON.parse(localStorage.getItem('admin_user') || '{}');
        localStorage.setItem('admin_user', JSON.stringify({ ...stored, ...data.user }));
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (values) => {
    try {
      setPasswordSaving(true);
      const data = await authApi.changePassword(values.currentPassword, values.newPassword);
      if (data.success) {
        message.success('Password changed successfully');
        passwordForm.resetFields();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to change password');
    } finally {
      setPasswordSaving(false);
    }
  };

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : 'A';

  const roleColors = {
    super_admin: 'red',
    admin: 'blue',
    moderator: 'green',
    viewer: 'default',
    custom: 'purple',
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={3} style={{ marginBottom: 24 }}>
        <UserOutlined style={{ marginRight: 8 }} /> My Profile
      </Title>

      {/* Profile Overview Card */}
      <Card style={{ marginBottom: 24 }} loading={loading}>
        {user && (
          <Row gutter={[24, 24]} align="middle">
            <Col xs={24} sm={6} style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <Spin spinning={avatarUploading}>
                  <Avatar
                    size={80}
                    src={user.avatar || undefined}
                    style={{
                      background: user.avatar ? 'transparent' : GRADIENT,
                      fontWeight: 700,
                      fontSize: 28,
                      cursor: 'pointer',
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {!user.avatar && initials}
                  </Avatar>
                </Spin>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleAvatarUpload(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                    background: purple,
                    borderRadius: '50%',
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    border: '2px solid #fff',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <CameraOutlined style={{ color: '#fff', fontSize: 13 }} />
                </div>
              </div>
              {user.avatar && (
                <div style={{ marginTop: 8 }}>
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={handleRemoveAvatar}
                    loading={avatarUploading}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </Col>
            <Col xs={24} sm={18}>
              <Title level={4} style={{ margin: 0 }}>
                {user.name}
              </Title>
              <Text type="secondary">{user.email}</Text>
              <div style={{ marginTop: 8 }}>
                <Space>
                  <Tag color={roleColors[user.role] || 'default'} icon={<CrownOutlined />}>
                    {(user.role || '').replace(/_/g, ' ').toUpperCase()}
                  </Tag>
                  <Tag color={user.status === 'active' ? 'green' : 'red'}>
                    {(user.status || '').toUpperCase()}
                  </Tag>
                  {user.department && <Tag>{user.department}</Tag>}
                </Space>
              </div>
              {user.createdAt && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <CalendarOutlined /> Member since{' '}
                    {new Date(user.createdAt).toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </Text>
                </div>
              )}
            </Col>
          </Row>
        )}
      </Card>

      {/* Edit Profile */}
      <Card
        title={
          <span>
            <EditOutlined style={{ marginRight: 8 }} /> Edit Profile
          </span>
        }
        style={{ marginBottom: 24 }}
      >
        <Form
          form={profileForm}
          layout="vertical"
          onFinish={handleUpdateProfile}
          requiredMark={false}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="Full Name"
                rules={[{ required: true, message: 'Name is required' }]}
              >
                <Input prefix={<UserOutlined />} placeholder="Your name" size="large" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="Email">
                <Input
                  prefix={<MailOutlined />}
                  disabled
                  size="large"
                  style={{ opacity: 0.7 }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="timezone" label="Timezone">
                <Select
                  placeholder="Select your timezone"
                  size="large"
                  showSearch
                  suffixIcon={<GlobalOutlined />}
                  filterOption={(input, option) =>
                    (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={TIMEZONES.map((tz) => ({ label: tz.replace(/_/g, ' '), value: tz }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={profileSaving}
              size="large"
            >
              Save Changes
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* Change Password */}
      <Card
        title={
          <span>
            <SafetyOutlined style={{ marginRight: 8 }} /> Change Password
          </span>
        }
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handleChangePassword}
          requiredMark={false}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="currentPassword"
                label="Current Password"
                rules={[{ required: true, message: 'Current password is required' }]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Enter current password"
                  size="large"
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="newPassword"
                label="New Password"
                rules={[
                  { required: true, message: 'New password is required' },
                  { min: 8, message: 'Password must be at least 8 characters' },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Enter new password"
                  size="large"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="confirmPassword"
                label="Confirm New Password"
                dependencies={['newPassword']}
                rules={[
                  { required: true, message: 'Please confirm password' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('newPassword') === value)
                        return Promise.resolve();
                      return Promise.reject(new Error('Passwords do not match'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Confirm new password"
                  size="large"
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<LockOutlined />}
              loading={passwordSaving}
              size="large"
              danger
            >
              Change Password
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default ProfilePage;
