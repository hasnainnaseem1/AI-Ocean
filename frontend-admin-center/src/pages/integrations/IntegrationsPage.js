import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Form, Input, Button, Typography, Row, Col, Switch, Spin,
  Tag, Space, message, Alert, Descriptions, Tooltip,
  Modal, InputNumber, Radio,
} from 'antd';
import {
  CreditCardOutlined, MailOutlined,
  SaveOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
  SafetyOutlined, KeyOutlined, LinkOutlined,
  SettingOutlined,
  ShoppingCartOutlined, SwapOutlined, ArrowLeftOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import PageHeader from '../../components/common/PageHeader';
import { IconTile } from '../../components/StatRow';
import { useTheme } from '../../contexts/ThemeContext';
import { getBrand, STATUS_COLORS, hairline, adminCardStyle, muted } from '../../theme/colors';

const { Title, Text, Paragraph } = Typography;

/* ═══════════════════════════ Stripe Tab ═══════════════════════════ */
const StripeTab = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentSettings, setCurrentSettings] = useState(null);
  const { isDark } = useTheme();
  const brand = getBrand(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      if (data.success) {
        const stripe = data.settings?.stripeSettings || {};
        setCurrentSettings(stripe);
        form.setFieldsValue({
          publicKey: stripe.publicKey || '',
          secretKey: '',
          webhookSecret: '',
        });
      }
    } catch {
      message.error('Failed to load Stripe settings');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async (values) => {
    setSaving(true);
    try {
      const payload = { publicKey: values.publicKey };
      if (values.secretKey) payload.secretKey = values.secretKey;
      if (values.webhookSecret) payload.webhookSecret = values.webhookSecret;
      const data = await settingsApi.updateStripe(payload);
      if (data.success) {
        message.success('Stripe settings saved successfully');
        form.setFieldsValue({ secretKey: '', webhookSecret: '' });
        fetchSettings();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save Stripe settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        icon={<CreditCardOutlined />}
        message="Stripe Payment Integration"
        description="Configure your Stripe API keys to enable payment processing. You can find your API keys in the Stripe Dashboard under Developers → API keys."
        style={{ marginBottom: 24, borderRadius: 12 }}
      />

      {currentSettings?.publicKey && (
        <Card size="small" style={{ marginBottom: 20, borderRadius: 12, background: STATUS_COLORS.success.bg(isDark), border: `1px solid ${hairline(isDark)}` }}>
          <Space>
            <CheckCircleOutlined style={{ color: success }} />
            <Text strong style={{ color: success }}>Stripe is configured</Text>
            <Text type="secondary">Public key: {currentSettings.publicKey?.slice(0, 12)}...{currentSettings.publicKey?.slice(-4)}</Text>
          </Space>
        </Card>
      )}

      <Form form={form} layout="vertical" onFinish={handleSave} requiredMark={false}>
        <Form.Item
          name="publicKey"
          label={<Space><KeyOutlined /> Publishable Key</Space>}
          rules={[{ required: true, message: 'Publishable key is required' }]}
          extra="Starts with pk_test_ or pk_live_"
        >
          <Input placeholder="pk_test_..." size="large" />
        </Form.Item>

        <Form.Item
          name="secretKey"
          label={<Space><SafetyOutlined /> Secret Key</Space>}
          extra="Leave blank to keep existing. Starts with sk_test_ or sk_live_"
        >
          <Input.Password placeholder={currentSettings?.publicKey ? '••••••••  (leave blank to keep existing)' : 'sk_test_...'} size="large" />
        </Form.Item>

        <Form.Item
          name="webhookSecret"
          label={<Space><LinkOutlined /> Webhook Signing Secret</Space>}
          extra="Leave blank to keep existing. Starts with whsec_"
        >
          <Input.Password placeholder={currentSettings?.publicKey ? '••••••••  (leave blank to keep existing)' : 'whsec_...'} size="large" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} size="large"
            style={{ background: brand, borderColor: brand }}>
            Save Stripe Settings
          </Button>
        </Form.Item>
      </Form>

      <Card title="Webhook Setup" size="small" style={{ borderRadius: 12, marginTop: 12 }}>
        <Paragraph type="secondary" style={{ fontSize: 13, margin: 0 }}>
          Point your Stripe webhook to:
        </Paragraph>
        <Input
          readOnly
          value={`${process.env.REACT_APP_API_URL || window.location.origin}/api/v1/webhooks/stripe`}
          style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 13 }}
          addonAfter={
            <Tooltip title="Copy">
              <Button type="text" size="small" onClick={() => {
                navigator.clipboard.writeText(`${process.env.REACT_APP_API_URL || window.location.origin}/api/v1/webhooks/stripe`);
                message.success('Copied!');
              }}>
                Copy
              </Button>
            </Tooltip>
          }
        />
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Events to listen for: <code>checkout.session.completed</code>, <code>charge.dispute.created</code>, <code>charge.refunded</code>
        </Paragraph>
      </Card>
    </div>
  );
};

/* ═══════════════════════════ Email Tab ═══════════════════════════ */
const EmailTab = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const { isDark } = useTheme();
  const brand = getBrand(isDark);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      if (data.success) {
        const email = data.settings?.emailSettings || {};
        const port = email.smtpPort || 587;
        setHasExistingPassword(!!email.smtpUser);
        form.setFieldsValue({
          smtpHost: email.smtpHost || '',
          smtpPort: port,
          smtpUser: email.smtpUser || '',
          smtpPassword: '',
          fromName: email.fromName || '',
          fromEmail: email.fromEmail || '',
          smtpSecure: port === 465,
        });
      }
    } catch {
      message.error('Failed to load email settings');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  // Auto-set TLS toggle when port changes
  const handlePortChange = (value) => {
    if (value === 465) {
      form.setFieldsValue({ smtpSecure: true });
    } else if (value === 587 || value === 25 || value === 2525) {
      form.setFieldsValue({ smtpSecure: false });
    }
  };

  const handleSave = async (values) => {
    setSaving(true);
    try {
      const payload = {
        smtpHost: values.smtpHost,
        smtpPort: values.smtpPort,
        smtpUser: values.smtpUser,
        fromName: values.fromName,
        fromEmail: values.fromEmail,
        smtpSecure: !!values.smtpSecure,
      };
      // Only send password if user typed one (don't overwrite with empty)
      if (values.smtpPassword) payload.smtpPassword = values.smtpPassword;

      const data = await settingsApi.updateEmail(payload);
      if (data.success) {
        message.success('Email settings saved');
        setHasExistingPassword(true);
        form.setFieldsValue({ smtpPassword: '' });
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) { message.warning('Enter a test email address'); return; }
    setTesting(true);
    try {
      const data = await settingsApi.testEmail(testEmail);
      if (data.success) message.success('Test email sent!');
      else message.error(data.message || 'Test email failed');
    } catch (err) {
      message.error(err.response?.data?.message || 'Test email failed');
    } finally {
      setTesting(false);
    }
  };

  const portValue = Form.useWatch('smtpPort', form);
  const tlsHelpText = portValue === 465
    ? 'Port 465 uses implicit SSL/TLS — toggle is ON automatically.'
    : portValue === 587
      ? 'Port 587 uses STARTTLS (auto-upgrades to TLS) — toggle should be OFF.'
      : portValue === 25
        ? 'Port 25 is unencrypted SMTP — not recommended for production.'
        : 'Common ports: 587 (STARTTLS, recommended), 465 (SSL/TLS), 25 (unencrypted).';

  return (
    <div style={{ maxWidth: 720 }}>
      <Alert
        type="info" showIcon icon={<MailOutlined />}
        message="SMTP Email Configuration"
        description="Configure your outbound email settings. Use your email provider's SMTP credentials (SendGrid, Gmail, Mailgun, Amazon SES, etc.)."
        style={{ marginBottom: 24, borderRadius: 12 }}
      />

      <Form form={form} layout="vertical" onFinish={handleSave} requiredMark={false}>
        <Row gutter={16}>
          <Col xs={24} md={16}>
            <Form.Item name="smtpHost" label="SMTP Host" rules={[{ required: true, message: 'SMTP host is required' }]}
              extra="e.g. smtp.sendgrid.net, smtp.gmail.com, smtp.mailgun.org"
            >
              <Input placeholder="smtp.sendgrid.net" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="smtpPort" label="Port" rules={[{ required: true, message: 'Port is required' }]}
              extra="587 (STARTTLS) or 465 (SSL)"
            >
              <InputNumber placeholder="587" size="large" min={1} max={65535}
                style={{ width: '100%' }}
                onChange={handlePortChange}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="smtpUser" label="Username / API Key" rules={[{ required: true, message: 'Username is required' }]}
              extra="For SendGrid use 'apikey' as username"
            >
              <Input placeholder="apikey or your@email.com" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="smtpPassword" label="Password / API Key"
              extra={hasExistingPassword ? 'Leave blank to keep existing password' : 'Enter your SMTP password or API key'}
            >
              <Input.Password placeholder={hasExistingPassword ? '••••••••  (saved — leave blank to keep)' : 'Enter password or API key'} size="large" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="fromName" label="From Name" rules={[{ required: true, message: 'Sender name is required' }]}
              extra="Shown as the sender name in emails"
            >
              <Input placeholder="My Platform" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="fromEmail" label="From Email" rules={[{ required: true, type: 'email', message: 'Valid email required' }]}
              extra="Must be verified in your email provider"
            >
              <Input placeholder="noreply@yourdomain.com" size="large" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="smtpSecure" label="Use implicit SSL/TLS" valuePropName="checked"
          extra={<Text type="secondary" style={{ fontSize: 12 }}>{tlsHelpText}</Text>}
        >
          <Switch checkedChildren="SSL/TLS (port 465)" unCheckedChildren="STARTTLS (port 587)" />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} size="large"
            style={{ background: brand, borderColor: brand }}>
            Save Email Settings
          </Button>
        </Space>
      </Form>

      <Card title="Send Test Email" size="small" style={{ borderRadius: 12, marginTop: 24 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Save your settings first, then send a test email to verify everything works.
        </Text>
        <Space.Compact style={{ width: '100%' }}>
          <Input placeholder="recipient@example.com" value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)} size="large" />
          <Button type="primary" icon={<MailOutlined />} onClick={handleTestEmail}
            loading={testing} size="large">
            Send Test
          </Button>
        </Space.Compact>
      </Card>
    </div>
  );
};

/* ═══════════════════════════ Google SSO Tab ═══════════════════════════ */
const GoogleSSOTab = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const { isDark } = useTheme();
  const brand = getBrand(isDark);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      if (data.success) {
        const gso = data.settings?.googleSSOSettings || {};
        setEnabled(!!gso.enabled);
        form.setFieldsValue({
          enabled: !!gso.enabled,
          clientId: gso.clientId || '',
          clientSecret: '',
        });
      }
    } catch {
      message.error('Failed to load Google SSO settings');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async (values) => {
    setSaving(true);
    try {
      const data = await settingsApi.updateGoogleSSO(values);
      if (data.success) {
        message.success('Google SSO settings saved');
        form.setFieldsValue({ clientSecret: '' });
        fetchSettings();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Alert
        type="info" showIcon
        message="Google Single Sign-On"
        description="Allow users to log in with their Google account. You'll need a Google Cloud OAuth 2.0 Client ID."
        style={{ marginBottom: 24, borderRadius: 12 }}
      />

      <Form form={form} layout="vertical" onFinish={handleSave} requiredMark={false}>
        <Form.Item name="enabled" label="Enable Google SSO" valuePropName="checked">
          <Switch
            checkedChildren="Enabled"
            unCheckedChildren="Disabled"
            onChange={(v) => setEnabled(v)}
          />
        </Form.Item>

        {enabled && (
          <>
            <Form.Item name="clientId" label="Client ID" rules={[{ required: true, message: 'Client ID is required' }]}>
              <Input placeholder="xxxx.apps.googleusercontent.com" size="large" />
            </Form.Item>
            <Form.Item name="clientSecret" label="Client Secret" extra="Leave blank to keep existing">
              <Input.Password placeholder="••••••••" size="large" />
            </Form.Item>
          </>
        )}

        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} size="large"
            style={{ background: brand, borderColor: brand }}>
            Save Google SSO Settings
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

/* ═══════════════════════ Shared payment-gateway pieces ═══════════════════════
 * Every payment gateway tab (Stripe doesn't need this one — it predates the
 * multi-gateway switch and still has its own always-on flow) needs the same
 * "Active Payment Gateway" radio selector. It used to be copy-pasted inside
 * LemonSqueezyTab; with Polar as a third option it's pulled out once here so
 * a fourth gateway only needs a GATEWAY_META entry, not a third copy of this
 * card. PAYMENT_GATEWAY_KEYS mirrors the backend's gatewayRegistry.js list —
 * kept as a small hardcoded array here since the settings API doesn't expose
 * the registry itself, matching how this page already hardcodes gateway keys
 * elsewhere (INTEGRATIONS below).
 */
const PAYMENT_GATEWAY_KEYS = ['stripe', 'lemonsqueezy', 'polar'];
const GATEWAY_META = {
  stripe: { label: 'Stripe', icon: <CreditCardOutlined /> },
  lemonsqueezy: { label: 'LemonSqueezy', icon: <ShoppingCartOutlined /> },
  polar: { label: 'Polar', icon: <GlobalOutlined /> },
};
const gatewayLabel = (key) => GATEWAY_META[key]?.label || key;

const ActivePaymentGatewaySelector = ({ activeGateway, onSwitch, switching, isDark }) => (
  <Card
    size="small"
    title={<Space><SwapOutlined /> Active Payment Gateway</Space>}
    style={{ marginBottom: 20, borderRadius: 12, background: STATUS_COLORS.warning.bg(isDark), border: `1px solid ${hairline(isDark)}` }}
  >
    <Space direction="vertical" style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 13 }}>
        Select which payment gateway to use for customer checkout. Only one gateway can be active at a time.
      </Text>
      <Radio.Group
        value={activeGateway}
        onChange={(e) => onSwitch(e.target.value)}
        disabled={switching}
        style={{ marginTop: 8 }}
      >
        <Space direction="vertical">
          {PAYMENT_GATEWAY_KEYS.map((key) => (
            <Radio value={key} key={key}>
              <Space>
                {GATEWAY_META[key].icon}
                <Text strong>{GATEWAY_META[key].label}</Text>
                {activeGateway === key && <Tag color="green">Active</Tag>}
              </Space>
            </Radio>
          ))}
          <Radio value="none">
            <Space>
              <CloseCircleOutlined />
              <Text strong>None (Payments Disabled)</Text>
              {activeGateway === 'none' && <Tag color="default">Active</Tag>}
            </Space>
          </Radio>
        </Space>
      </Radio.Group>
    </Space>
  </Card>
);

/* ═══════════════════════════ LemonSqueezy Tab ═══════════════════════════ */
const LemonSqueezyTab = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentSettings, setCurrentSettings] = useState(null);
  const [activeGateway, setActiveGateway] = useState('stripe');
  const [switchingGateway, setSwitchingGateway] = useState(false);
  const { isDark } = useTheme();
  const brand = getBrand(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      if (data.success) {
        const ls = data.settings?.lemonSqueezySettings || {};
        setCurrentSettings(ls);
        setActiveGateway(data.settings?.activePaymentGateway || 'stripe');
        form.setFieldsValue({
          apiKey: '',
          storeId: ls.storeId || '',
          webhookSecret: '',
        });
      }
    } catch {
      message.error('Failed to load LemonSqueezy settings');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async (values) => {
    setSaving(true);
    try {
      // "enabled" is no longer edited from this form — it's driven by the
      // card-level switch on the Integrations page (which keeps it in sync
      // with activePaymentGateway) — so resend the value exactly as fetched.
      const payload = { storeId: values.storeId, enabled: currentSettings?.enabled ?? false };
      if (values.apiKey) payload.apiKey = values.apiKey;
      if (values.webhookSecret) payload.webhookSecret = values.webhookSecret;
      const data = await settingsApi.updateLemonSqueezy(payload);
      if (data.success) {
        message.success('LemonSqueezy settings saved successfully');
        form.setFieldsValue({ apiKey: '', webhookSecret: '' });
        fetchSettings();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save LemonSqueezy settings');
    } finally {
      setSaving(false);
    }
  };

  const handleGatewaySwitch = async (value) => {
    setSwitchingGateway(true);
    try {
      const data = await settingsApi.updatePaymentGateway({ gateway: value });
      if (data.success) {
        setActiveGateway(value);
        message.success(`Active payment gateway set to ${value === 'none' ? 'None' : gatewayLabel(value)}`);
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to switch payment gateway');
    } finally {
      setSwitchingGateway(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        icon={<ShoppingCartOutlined />}
        message="LemonSqueezy Payment Integration"
        description="Configure your LemonSqueezy API keys to enable payment processing. You can find your API key in the LemonSqueezy Dashboard under Settings → API."
        style={{ marginBottom: 24, borderRadius: 12 }}
      />

      <ActivePaymentGatewaySelector
        activeGateway={activeGateway}
        onSwitch={handleGatewaySwitch}
        switching={switchingGateway}
        isDark={isDark}
      />

      {currentSettings?.storeId && (
        <Card size="small" style={{ marginBottom: 20, borderRadius: 12, background: STATUS_COLORS.success.bg(isDark), border: `1px solid ${hairline(isDark)}` }}>
          <Space>
            <CheckCircleOutlined style={{ color: success }} />
            <Text strong style={{ color: success }}>LemonSqueezy is configured</Text>
            <Text type="secondary">Store ID: {currentSettings.storeId}</Text>
            {currentSettings.enabled ? (
              <Tag color="green">Enabled</Tag>
            ) : (
              <Tag color="orange">Disabled</Tag>
            )}
          </Space>
        </Card>
      )}

      <Form form={form} layout="vertical" onFinish={handleSave} requiredMark={false}>
        <Form.Item
          name="apiKey"
          label={<Space><KeyOutlined /> API Key</Space>}
          extra="Leave blank to keep existing. Found in LemonSqueezy Dashboard → Settings → API"
        >
          <Input.Password
            placeholder={currentSettings?.storeId ? '••••••••  (leave blank to keep existing)' : 'Your LemonSqueezy API key'}
            size="large"
          />
        </Form.Item>

        <Form.Item
          name="storeId"
          label={<Space><SettingOutlined /> Store ID</Space>}
          rules={[{ required: true, message: 'Store ID is required' }]}
          extra="Found in LemonSqueezy Dashboard → Settings → Stores"
        >
          <Input placeholder="Your Store ID (e.g., 12345)" size="large" />
        </Form.Item>

        <Form.Item
          name="webhookSecret"
          label={<Space><LinkOutlined /> Webhook Signing Secret</Space>}
          extra="Leave blank to keep existing. Set when creating a webhook in LemonSqueezy Dashboard"
        >
          <Input.Password
            placeholder={currentSettings?.storeId ? '••••••••  (leave blank to keep existing)' : 'Your webhook signing secret'}
            size="large"
          />
        </Form.Item>

        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 24 }}>
          Use the toggle on the Integrations page to turn LemonSqueezy on or off — only one
          payment gateway can be active at a time.
        </Text>

        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} size="large"
            style={{ background: brand, borderColor: brand }}>
            Save LemonSqueezy Settings
          </Button>
        </Form.Item>
      </Form>

      <Card title="Webhook Setup" size="small" style={{ borderRadius: 12, marginTop: 12 }}>
        <Paragraph type="secondary" style={{ fontSize: 13, margin: 0 }}>
          Point your LemonSqueezy webhook to:
        </Paragraph>
        <Input
          readOnly
          value={`${process.env.REACT_APP_API_URL || window.location.origin}/api/v1/webhooks/lemonsqueezy`}
          style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 13 }}
          addonAfter={
            <Tooltip title="Copy">
              <Button type="text" size="small" onClick={() => {
                navigator.clipboard.writeText(`${process.env.REACT_APP_API_URL || window.location.origin}/api/v1/webhooks/lemonsqueezy`);
                message.success('Copied!');
              }}>
                Copy
              </Button>
            </Tooltip>
          }
        />
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Events to listen for: <code>order_created</code>
        </Paragraph>
      </Card>
    </div>
  );
};

/* ═══════════════════════════ Polar Tab ═══════════════════════════ */
const PolarTab = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentSettings, setCurrentSettings] = useState(null);
  const [activeGateway, setActiveGateway] = useState('stripe');
  const [switchingGateway, setSwitchingGateway] = useState(false);
  const { isDark } = useTheme();
  const brand = getBrand(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      if (data.success) {
        const polar = data.settings?.polarSettings || {};
        setCurrentSettings(polar);
        setActiveGateway(data.settings?.activePaymentGateway || 'stripe');
        form.setFieldsValue({
          accessToken: '',
          organizationId: polar.organizationId || '',
          productId: polar.productId || '',
          webhookSecret: '',
          sandbox: !!polar.sandbox,
        });
      }
    } catch {
      message.error('Failed to load Polar settings');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async (values) => {
    setSaving(true);
    try {
      // "enabled" is driven by the card-level switch on the Integrations page,
      // not this form — resend it exactly as fetched, same as LemonSqueezyTab.
      const payload = {
        organizationId: values.organizationId,
        productId: values.productId,
        sandbox: !!values.sandbox,
        enabled: currentSettings?.enabled ?? false,
      };
      if (values.accessToken) payload.accessToken = values.accessToken;
      if (values.webhookSecret) payload.webhookSecret = values.webhookSecret;
      const data = await settingsApi.updatePolar(payload);
      if (data.success) {
        message.success('Polar settings saved successfully');
        form.setFieldsValue({ accessToken: '', webhookSecret: '' });
        fetchSettings();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save Polar settings');
    } finally {
      setSaving(false);
    }
  };

  const handleGatewaySwitch = async (value) => {
    setSwitchingGateway(true);
    try {
      const data = await settingsApi.updatePaymentGateway({ gateway: value });
      if (data.success) {
        setActiveGateway(value);
        message.success(`Active payment gateway set to ${value === 'none' ? 'None' : gatewayLabel(value)}`);
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to switch payment gateway');
    } finally {
      setSwitchingGateway(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        icon={<GlobalOutlined />}
        message="Polar Payment Integration"
        description="Configure your Polar access token to enable payment processing and card-on-file top-ups. Find your access token in the Polar Dashboard under Settings → API."
        style={{ marginBottom: 24, borderRadius: 12 }}
      />

      <ActivePaymentGatewaySelector
        activeGateway={activeGateway}
        onSwitch={handleGatewaySwitch}
        switching={switchingGateway}
        isDark={isDark}
      />

      {currentSettings?.organizationId && (
        <Card size="small" style={{ marginBottom: 20, borderRadius: 12, background: STATUS_COLORS.success.bg(isDark), border: `1px solid ${hairline(isDark)}` }}>
          <Space>
            <CheckCircleOutlined style={{ color: success }} />
            <Text strong style={{ color: success }}>Polar is configured</Text>
            <Text type="secondary">Organization: {currentSettings.organizationId}</Text>
            {currentSettings.sandbox && <Tag color="orange">Sandbox</Tag>}
            {currentSettings.enabled ? (
              <Tag color="green">Enabled</Tag>
            ) : (
              <Tag color="orange">Disabled</Tag>
            )}
          </Space>
        </Card>
      )}

      <Form form={form} layout="vertical" onFinish={handleSave} requiredMark={false}>
        <Form.Item
          name="accessToken"
          label={<Space><KeyOutlined /> Access Token</Space>}
          extra="Leave blank to keep existing. Found in Polar Dashboard → Settings → API"
        >
          <Input.Password
            placeholder={currentSettings?.organizationId ? '••••••••  (leave blank to keep existing)' : 'Your Polar access token'}
            size="large"
          />
        </Form.Item>

        <Form.Item
          name="organizationId"
          label={<Space><SettingOutlined /> Organization ID</Space>}
          rules={[{ required: true, message: 'Organization ID is required' }]}
          extra="Found in Polar Dashboard → Settings → General"
        >
          <Input placeholder="Your Polar organization ID" size="large" />
        </Form.Item>

        <Form.Item
          name="productId"
          label={<Space><ShoppingCartOutlined /> Placeholder Product ID</Space>}
          rules={[{ required: true, message: 'Product ID is required' }]}
          extra="A fixed-price, non-subscription product created in Polar that wallet top-up and off-session charges attach a custom amount to"
        >
          <Input placeholder="Your Polar placeholder product ID" size="large" />
        </Form.Item>

        <Form.Item
          name="webhookSecret"
          label={<Space><LinkOutlined /> Webhook Signing Secret</Space>}
          extra="Leave blank to keep existing. Starts with whsec_ — set when creating a webhook in Polar Dashboard"
        >
          <Input.Password
            placeholder={currentSettings?.organizationId ? '••••••••  (leave blank to keep existing)' : 'Your webhook signing secret'}
            size="large"
          />
        </Form.Item>

        <Form.Item name="sandbox" label="Sandbox Mode" valuePropName="checked"
          extra="Use Polar's sandbox environment for testing before going live"
        >
          <Switch checkedChildren="Sandbox" unCheckedChildren="Live" />
        </Form.Item>

        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 24 }}>
          Use the toggle on the Integrations page to turn Polar on or off — only one
          payment gateway can be active at a time.
        </Text>

        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} size="large"
            style={{ background: brand, borderColor: brand }}>
            Save Polar Settings
          </Button>
        </Form.Item>
      </Form>

      <Card title="Webhook Setup" size="small" style={{ borderRadius: 12, marginTop: 12 }}>
        <Paragraph type="secondary" style={{ fontSize: 13, margin: 0 }}>
          Point your Polar webhook to:
        </Paragraph>
        <Input
          readOnly
          value={`${process.env.REACT_APP_API_URL || window.location.origin}/api/v1/webhooks/polar`}
          style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 13 }}
          addonAfter={
            <Tooltip title="Copy">
              <Button type="text" size="small" onClick={() => {
                navigator.clipboard.writeText(`${process.env.REACT_APP_API_URL || window.location.origin}/api/v1/webhooks/polar`);
                message.success('Copied!');
              }}>
                Copy
              </Button>
            </Tooltip>
          }
        />
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Events to listen for: <code>order.paid</code>
        </Paragraph>
      </Card>
    </div>
  );
};

/* ═══════════════════════════ Main Page ═══════════════════════════ */

/**
 * TailAdmin's own status pill, redone with this app's tokens: a soft tint of
 * one of the three states already used everywhere else (success/info/
 * neutral), never a bare hardcoded colour.
 */
const StatusPill = ({ status, isDark }) => {
  const c = STATUS_COLORS[status.tone] || STATUS_COLORS.neutral;
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
        whiteSpace: 'nowrap',
        background: c.bg(isDark), color: isDark ? c.dark : c.light,
      }}
    >
      {status.text}
    </span>
  );
};

/**
 * The card grid is a *front door*, not a re-implementation, for everything
 * except on/off. Every field this page writes for configuration still lives
 * in exactly one of the four Tab components above (StripeTab, LemonSqueezyTab,
 * EmailTab, GoogleSSOTab) — the grid only reads a summary via
 * `settingsApi.getSettings()` (the same read-only call those tabs already
 * make independently) to paint an honest status pill and a details readout;
 * clicking through opens the real, unmodified panel to actually change
 * credentials, so there is exactly one place each secret can be written.
 *
 * Enable/disable is the one exception: the card's own `Switch` calls
 * `settingsApi.toggleIntegration` directly, since that's the one action a
 * card-level control can make sense of without opening the full form. Stripe
 * and LemonSqueezy share a "payment" mutual-exclusion rule (turning one on
 * turns the other off, via `activePaymentGateway`) enforced server-side in
 * `integrationsController.toggleIntegration` — this page just warns before
 * the switch, it doesn't re-implement the rule.
 *
 * Two cards used to live here and don't anymore, both for the same reason —
 * neither is a connection to an external service, which is the one thing
 * that actually defines "integration":
 *   - Email Templates is wording, not a connection — the same kind of thing
 *     as the "Customer messages" fields on Settings → Billing. It now lives
 *     in Settings, next to Notifications (see EmailTemplatesSettings.js).
 *   - Jobs (cron) is the platform's own internal scheduler, not an external
 *     connection — and it's a full record list (create/edit/run-now/delete),
 *     not a form of toggles either, so it got its own page rather than a
 *     Settings tab. It's now Administration → Jobs (see pages/jobs/JobsPage.js).
 *
 * The reference (TailAdmin) has a generic "New integration" flow for
 * arbitrary third-party connectors. This platform's integrations are fixed,
 * built-in capabilities, not a connector marketplace — nothing in the
 * backend can create a new one — so that button is deliberately not
 * reproduced here; adding one that led nowhere would be worse than not
 * having it.
 */
const IntegrationsPage = () => {
  const { isDark } = useTheme();
  const [selectedKey, setSelectedKey] = useState(null);
  const [detailsFor, setDetailsFor] = useState(null);
  const [summary, setSummary] = useState(null);
  const [togglingKey, setTogglingKey] = useState(null);

  const reloadSummary = useCallback(async () => {
    const settingsRes = await settingsApi.getSettings().catch(() => null);
    setSummary({ settings: settingsRes?.settings || {} });
  }, []);

  useEffect(() => { reloadSummary(); }, [reloadSummary]);

  const doToggle = async (item, nextChecked) => {
    setTogglingKey(item.key);
    try {
      const data = await settingsApi.toggleIntegration(item.key, nextChecked);
      if (data.success) {
        message.success(`${item.label} ${nextChecked ? 'enabled' : 'disabled'}`);
        await reloadSummary();
      }
    } catch (err) {
      message.error(err.response?.data?.message || `Failed to ${nextChecked ? 'enable' : 'disable'} ${item.label}`);
    } finally {
      setTogglingKey(null);
    }
  };

  const handleToggle = (item, nextChecked) => {
    // Payment gateways are mutually exclusive — warn before silently
    // switching whichever one is currently active off. Not a single "sibling"
    // any more now that there are three (Stripe/LemonSqueezy/Polar): any
    // other currently-active payment gateway is the one that would turn off.
    const currentActive = s.activePaymentGateway;
    const isPaymentGateway = PAYMENT_GATEWAY_KEYS.includes(item.key);
    if (nextChecked && isPaymentGateway && currentActive && currentActive !== 'none' && currentActive !== item.key) {
      Modal.confirm({
        title: 'Switch payment gateway?',
        content: `This will turn off ${gatewayLabel(currentActive)}. Continue?`,
        okText: 'Switch',
        onOk: () => doToggle(item, nextChecked),
      });
      return;
    }
    doToggle(item, nextChecked);
  };

  const s = summary?.settings || {};
  const stripe = s.stripeSettings || {};
  const lemon = s.lemonSqueezySettings || {};
  const polar = s.polarSettings || {};
  const email = s.emailSettings || {};
  const gso = s.googleSSOSettings || {};
  const activeGateway = s.activePaymentGateway || 'stripe';

  const emailEnabled = email.enabled !== false; // schema defaults true — undefined reads as on

  const INTEGRATIONS = [
    {
      key: 'stripe', label: 'Stripe Payments', tone: 'blue', icon: <CreditCardOutlined />,
      description: 'Card payments and saved payment methods.',
      status: stripe.publicKey
        ? (activeGateway === 'stripe' ? { text: 'Active gateway', tone: 'success' } : { text: 'Configured', tone: 'info' })
        : { text: 'Not connected', tone: 'neutral' },
      detailRows: [
        { label: 'Publishable key', value: stripe.publicKey ? `${stripe.publicKey.slice(0, 12)}…${stripe.publicKey.slice(-4)}` : 'Not set' },
        { label: 'Active payment gateway', value: activeGateway === 'stripe' ? 'Yes' : 'No' },
      ],
      Component: StripeTab,
      checked: activeGateway === 'stripe',
      configured: !!stripe.publicKey,
      disabledReason: 'Add your Stripe API keys first',
    },
    {
      key: 'lemonsqueezy', label: 'LemonSqueezy', tone: 'amber', icon: <ShoppingCartOutlined />,
      description: 'Merchant-of-record checkout for wallet top-ups.',
      status: lemon.storeId
        ? (activeGateway === 'lemonsqueezy'
          ? { text: 'Active gateway', tone: 'success' }
          : { text: 'Configured', tone: 'info' })
        : { text: 'Not connected', tone: 'neutral' },
      detailRows: [
        { label: 'Store ID', value: lemon.storeId || 'Not set' },
        { label: 'Active payment gateway', value: activeGateway === 'lemonsqueezy' ? 'Yes' : 'No' },
      ],
      Component: LemonSqueezyTab,
      checked: activeGateway === 'lemonsqueezy',
      configured: !!lemon.storeId,
      disabledReason: 'Add your LemonSqueezy store ID and API key first',
    },
    {
      key: 'polar', label: 'Polar', tone: 'cyan', icon: <GlobalOutlined />,
      description: 'Card-on-file checkout and off-session PAYG charging.',
      status: polar.organizationId
        ? (activeGateway === 'polar'
          ? { text: 'Active gateway', tone: 'success' }
          : { text: 'Configured', tone: 'info' })
        : { text: 'Not connected', tone: 'neutral' },
      detailRows: [
        { label: 'Organization ID', value: polar.organizationId || 'Not set' },
        { label: 'Placeholder product ID', value: polar.productId || 'Not set' },
        { label: 'Sandbox mode', value: polar.sandbox ? 'Yes' : 'No' },
        { label: 'Active payment gateway', value: activeGateway === 'polar' ? 'Yes' : 'No' },
      ],
      Component: PolarTab,
      checked: activeGateway === 'polar',
      configured: !!(polar.organizationId && polar.productId),
      disabledReason: 'Add your Polar organization ID and product ID first',
    },
    {
      key: 'email', label: 'Email / SMTP', tone: 'purple', icon: <MailOutlined />,
      description: 'Outbound email for verification, receipts and alerts.',
      status: !email.smtpHost
        ? { text: 'Not connected', tone: 'neutral' }
        : (emailEnabled ? { text: 'Configured', tone: 'success' } : { text: 'Disabled', tone: 'neutral' }),
      detailRows: [
        { label: 'SMTP host', value: email.smtpHost || 'Not set' },
        { label: 'Port', value: email.smtpPort || '—' },
        { label: 'From address', value: email.fromEmail || 'Not set' },
        { label: 'Enabled', value: emailEnabled ? 'Yes' : 'No' },
      ],
      Component: EmailTab,
      checked: emailEnabled,
      configured: !!email.smtpHost,
      disabledReason: 'Add your SMTP host first',
    },
    {
      key: 'google-sso', label: 'Google SSO', tone: 'green', icon: <SafetyOutlined />,
      description: 'Let admins and customers sign in with Google.',
      status: gso.enabled ? { text: 'Enabled', tone: 'success' } : { text: 'Disabled', tone: 'neutral' },
      detailRows: [
        { label: 'Enabled', value: gso.enabled ? 'Yes' : 'No' },
        { label: 'Client ID', value: gso.clientId ? `${gso.clientId.slice(0, 18)}…` : 'Not set' },
      ],
      Component: GoogleSSOTab,
      checked: !!gso.enabled,
      configured: true,
      disabledReason: '',
    },
  ];

  // ── Detail view: the real, unmodified panel for one integration ──
  if (selectedKey) {
    const item = INTEGRATIONS.find((i) => i.key === selectedKey);
    const Panel = item.Component;
    return (
      <div>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => setSelectedKey(null)}
          style={{ paddingLeft: 0, marginBottom: 10, color: muted(isDark) }}
        >
          Back to Integrations
        </Button>
        <Title level={4} style={{ margin: '0 0 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconTile icon={item.icon} tone={item.tone} size={30} />
          {item.label}
        </Title>
        <Panel />
      </div>
    );
  }

  // ── Grid view ──
  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="External services this platform connects to — payments, email, and authentication"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Administration' }, { label: 'Integrations' }]}
      />

      <Spin spinning={!summary}>
        <Row gutter={[16, 16]}>
          {INTEGRATIONS.map((item) => (
            <Col xs={24} sm={12} lg={8} key={item.key}>
              <div
                className="card-hover"
                style={{
                  ...adminCardStyle(isDark),
                  padding: 18,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <IconTile icon={item.icon} tone={item.tone} size={40} />

                <div style={{ flex: 1 }}>
                  <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>
                    {item.label}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {item.description}
                  </Text>
                </div>

                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    paddingTop: 12, borderTop: `1px solid ${hairline(isDark)}`,
                  }}
                >
                  <Space size={6}>
                    <Tooltip title="Configure">
                      <Button size="small" shape="circle" icon={<SettingOutlined />} onClick={() => setSelectedKey(item.key)} />
                    </Tooltip>
                    <Button size="small" onClick={() => setDetailsFor(item.key)}>Details</Button>
                  </Space>
                  <Space size={8}>
                    <StatusPill status={item.status} isDark={isDark} />
                    <Tooltip title={!item.configured ? item.disabledReason : (item.checked ? 'Turn off' : 'Turn on')}>
                      <Switch
                        size="small"
                        checked={item.checked}
                        disabled={!item.configured}
                        loading={togglingKey === item.key}
                        onChange={(checked) => handleToggle(item, checked)}
                      />
                    </Tooltip>
                  </Space>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Spin>

      <Modal
        title={detailsFor ? INTEGRATIONS.find((i) => i.key === detailsFor)?.label : ''}
        open={!!detailsFor}
        onCancel={() => setDetailsFor(null)}
        footer={[
          <Button key="close" onClick={() => setDetailsFor(null)}>Close</Button>,
          <Button
            key="configure" type="primary"
            onClick={() => { setSelectedKey(detailsFor); setDetailsFor(null); }}
          >
            Configure
          </Button>,
        ]}
      >
        <Descriptions column={1} bordered size="small">
          {(INTEGRATIONS.find((i) => i.key === detailsFor)?.detailRows || []).map((r) => (
            <Descriptions.Item label={r.label} key={r.label}>{r.value}</Descriptions.Item>
          ))}
        </Descriptions>
      </Modal>
    </div>
  );
};

export default IntegrationsPage;
