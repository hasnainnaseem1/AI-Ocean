import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { afterSignIn } from '../auth/safeNext';
import {
  Form, Input, Button, Checkbox, Divider, Alert, Typography, theme
} from 'antd';
import {
  MailOutlined, LockOutlined, EyeInvisibleOutlined, EyeTwoTone,
  GoogleOutlined
} from '@ant-design/icons';
import { useGoogleLogin } from '@react-oauth/google';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import AuthShell from '../components/AuthShell';
import config from '../config';

const { Text } = Typography;

// Must be rendered INSIDE <GoogleOAuthProvider> — never call useGoogleLogin at the top level
const GoogleSignInButton = ({ onSuccess, onError }) => {
  const { t } = useTranslation('auth');
  const [loading, setLoading] = useState(false);
  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      try {
        const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/google`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ access_token: tokenResponse.access_token }),
        });
        const data = await res.json();
        if (data.success) {
          onSuccess(data.token, data.user);
        } else {
          onError(data.message || t('errors.googleFailed'));
        }
      } catch {
        onError(t('errors.network'));
      } finally {
        setLoading(false);
      }
    },
    onError: () => onError(t('errors.googleCancelled')),
  });
  return (
    <Button
      icon={<GoogleOutlined />}
      block
      size="large"
      loading={loading}
      onClick={() => googleLogin()}
      style={{ height: 44, fontWeight: 600, marginBottom: 24 }}
    >
      {t('signin.withGoogle')}
    </Button>
  );
};

const LoginPage = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  // Arriving from an invitation: the address it is for, filled in.
  const presetEmail = new URLSearchParams(location.search).get('email') || undefined;
  const { siteConfig, loaded: siteLoaded } = useSite();
  const googleEnabled = !!(siteConfig?.googleSSO?.enabled && siteConfig?.googleSSO?.clientId);
  const loginDisabled = siteLoaded && siteConfig?.enableLogin === false;
  const { token: tok } = theme.useToken();

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionData, setActionData] = useState(null);

  const handleSubmit = async (values) => {
    setErrorMsg('');
    setActionData(null);
    setLoading(true);
    try {
      const res  = await fetch(`${config.apiUrl}/api/v1/auth/customer/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: values.email, password: values.password }),
      });
      const data = await res.json();

      if (data.success) {
        login(data.token, data.user);
        navigate(afterSignIn(location.search));
      } else if (data.emailVerificationRequired) {
        setActionData({ action: 'verify_email', email: values.email });
        setErrorMsg(data.message || t('errors.verifyFirst'));
      } else if (data.action === 'signup') {
        setActionData({ action: 'signup' });
        setErrorMsg(data.message || t('errors.noAccount'));
      } else {
        setErrorMsg(data.message || t('errors.loginFailed'));
      }
    } catch {
      setErrorMsg(t('errors.network'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('signin.title')}
      subtitle={t('signin.subtitle')}
    >
      {loginDisabled && (
        <Alert
          type="warning"
          message={t('signin.disabledTitle')}
          description={t('signin.disabledBody')}
          showIcon
          style={{ marginBottom: 24, borderRadius: tok.borderRadius }}
        />
      )}

      {errorMsg && (
        <Alert
          type="error"
          message={errorMsg}
          showIcon
          style={{ marginBottom: 20, borderRadius: tok.borderRadius }}
          action={
            actionData?.action === 'verify_email' ? (
              <Button size="small" type="link" onClick={() =>
                navigate('/verify-email-sent', { state: { email: actionData.email } })
              }>
                {t('signin.resendLink')}
              </Button>
            ) : actionData?.action === 'signup' ? (
              <Button size="small" type="link" onClick={() => navigate(`/signup${location.search}`)}>
                {t('signin.signUpAction')}
              </Button>
            ) : null
          }
        />
      )}

      <Form form={form} layout="vertical" onFinish={handleSubmit} size="large" requiredMark={false} initialValues={{ email: presetEmail }}>
        <Form.Item
          name="email"
          label={<Text strong>{t('fields.emailLabel')}</Text>}
          rules={[
            { required: true, message: t('fields.emailRequired') },
            { type: 'email',  message: t('fields.emailInvalid') },
          ]}
        >
          <Input prefix={<MailOutlined style={{ color: tok.colorTextTertiary }} />} placeholder={t('fields.emailPlaceholder')} />
        </Form.Item>

        <Form.Item
          name="password"
          label={<Text strong>{t('fields.passwordLabel')}</Text>}
          rules={[{ required: true, message: t('fields.passwordRequired') }]}
          style={{ marginBottom: 8 }}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: tok.colorTextTertiary }} />}
            placeholder={t('fields.passwordPlaceholder')}
            iconRender={v => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <Form.Item name="rememberMe" valuePropName="checked" noStyle>
            <Checkbox>{t('signin.rememberMe')}</Checkbox>
          </Form.Item>
          <Link to="/forgot-password" style={{ color: tok.colorPrimary, fontWeight: 500, fontSize: 13 }}>
            {t('signin.forgotPassword')}
          </Link>
        </div>

        <Form.Item style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            disabled={loginDisabled}
            block
            style={{ height: 44, fontWeight: 600, fontSize: 15 }}
          >
            {t('signin.submitButton')}
          </Button>
        </Form.Item>
      </Form>

      {googleEnabled && !loginDisabled && (
        <>
          <Divider plain><Text type="secondary" style={{ fontSize: 12 }}>{t('signin.orContinueWith')}</Text></Divider>
          <GoogleSignInButton
            onSuccess={(token, user) => { login(token, user); navigate(afterSignIn(location.search)); }}
            onError={(msg) => setErrorMsg(msg)}
          />
        </>
      )}

      <div style={{ textAlign: 'center' }}>
        <Text type="secondary">{t('signin.noAccount')}{' '}</Text>
        {siteConfig?.enableCustomerSignup !== false ? (
          <Link to={`/signup${location.search}`} style={{ color: tok.colorPrimary, fontWeight: 600 }}>
            {t('signin.signUpLink')}
          </Link>
        ) : (
          <Text type="secondary">{t('signin.signupDisabled')}</Text>
        )}
      </div>
    </AuthShell>
  );
};

export default LoginPage;
