import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Typography, message, Modal } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AuthShell from '../components/AuthShell';

const { Text } = Typography;

const LoginPage = () => {
  const [loading, setLoading] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordForm] = Form.useForm();
  const [passwordLoading, setPasswordLoading] = useState(false);
  const { login, isAuthenticated, user, changePassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/';

  useEffect(() => {
    if (isAuthenticated && !user?.passwordChangeRequired) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, user?.passwordChangeRequired, navigate, from]);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const result = await login(values.email, values.password);

      if (result.user?.passwordChangeRequired) {
        // First login on a temporary password — the change is mandatory, so
        // the modal below is not dismissable.
        message.info('Please change your temporary password');
        setPasswordModalVisible(true);
      } else {
        message.success('Signed in.');
        navigate(from, { replace: true });
      }
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || 'Sign in failed. Please try again.';
      // 423 is a locked account — a warning rather than an error, because the
      // credentials were fine and there is nothing to retype.
      if (status === 423) message.warning(msg);
      else message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const onPasswordChange = async (values) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('The two passwords do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      message.success('Password changed.');
      setPasswordModalVisible(false);
      passwordForm.resetFields();
      navigate(from, { replace: true });
    } catch (error) {
      message.error(error.response?.data?.message || 'Could not change the password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Manage your platform.">
      <Form
        name="admin-login"
        onFinish={onFinish}
        layout="vertical"
        size="large"
        requiredMark={false}
      >
        <Form.Item
          name="email"
          rules={[
            { required: true, message: 'Please enter your email' },
            { type: 'email', message: 'Please enter a valid email' },
          ]}
        >
          <Input prefix={<MailOutlined />} placeholder="Email address" autoFocus />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[{ required: true, message: 'Please enter your password' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Password" />
        </Form.Item>

        <Form.Item style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            className="btn-gradient"
            style={{ height: 46, borderRadius: 12, fontWeight: 700 }}
          >
            Sign In
          </Button>
        </Form.Item>

        <div style={{ textAlign: 'center' }}>
          <Button type="link" onClick={() => navigate('/forgot-password')} style={{ padding: 0 }}>
            Forgot your password?
          </Button>
        </div>
      </Form>

      <Text
        type="secondary"
        style={{ display: 'block', marginTop: 28, fontSize: 12.5, textAlign: 'center' }}
      >
        Admin access only. Contact your administrator if you need access.
      </Text>

      {/* First-login password change — deliberately not dismissable */}
      <Modal
        title="Change your password"
        open={passwordModalVisible}
        onCancel={() => {}}
        footer={null}
        closable={false}
        maskClosable={false}
        width={420}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
          This is your first sign in. Please replace your temporary password with a secure one.
        </Text>
        <Form form={passwordForm} layout="vertical" onFinish={onPasswordChange}>
          <Form.Item
            name="currentPassword"
            label="Current password"
            rules={[{ required: true, message: 'Please enter your current password' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Your temporary password" />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label="New password"
            rules={[
              { required: true, message: 'Please enter a new password' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Create a strong password" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="Confirm password"
            rules={[{ required: true, message: 'Please confirm your password' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Confirm your password" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={passwordLoading}
              className="btn-gradient"
              style={{ height: 42, borderRadius: 10, fontWeight: 700 }}
            >
              Change password & continue
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </AuthShell>
  );
};

export default LoginPage;
