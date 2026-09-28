import React, { useState } from 'react';
import { Form, Input, Button, message, Result } from 'antd';
import { LockOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import authApi from '../api/authApi';
import AuthShell from '../components/AuthShell';
import { codeFont } from '../theme/colors';

const ResetPasswordPage = () => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [stage, setStage] = useState('reset');
  const navigate = useNavigate();

  const onFinish = async (values) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('The two passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword(values.resetToken, values.newPassword, values.confirmPassword);
      setStage('success');
      message.success('Password reset.');
    } catch (error) {
      message.error(error.response?.data?.message || 'Could not reset the password.');
    } finally {
      setLoading(false);
    }
  };

  if (stage === 'success') {
    return (
      <AuthShell maxWidth={460}>
        <Result
          status="success"
          title="Password reset"
          subTitle="You can now sign in with your new password."
          extra={
            <Button
              type="primary"
              className="btn-gradient"
              style={{ borderRadius: 10, fontWeight: 700 }}
              onClick={() => navigate('/login')}
            >
              Go to sign in
            </Button>
          }
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset password" subtitle="Enter your reset token and a new password.">
      <Form
        form={form}
        name="reset-password"
        onFinish={onFinish}
        layout="vertical"
        size="large"
        requiredMark={false}
      >
        <Form.Item
          name="resetToken"
          label="Reset token"
          rules={[
            { required: true, message: 'Please enter your reset token' },
            { min: 10, message: 'That does not look like a reset token' },
          ]}
        >
          {/* A token is genuinely code-like, so it gets the mono face — the one
              place in this app's type system where that is the right call. */}
          <Input placeholder="Paste your reset token here" autoFocus style={codeFont} />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="New password"
          rules={[
            { required: true, message: 'Please enter your new password' },
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

        <Form.Item style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            className="btn-gradient"
            style={{ height: 46, borderRadius: 12, fontWeight: 700 }}
          >
            Reset password
          </Button>
        </Form.Item>

        <div style={{ textAlign: 'center' }}>
          <Button type="link" onClick={() => navigate('/login')} icon={<ArrowLeftOutlined />}>
            Back to sign in
          </Button>
        </div>
      </Form>
    </AuthShell>
  );
};

export default ResetPasswordPage;
