import React, { useState } from 'react';
import {
  Row, Col, Card, Form, Input, Button, Avatar, Typography, Tag, Alert,
  Progress, Switch, Modal, message, theme,
} from 'antd';
import {
  UserOutlined, LockOutlined, MailOutlined, PhoneOutlined,
  CheckCircleOutlined, EditOutlined, SafetyOutlined,
  WarningOutlined, LogoutOutlined, DeleteOutlined, EnvironmentOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import config from '../config';
import { cardStyle as surfaceStyle, getBrand, GRADIENT, STATUS_COLORS } from '../theme/colors';
import { getBillingInfo, saveBillingInfo } from '../utils/billingMock';
import { formatDate } from '../utils/format';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;
const { Password } = Input;

/**
 * Returns a translation *key* rather than a label — this runs outside any
 * component, so there is no `t` in scope, and a string resolved here could
 * never follow a later language change. The caller translates it.
 */
const getStrength = (pwd) => {
  if (!pwd) return { labelKey: '', color: '', pct: 0 };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const map = [
    { labelKey: 'account:strength.weak', color: STATUS_COLORS.error.light, pct: 25 },
    { labelKey: 'account:strength.fair', color: STATUS_COLORS.warning.light, pct: 50 },
    { labelKey: 'account:strength.good', color: STATUS_COLORS.info.light, pct: 75 },
    { labelKey: 'account:strength.strong', color: STATUS_COLORS.success.light, pct: 100 },
  ];
  return map[score - 1] || { labelKey: '', color: STATUS_COLORS.info.light, pct: 0 };
};

/**
 * A read-only labelled value — the reference layout shows saved details as
 * plain text and only swaps in inputs once you press Edit, which keeps the
 * page calm to read instead of looking like a wall of form fields.
 */
const Field = ({ label, value, muted }) => (
  <div>
    <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>
      {label}
    </Text>
    <Text style={{ fontSize: 13.5, color: muted ? undefined : 'inherit' }} type={muted ? 'secondary' : undefined}>
      {value || '—'}
    </Text>
  </div>
);

/** Card with a title on the left and an Edit/Cancel toggle on the right. */
const SectionCard = ({ title, editing, onToggle, children, card, editable = true }) => {
  const { t } = useTranslation('common');
  return (
    <Card style={{ ...card, marginBottom: 24 }} styles={{ body: { padding: '22px 26px' } }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <Title level={5} style={{ margin: 0 }}>{title}</Title>
        {editable && (
          <Button size="small" icon={<EditOutlined />} onClick={onToggle}>
            {editing ? t('action.cancel') : t('action.edit')}
          </Button>
        )}
      </div>
      {children}
    </Card>
  );
};

const ProfilePage = () => {
  const { t } = useTranslation(['account', 'common']);
  const { user, token, updateUser } = useAuth();
  const { isDark } = useTheme();
  const { token: tok } = theme.useToken();
  const card = surfaceStyle(isDark);
  const BRAND = getBrand(isDark);

  const [editingProfile, setEditingProfile] = useState(false);
  const [editingBilling, setEditingBilling] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);
  const [billingInfo, setBillingInfo] = useState(getBillingInfo);

  const [pwdForm] = Form.useForm();
  const [profileForm] = Form.useForm();
  const [billingForm] = Form.useForm();
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState(null);
  const [newPwd, setNewPwd] = useState('');
  const [twoFactor, setTwoFactor] = useState(false);
  const strength = getStrength(newPwd);

  const trimmedName = user?.name?.trim();
  const hasDistinctName = !!trimmedName && trimmedName.toLowerCase() !== user?.email?.toLowerCase();
  const displayName = hasDistinctName ? trimmedName : (user?.email?.split('@')[0] || 'Account');
  const initials = displayName.slice(0, 2).toUpperCase();

  const saveProfile = async (values) => {
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const res = await fetch(`${config.apiUrl}/api/v1/auth/customer/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: values.name, phone: values.phone }),
      });
      const data = await res.json();
      if (data.success) {
        updateUser({ name: data.user.name, phone: data.user.phone });
        setProfileMsg({ type: 'success', text: t('account:profile.updated') });
        setEditingProfile(false);
      } else {
        setProfileMsg({ type: 'error', text: data.message || t('account:profile.updateFailed') });
      }
    } catch {
      setProfileMsg({ type: 'error', text: t('common:error.network') });
    } finally {
      setSavingProfile(false);
    }
  };

  const saveBilling = (values) => {
    setBillingInfo(saveBillingInfo(values));
    setEditingBilling(false);
    message.success(t('account:billing.saved'));
  };

  const changePassword = async (values) => {
    setPwdMsg(null);
    setChangingPwd(true);
    try {
      const res = await fetch(`${config.apiUrl}/api/v1/auth/customer/me/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setPwdMsg({ type: 'success', text: t('account:security.changed') });
        pwdForm.resetFields();
        setNewPwd('');
      } else {
        setPwdMsg({ type: 'error', text: data.message || t('account:security.changeFailed') });
      }
    } catch {
      setPwdMsg({ type: 'error', text: t('common:error.network') });
    } finally {
      setChangingPwd(false);
    }
  };

  const confirmDelete = () => {
    Modal.confirm({
      title: t('account:danger.deleteConfirmTitle'),
      icon: <WarningOutlined style={{ color: STATUS_COLORS.error.light }} />,
      content: t('account:danger.deleteConfirmBody'),
      okText: t('account:danger.deleteAccount'),
      okButtonProps: { danger: true },
      cancelText: t('account:danger.keepAccount'),
      onOk: () => message.info(t('account:danger.deleteNotReady')),
    });
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ marginBottom: 4 }}>{t('account:profile.title')}</Title>
        <Text type="secondary">{t('account:profile.subtitle')}</Text>
      </div>

      {/* ── Identity ── */}
      <Card style={{ ...card, marginBottom: 24 }} styles={{ body: { padding: '22px 26px' } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
            <Avatar size={68} style={{ background: GRADIENT, fontSize: 24, fontWeight: 700, flexShrink: 0 }}>
              {initials}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <Title level={4} style={{ margin: 0 }}>{displayName}</Title>
              <Text type="secondary" style={{ fontSize: 13 }}>{user?.email}</Text>
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Tag
                  color={user?.isEmailVerified ? 'success' : 'warning'}
                  icon={user?.isEmailVerified ? <CheckCircleOutlined /> : <MailOutlined />}
                >
                  {user?.isEmailVerified ? t('account:profile.verified') : t('account:profile.unverified')}
                </Tag>
                <Tag>
                  {t('account:profile.memberSince', {
                    date: user?.createdAt ? formatDate(user.createdAt, 'monthYear') : '—',
                  })}
                </Tag>
              </div>
            </div>
          </div>
          <Button icon={<EditOutlined />} onClick={() => setEditingProfile((v) => !v)}>
            {editingProfile ? t('common:action.cancel') : t('common:action.edit')}
          </Button>
        </div>
      </Card>

      {/* ── Personal information ── */}
      <Card style={{ ...card, marginBottom: 24 }} styles={{ body: { padding: '22px 26px' } }}>
        <Title level={5} style={{ marginTop: 0, marginBottom: 18 }}>{t('account:profile.personalInfo')}</Title>

        {profileMsg && (
          <Alert
            type={profileMsg.type} message={profileMsg.text} showIcon closable
            onClose={() => setProfileMsg(null)}
            style={{ marginBottom: 18, borderRadius: tok.borderRadius }}
          />
        )}

        {editingProfile ? (
          <Form
            form={profileForm} layout="vertical" onFinish={saveProfile} requiredMark={false}
            initialValues={{ name: trimmedName, phone: user?.phone || '' }}
          >
            <Row gutter={20}>
              <Col xs={24} md={12}>
                <Form.Item name="name" label={t('account:profile.fullName')} rules={[{ required: true, message: t('account:profile.nameRequired') }, { min: 2, message: t('account:profile.nameMinLength') }]}>
                  <Input prefix={<UserOutlined style={{ color: tok.colorTextQuaternary }} />} placeholder={t('account:profile.fullNamePlaceholder')} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="phone" label={t('account:profile.phone')}>
                  <Input prefix={<PhoneOutlined style={{ color: tok.colorTextQuaternary }} />} placeholder="+1 555 000 0000" />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" htmlType="submit" loading={savingProfile}>{t('account:profile.saveChanges')}</Button>
          </Form>
        ) : (
          <Row gutter={[20, 18]}>
            <Col xs={24} sm={12} md={8}><Field label={t('account:profile.fullName')} value={hasDistinctName ? trimmedName : null} /></Col>
            <Col xs={24} sm={12} md={8}><Field label={t('account:profile.emailAddress')} value={user?.email} /></Col>
            <Col xs={24} sm={12} md={8}><Field label={t('account:profile.phone')} value={user?.phone} /></Col>
          </Row>
        )}
      </Card>

      {/* ── Billing details — printed on every invoice ── */}
      <SectionCard
        title={t('account:billing.title')}
        editing={editingBilling}
        onToggle={() => setEditingBilling((v) => !v)}
        card={card}
      >
        <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 18 }}>
          <EnvironmentOutlined style={{ marginInlineEnd: 6 }} />
          {t('account:billing.note')}
        </Text>

        {editingBilling ? (
          <Form form={billingForm} layout="vertical" onFinish={saveBilling} requiredMark={false} initialValues={billingInfo}>
            <Row gutter={20}>
              <Col xs={24} md={12}><Form.Item name="name" label={t('account:billing.billedTo')}><Input placeholder={t('account:profile.fullName')} /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="company" label={t('account:billing.companyOptional')}><Input placeholder={t('account:billing.companyPlaceholder')} /></Form.Item></Col>
              <Col xs={24}><Form.Item name="street" label={t('account:billing.streetAddress')}><Input placeholder={t('account:billing.streetPlaceholder')} /></Form.Item></Col>
              <Col xs={24} md={8}><Form.Item name="city" label={t('account:billing.cityState')}><Input placeholder={t('account:billing.cityStatePlaceholder')} /></Form.Item></Col>
              <Col xs={24} md={8}><Form.Item name="postalCode" label={t('account:billing.postalCode')}><Input placeholder={t('account:billing.postalCode')} /></Form.Item></Col>
              <Col xs={24} md={8}><Form.Item name="country" label={t('account:billing.country')}><Input placeholder={t('account:billing.country')} /></Form.Item></Col>
              <Col xs={24} md={12}><Form.Item name="vatId" label={t('account:billing.taxId')}><Input placeholder={t('account:billing.taxIdPlaceholder')} /></Form.Item></Col>
            </Row>
            <Button type="primary" htmlType="submit">{t('account:billing.save')}</Button>
          </Form>
        ) : (
          <Row gutter={[20, 18]}>
            <Col xs={24} sm={12} md={8}><Field label={t('account:billing.billedTo')} value={billingInfo.name} /></Col>
            <Col xs={24} sm={12} md={8}><Field label={t('account:billing.company')} value={billingInfo.company} /></Col>
            <Col xs={24} sm={12} md={8}><Field label={t('account:billing.street')} value={billingInfo.street} /></Col>
            <Col xs={24} sm={12} md={8}><Field label={t('account:billing.cityState')} value={billingInfo.city} /></Col>
            <Col xs={24} sm={12} md={8}><Field label={t('account:billing.postalCode')} value={billingInfo.postalCode} /></Col>
            <Col xs={24} sm={12} md={8}><Field label={t('account:billing.country')} value={billingInfo.country} /></Col>
            <Col xs={24} sm={12} md={8}><Field label={t('account:billing.taxId')} value={billingInfo.vatId} /></Col>
          </Row>
        )}
      </SectionCard>

      {/* ── Security ── */}
      <Card style={{ ...card, marginBottom: 24 }} styles={{ body: { padding: '22px 26px' } }}>
        <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>
          <SafetyOutlined style={{ color: BRAND, marginInlineEnd: 8 }} />
          {t('account:security.title')}
        </Title>
        <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 20 }}>
          {t('account:security.passwordHint')}
        </Text>

        {pwdMsg && (
          <Alert
            type={pwdMsg.type} message={pwdMsg.text} showIcon closable
            onClose={() => setPwdMsg(null)}
            style={{ marginBottom: 18, borderRadius: tok.borderRadius }}
          />
        )}

        <Form form={pwdForm} layout="vertical" onFinish={changePassword} requiredMark={false}>
          <Row gutter={20}>
            <Col xs={24} md={8}>
              <Form.Item name="currentPassword" label={t('account:security.currentPassword')} rules={[{ required: true, message: t('account:security.required') }]}>
                <Password prefix={<LockOutlined style={{ color: tok.colorTextQuaternary }} />} placeholder="••••••••" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="newPassword" label={t('account:security.newPassword')} rules={[{ required: true, message: t('account:security.required') }, { min: 8, message: t('account:security.minEight') }]}>
                <Password
                  prefix={<LockOutlined style={{ color: tok.colorTextQuaternary }} />}
                  placeholder="••••••••"
                  onChange={(e) => setNewPwd(e.target.value)}
                />
              </Form.Item>
              {newPwd && (
                <div style={{ marginTop: -18, marginBottom: 14 }}>
                  <Progress percent={strength.pct} showInfo={false} strokeColor={strength.color} size="small" />
                  <Text style={{ fontSize: 12, color: strength.color }}>{t('account:security.strengthLabel', { strength: t(strength.labelKey) })}</Text>
                </div>
              )}
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="confirmPassword" label={t('account:security.confirmNewPassword')} dependencies={['newPassword']}
                rules={[
                  { required: true, message: t('account:security.required') },
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      !value || getFieldValue('newPassword') === value
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('account:security.mismatch'))),
                  }),
                ]}
              >
                <Password prefix={<LockOutlined style={{ color: tok.colorTextQuaternary }} />} placeholder="••••••••" />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" htmlType="submit" loading={changingPwd} icon={<LockOutlined />}>
            {t('account:security.changePassword')}
          </Button>
        </Form>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
          marginTop: 24, paddingTop: 20, borderTop: `1px solid ${tok.colorBorderSecondary}`,
        }}>
          <div>
            <Text strong style={{ display: 'block' }}>{t('account:security.twoFactor')}</Text>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {t('account:security.twoFactorBody')}
            </Text>
          </div>
          <Switch
            checked={twoFactor}
            onChange={(v) => {
              setTwoFactor(v);
              message.info(t('account:security.twoFactorNotReady'));
              setTwoFactor(false);
            }}
          />
        </div>
      </Card>

      {/* ── Danger zone ── */}
      <Card
        style={{ ...card, marginBottom: 24, borderColor: STATUS_COLORS.error.bg(isDark) }}
        styles={{ body: { padding: '22px 26px' } }}
      >
        <Title level={5} style={{ marginTop: 0, marginBottom: 18, color: STATUS_COLORS.error.light }}>
          <WarningOutlined style={{ marginInlineEnd: 8 }} />
          {t('account:danger.title')}
        </Title>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Text strong style={{ display: 'block' }}>{t('account:danger.signOutEverywhere')}</Text>
            <Text type="secondary" style={{ fontSize: 12.5 }}>{t('account:danger.signOutEverywhereBody')}</Text>
          </div>
          <Button
            icon={<LogoutOutlined />}
            onClick={() => message.info(t('account:danger.signOutNotReady'))}
          >
            {t('account:danger.signOutAllDevices')}
          </Button>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
          marginTop: 18, paddingTop: 18, borderTop: `1px solid ${tok.colorBorderSecondary}`, flexWrap: 'wrap',
        }}>
          <div>
            <Text strong style={{ display: 'block' }}>{t('account:danger.deleteAccount')}</Text>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {t('account:danger.deleteAccountBody')}
            </Text>
          </div>
          <Button danger icon={<DeleteOutlined />} onClick={confirmDelete}>{t('account:danger.deleteAccount')}</Button>
        </div>
      </Card>
    </div>
  );
};

export default ProfilePage;
