import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Typography, Space, Tag, Input, Button, Divider,
  message, Popconfirm, Modal, Alert, Select,
} from 'antd';
import {
  FileTextOutlined, CopyOutlined, UndoOutlined, SaveOutlined, EyeOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import { useTheme } from '../../contexts/ThemeContext';
import { getBrand, brandSoft, hairline } from '../../theme/colors';

const { Text } = Typography;

/**
 * Every template the backend sends, grouped the way an operator thinks about
 * them rather than the order they happen to sit in the source.
 *
 * This list used to hold only the first three, and the sidebar renders from its
 * keys — so the six deployment and wallet emails were unreachable from this
 * screen entirely. They were being sent to customers with no way to read or
 * change their wording.
 */
const TEMPLATE_GROUPS = [
  {
    title: 'Account',
    keys: {
      verification: 'Email Verification',
      welcome: 'Welcome Email',
      passwordReset: 'Password Reset',
    },
  },
  {
    title: 'Deployments',
    keys: {
      deploymentApproved: 'Deployment Approved',
      deploymentReady: 'Deployment Ready',
      deploymentRejected: 'Deployment Rejected',
      deploymentSuspended: 'Deployment Paused',
    },
  },
  {
    title: 'Wallet',
    keys: {
      creditTopUp: 'Credit Added',
      lowBalance: 'Low Balance',
    },
  },
  {
    title: 'Teams',
    keys: {
      teamInvite: 'Team Invitation',
    },
  },
];

const TEMPLATE_LABELS = TEMPLATE_GROUPS.reduce(
  (all, group) => Object.assign(all, group.keys),
  {},
);

/**
 * The wording for every system email this platform sends — subject and HTML
 * body, per template, with {{variable}} placeholders.
 *
 * Lives in Settings rather than Integrations: unlike Email/SMTP (a
 * connection to an external mail relay, with a host and credentials), this
 * page has no external connection of its own — it's copy, the same kind of
 * thing as the "Customer messages" fields already on the Billing tab, just
 * for a different set of emails. It sits next to Notifications for the same
 * reason: Notifications decides *when* an email fires, this decides *what it
 * says*.
 */
const EmailTemplatesSettings = () => {
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [templates, setTemplates] = useState({});
  const [selectedKey, setSelectedKey] = useState('verification');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lang, setLang] = useState('en');
  const [languages, setLanguages] = useState([]);
  const { isDark } = useTheme();
  const brand = getBrand(isDark);

  // `lang` is a dependency on purpose: switching language refetches, because
  // both the saved override and the shipped default shown as the placeholder
  // are per-language.
  const fetchTemplates = useCallback(async () => {
    try {
      const data = await settingsApi.getEmailTemplates(lang);
      if (data.success) {
        setTemplates(data.templates);
        if (data.languages) setLanguages(data.languages);
        const t = data.templates[selectedKey];
        setSubject(t?.subject || '');
        setBody(t?.body || '');
        setDirty(false);
      }
    } catch {
      message.error('Failed to load email templates');
    }
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleSelectLanguage = (next) => {
    if (next === lang) return;
    if (dirty) {
      Modal.confirm({
        title: 'Unsaved Changes',
        content: 'You have unsaved changes in this language. Switch anyway?',
        onOk: () => setLang(next),
      });
    } else {
      setLang(next);
    }
  };

  const currentLanguage = languages.find((l) => l.code === lang);
  const isRtl = currentLanguage?.dir === 'rtl';

  const handleSelectTemplate = (key) => {
    if (dirty) {
      Modal.confirm({
        title: 'Unsaved Changes',
        content: 'You have unsaved changes. Switch anyway?',
        onOk: () => switchTo(key),
      });
    } else {
      switchTo(key);
    }
  };

  const switchTo = (key) => {
    setSelectedKey(key);
    const t = templates[key];
    setSubject(t?.subject || '');
    setBody(t?.body || '');
    setDirty(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await settingsApi.updateEmailTemplate(selectedKey, { subject, body }, lang);
      if (data.success) {
        message.success(data.message || 'Template saved');
        setDirty(false);
        fetchTemplates();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const data = await settingsApi.resetEmailTemplate(selectedKey, lang);
      if (data.success) {
        message.success('Template reset to default');
        setDirty(false);
        fetchTemplates();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to reset template');
    } finally {
      setResetting(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const data = await settingsApi.previewEmailTemplate(selectedKey, { subject, body }, lang);
      if (data.success) {
        setPreviewHtml(data.html || '');
        setPreviewVisible(true);
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to preview');
    } finally {
      setPreviewing(false);
    }
  };

  const handleUseDefault = () => {
    const t = templates[selectedKey];
    if (t) {
      setSubject('');
      setBody('');
      setDirty(true);
    }
  };

  const handleCopyDefault = () => {
    const t = templates[selectedKey];
    if (t) {
      setSubject(t.defaultSubject || '');
      setBody(t.defaultBody || '');
      setDirty(true);
      message.info('Default template copied — you can now edit it');
    }
  };

  const current = templates[selectedKey] || {};
  const isCustomized = !!(current.subject?.trim() || current.body?.trim());
  const vars = current.variables || [];

  return (
    <div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 20,
      }}>
        <Alert
          type="info" showIcon
          icon={<FileTextOutlined />}
          message="Leave a field empty to use the built-in default template. Use {{variable}} placeholders for dynamic content."
          style={{ borderRadius: 12, flex: '1 1 420px', minWidth: 280 }}
        />
        <Space size={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>Language</Text>
          <Select
            value={lang}
            onChange={handleSelectLanguage}
            style={{ minWidth: 190 }}
            options={languages.map((l) => ({
              value: l.code,
              label: l.code === 'en' ? l.englishName : `${l.englishName} · ${l.nativeName}`,
            }))}
          />
        </Space>
      </div>

      {lang !== 'en' && (
        <Alert
          type="warning" showIcon
          message={`You are editing the ${currentLanguage?.englishName || lang} copy.`}
          description="Customers who have not chosen this language will not see it. Leaving a field empty falls back to the shipped translation, and then to English."
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      <Row gutter={24}>
        {/* Template selector sidebar */}
        <Col xs={24} md={7}>
          <Card size="small" title="Templates" style={{ borderRadius: 12 }}
            bodyStyle={{ padding: 0 }}>
            {TEMPLATE_GROUPS.map((group) => (
              <div key={group.title}>
                <div style={{
                  padding: '8px 16px',
                  borderBottom: `1px solid ${hairline(isDark)}`,
                  fontSize: 10,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  opacity: 0.6,
                }}>
                  {group.title}
                </div>
                {Object.keys(group.keys).map((key) => {
                  const t = templates[key] || {};
                  const custom = !!(t.subject?.trim() || t.body?.trim());
                  return (
                    <div
                      key={key}
                      onClick={() => handleSelectTemplate(key)}
                      style={{
                        padding: '12px 16px',
                        cursor: 'pointer',
                        borderLeft: selectedKey === key ? `3px solid ${brand}` : '3px solid transparent',
                        background: selectedKey === key ? brandSoft(isDark) : 'transparent',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: `1px solid ${hairline(isDark)}`,
                        transition: 'all 0.2s',
                      }}
                    >
                      <Text strong={selectedKey === key} style={{ fontSize: 13 }}>
                        {TEMPLATE_LABELS[key]}
                      </Text>
                      {custom && (
                        <Tag color="blue" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>Custom</Tag>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </Card>
        </Col>

        {/* Editor area */}
        <Col xs={24} md={17}>
          <Card
            size="small"
            title={
              <Space>
                <span>{TEMPLATE_LABELS[selectedKey]}</span>
                {isCustomized ? (
                  <Tag color="blue">Customized</Tag>
                ) : (
                  <Tag color="default">Using Default</Tag>
                )}
                {dirty && <Tag color="orange">Unsaved</Tag>}
              </Space>
            }
            style={{ borderRadius: 12 }}
            extra={
              <Space>
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopyDefault}>
                  Copy Default
                </Button>
                <Popconfirm
                  title="Reset this template to default?"
                  description="Custom subject and body will be cleared."
                  onConfirm={handleReset}
                >
                  <Button size="small" icon={<UndoOutlined />} loading={resetting} danger>
                    Reset
                  </Button>
                </Popconfirm>
              </Space>
            }
          >
            {/* Available variables */}
            {vars.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  Available Variables:
                </Text>
                <Space wrap size={[4, 4]}>
                  {vars.map((v) => (
                    <Tag
                      key={v}
                      style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}
                      onClick={() => {
                        navigator.clipboard.writeText(`{{${v}}}`);
                        message.info(`Copied {{${v}}}`);
                      }}
                    >
                      {`{{${v}}}`}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/* Subject field */}
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 6 }}>Subject</Text>
              <Input
                value={subject}
                onChange={(e) => { setSubject(e.target.value); setDirty(true); }}
                placeholder={current.defaultSubject || 'Leave empty to use default'}
                size="large"
                dir={isRtl ? 'rtl' : 'ltr'}
              />
              {!subject && current.defaultSubject && (
                <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                  Default: {current.defaultSubject}
                </Text>
              )}
            </div>

            {/* Body field */}
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 6 }}>
                Body (HTML)
              </Text>
              {/* Stays LTR even for Arabic and Urdu: this field is HTML source,
                  and tags, attributes and {{variables}} read left-to-right. The
                  prose inside it renders RTL in the preview and in the sent
                  email, which is where direction actually matters. */}
              <Input.TextArea
                value={body}
                onChange={(e) => { setBody(e.target.value); setDirty(true); }}
                placeholder={current.defaultBody ? 'Leave empty to use default template...' : ''}
                rows={14}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
              {!body && (
                <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                  Using built-in default template. Click "Copy Default" to start customizing.
                </Text>
              )}
            </div>

            {/* Action buttons */}
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
                size="large"
                style={{ background: brand, borderColor: brand }}
              >
                Save Template
              </Button>
              <Button
                icon={<EyeOutlined />}
                onClick={handlePreview}
                loading={previewing}
                size="large"
              >
                Preview
              </Button>
              <Button
                onClick={handleUseDefault}
                size="large"
              >
                Clear (Use Default)
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* Preview modal */}
      <Modal
        title={`Preview: ${TEMPLATE_LABELS[selectedKey]}`}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={700}
        styles={{ body: { padding: 0 } }}
      >
        <div
          style={{ border: `1px solid ${hairline(isDark)}`, borderRadius: 8, overflow: 'auto', maxHeight: 600 }}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </Modal>
    </div>
  );
};

export default EmailTemplatesSettings;
