import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form, Input, Button, Alert, Select, Space, Typography, theme,
} from 'antd';
import { PlusOutlined, DeleteOutlined, TeamOutlined, MailOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import AuthShell from '../../components/AuthShell';
import { useAuth } from '../../context/AuthContext';
import teamsApi from '../../api/teamsApi';
import { setActiveTeamId } from '../../auth/activeTeam';
import { useTeam } from '../../context/TeamContext';

const { Text } = Typography;

/** Roles a new member can be invited as — never Owner (the server refuses it too). */
const INVITE_ROLES = ['admin', 'billing', 'developer', 'viewer'];

/** A server refusal in the reader's language, keyed by its code. */
export const teamErrorText = (t, err) => {
  const code = err?.response?.data?.code;
  return code && t(`teams:errors.${code}`, { defaultValue: '' })
    ? t(`teams:errors.${code}`)
    : (err?.response?.data?.message || t('teams:errors.generic'));
};

/**
 * Two short steps for someone who chose "my team or company" at signup, or
 * picked "Create organization" later: name the organization, then invite
 * people. Both can be skipped — an organization with no one invited yet is
 * fine, and "I'll do this later" leaves the customer with their personal
 * account exactly as an individual signup would.
 */
const TeamOnboardingPage = () => {
  const { t } = useTranslation(['teams', 'common']);
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const { reload: reloadTeams } = useTeam();
  const { token: tok } = theme.useToken();

  const [team, setTeam] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([{ email: '', role: 'developer' }]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const leave = async () => {
    // Skipping (or finishing) turns the onboarding off for good.
    if (user?.teamOnboardingPending) {
      try {
        const data = await teamsApi.finishOnboarding();
        if (data.user) updateUser(data.user);
      } catch { /* not worth blocking the way out */ }
    }
    navigate('/dashboard', { replace: true });
  };

  const create = async ({ name }) => {
    setError('');
    setCreating(true);
    try {
      const data = await teamsApi.create(name);
      setTeam(data.team);
      // The app opens in the new organization from now on.
      setActiveTeamId(data.team.id);
      // The switcher's list must learn about the new account, or it would
      // treat the stored id as unknown and fall back to personal.
      reloadTeams();
      // The server clears the onboarding flag when a team is created.
      if (user?.teamOnboardingPending) updateUser({ ...user, teamOnboardingPending: false });
    } catch (err) {
      setError(teamErrorText(t, err));
    } finally {
      setCreating(false);
    }
  };

  const send = async () => {
    const wanted = rows.filter((r) => r.email.trim());
    if (!wanted.length) { navigate('/dashboard', { replace: true }); return; }
    setSending(true);
    const failed = [];
    let sent = 0;
    for (const row of wanted) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await teamsApi.invite(team.id, row.email.trim(), row.role);
        sent += 1;
      } catch (err) {
        failed.push(`${row.email.trim()} — ${teamErrorText(t, err)}`);
      }
    }
    setSending(false);
    setResult({ sent, failed });
    if (!failed.length) setRows([{ email: '', role: 'developer' }]);
  };

  const setRow = (i, patch) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (!team) {
    return (
      <AuthShell maxWidth={480} title={t('onboarding.createTitle')} subtitle={t('onboarding.createSubtitle')}>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 20, borderRadius: tok.borderRadius }} />}
        <Form layout="vertical" size="large" requiredMark={false} onFinish={create}>
          <Form.Item
            name="name"
            label={<Text strong>{t('onboarding.nameLabel')}</Text>}
            rules={[{ required: true, whitespace: true, message: t('onboarding.nameRequired') }, { min: 2, max: 60 }]}
          >
            <Input prefix={<TeamOutlined style={{ color: tok.colorTextTertiary }} />} placeholder={t('onboarding.namePlaceholder')} maxLength={60} autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={creating} style={{ height: 44, fontWeight: 600 }}>
            {t('onboarding.create')}
          </Button>
        </Form>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Button type="link" onClick={leave}>{t('onboarding.skip')}</Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell maxWidth={560} title={t('onboarding.inviteTitle')} subtitle={t('onboarding.inviteSubtitle', { team: team.name })}>
      <Alert type="success" showIcon message={t('onboarding.created', { team: team.name })} style={{ marginBottom: 20, borderRadius: tok.borderRadius }} />

      {result && result.sent > 0 && (
        <Alert type="success" showIcon message={t('onboarding.sent', { count: result.sent })} style={{ marginBottom: 12, borderRadius: tok.borderRadius }} />
      )}
      {result && result.failed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('onboarding.someFailed')}
          description={<ul style={{ margin: 0, paddingInlineStart: 18 }}>{result.failed.map((f) => <li key={f}>{f}</li>)}</ul>}
          style={{ marginBottom: 12, borderRadius: tok.borderRadius }}
        />
      )}

      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input
              size="large"
              type="email"
              prefix={<MailOutlined style={{ color: tok.colorTextTertiary }} />}
              placeholder={t('onboarding.emailPlaceholder')}
              value={row.email}
              onChange={(e) => setRow(i, { email: e.target.value })}
              style={{ flex: '1 1 220px', minWidth: 0 }}
            />
            <Select
              size="large"
              value={row.role}
              onChange={(role) => setRow(i, { role })}
              style={{ width: 150 }}
              optionLabelProp="label"
              popupMatchSelectWidth={260}
              options={INVITE_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
              optionRender={(opt) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{t(`roles.${opt.value}`)}</div>
                  <div style={{ fontSize: 12, color: tok.colorTextSecondary, whiteSpace: 'normal' }}>{t(`roleHints.${opt.value}`)}</div>
                </div>
              )}
            />
            {rows.length > 1 && (
              <Button size="large" icon={<DeleteOutlined />} onClick={() => setRows((l) => l.filter((_, j) => j !== i))} />
            )}
          </div>
        ))}
        <Button type="dashed" icon={<PlusOutlined />} block onClick={() => setRows((l) => [...l, { email: '', role: 'developer' }])}>
          {t('onboarding.addAnother')}
        </Button>
      </Space>

      <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 20 }}>
        <Button type="primary" block loading={sending} onClick={send} style={{ height: 44, fontWeight: 600 }}>
          {t('onboarding.sendInvites')}
        </Button>
        <Button block onClick={leave}>{t('onboarding.done')}</Button>
      </Space>
    </AuthShell>
  );
};

export default TeamOnboardingPage;
