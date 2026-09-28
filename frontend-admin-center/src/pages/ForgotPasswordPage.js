import React, { useState } from 'react';
import { Form, Input, Button, Typography, message, Space, Result, Steps } from 'antd';
import { MailOutlined, ArrowLeftOutlined, CopyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import authApi from '../api/authApi';
import AuthShell from '../components/AuthShell';
import { useTheme } from '../contexts/ThemeContext';
import { STATUS_COLORS, codeFont } from '../theme/colors';

const { Text } = Typography;

/**
 * Password recovery, in three stages.
 *
 * Which stage you land in depends on who you are: a super admin can mint their
 * own reset token on the spot, while everyone else raises a request that a
 * super admin has to action. That split is the reason this page has stages at
 * all rather than a single "check your email" confirmation.
 */
const ForgotPasswordPage = () => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [stage, setStage] = useState('request');
  const [resetData, setResetData] = useState(null);
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const data = await authApi.forgotPassword(values.email);
      setResetData(data.user);

      if (data.user?.role === 'super_admin' && data.resetToken) {
        setStage('super-admin-reset');
        message.success('Reset token generated.');
      } else {
        setStage('request-sent');
        message.info('Your request has been sent to a Super Admin.');
      }
    } catch (error) {
      message.error(error.response?.data?.message || 'Could not process that request.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToken = (token) => {
    navigator.clipboard.writeText(token);
    message.success('Reset token copied.');
  };

  const backToLogin = (
    <Button type="link" onClick={() => navigate('/login')} icon={<ArrowLeftOutlined />}>
      Back to sign in
    </Button>
  );

  // ── Stage 1: ask for the email ──
  if (stage === 'request') {
    return (
      <AuthShell
        title="Forgot your password?"
        subtitle="Enter your email address and we'll help you reset it."
      >
        <Form
          form={form}
          name="forgot-password"
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

          <Form.Item style={{ marginBottom: 12 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              className="btn-gradient"
              style={{ height: 46, borderRadius: 12, fontWeight: 700 }}
            >
              Request password reset
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>{backToLogin}</div>
        </Form>
      </AuthShell>
    );
  }

  // ── Stage 2a: request raised on someone else's behalf ──
  if (stage === 'request-sent') {
    return (
      <AuthShell maxWidth={480}>
        <Result
          status="success"
          title="Request sent"
          subTitle={
            <Space vertical size={10} style={{ textAlign: 'left', marginTop: 12 }}>
              <Text>Your password reset request has gone to a Super Admin.</Text>
              <Text type="secondary">What happens next:</Text>
              <ol style={{ paddingLeft: 18, margin: 0, color: 'inherit' }}>
                <li>A Super Admin resets your password.</li>
                <li>You get a notification with a temporary password.</li>
                <li>Sign in with it.</li>
                <li>Choose a new password on that first sign in.</li>
              </ol>
            </Space>
          }
          extra={
            <Button
              type="primary"
              className="btn-gradient"
              style={{ borderRadius: 10, fontWeight: 700 }}
              onClick={() => navigate('/login')}
            >
              Back to sign in
            </Button>
          }
        />
      </AuthShell>
    );
  }

  // ── Stage 2b: super admin — hand them the token directly ──
  return (
    <AuthShell
      maxWidth={520}
      title="Reset your password"
      subtitle="Use the token below to set a new password."
    >
      <Space vertical size="large" style={{ width: '100%' }}>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            Reset token — expires in 24 hours
          </Text>
          <Space.Compact style={{ width: '100%' }}>
            <Input value={resetData?.resetToken} readOnly style={{ ...codeFont, fontSize: 12 }} />
            <Button icon={<CopyOutlined />} onClick={() => handleCopyToken(resetData?.resetToken)}>
              Copy
            </Button>
          </Space.Compact>
        </div>

        <Steps
          direction="vertical"
          size="small"
          current={0}
          items={[
            { title: 'Copy the token', description: 'Use the Copy button above.' },
            { title: 'Open the reset page', description: 'Continue with the button below.' },
            { title: 'Set a new password', description: 'Paste the token and choose a password.' },
            { title: 'Sign in', description: 'Use your new password.' },
          ]}
        />

        <div
          style={{
            background: STATUS_COLORS.info.bg(isDark),
            padding: 12,
            borderRadius: 10,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            This token is valid for 24 hours. After that you will need to request a new one.
          </Text>
        </div>

        <Button
          type="primary"
          block
          className="btn-gradient"
          onClick={() => navigate('/reset-password')}
          style={{ height: 44, borderRadius: 12, fontWeight: 700 }}
        >
          Go to reset password
        </Button>

        <div style={{ textAlign: 'center' }}>{backToLogin}</div>
      </Space>
    </AuthShell>
  );
};

export default ForgotPasswordPage;
