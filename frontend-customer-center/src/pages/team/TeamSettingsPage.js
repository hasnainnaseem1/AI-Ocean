import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Table, Select, Button, Input, InputNumber, Space, Tag, Typography, Popconfirm, Alert, message, Tooltip,
  Empty, Popover, Progress,
} from 'antd';
import {
  TeamOutlined, MailOutlined, DeleteOutlined, LogoutOutlined, CopyOutlined, UserAddOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTeam } from '../../context/TeamContext';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle } from '../../theme/colors';
import teamsApi from '../../api/teamsApi';
import { formatDate } from '../../utils/format';
import { formatAmount } from '../../utils/money';
import { useBilling } from '../../context/SiteContext';
import { teamErrorText } from './TeamOnboardingPage';
import TeamActivityCard from './TeamActivityCard';
import OwnershipCard from './OwnershipCard';
import CloseTeamCard from './CloseTeamCard';
import DomainCard from './DomainCard';
import JoinLinkCard from './JoinLinkCard';

const { Title, Text } = Typography;

const RANK = { owner: 5, admin: 4, billing: 3, developer: 2, viewer: 1 };
const ASSIGNABLE = ['admin', 'billing', 'developer', 'viewer'];

/**
 * Mirrors the server's rule (services/team/membershipService.canManage): the
 * owner is never managed; an owner manages everyone else; an admin manages
 * only roles below admin. The server decides again on every change.
 */
const canManage = (myRole, target) => target.role !== 'owner'
  && (myRole === 'owner' || RANK[target.role] < RANK[myRole]);

/**
 * A Developer's monthly spend limit: what they have spent of the team's money
 * this month against it, and — for someone who may set limits — a way to
 * change or remove it. Limits apply to Developers only.
 */
const LimitCell = ({ member, editable, currency, onSave, t }) => {
  const [value, setValue] = useState(member.spendLimitMonthly);
  const [open, setOpen] = useState(false);
  if (member.role !== 'developer') return <Text type="secondary">—</Text>;

  const limit = member.spendLimitMonthly;
  const spent = member.monthSpend || 0;
  const pct = limit ? Math.min(100, Math.round((spent / limit) * 100)) : 0;

  const summary = limit === null || limit === undefined ? (
    <Text type="secondary">{t('limits.none', { spent: `${currency} ${formatAmount(spent)}` })}</Text>
  ) : (
    // The bare pair of numbers does not say what it counts, so the whole cell
    // carries the sentence behind it.
    <Tooltip title={t('limits.spentOf', {
      spent: `${currency} ${formatAmount(spent)}`,
      limit: `${currency} ${formatAmount(limit)}`,
    })}
    >
      <div style={{ minWidth: 150 }}>
        <Text style={{ fontSize: 12.5 }}>
          {currency} {formatAmount(spent)} / {formatAmount(limit)}
        </Text>
        <Progress
          percent={pct}
          size="small"
          showInfo={false}
          status={pct >= 100 ? 'exception' : 'normal'}
          strokeColor={pct >= 80 && pct < 100 ? '#D98A1F' : undefined}
        />
      </div>
    </Tooltip>
  );
  if (!editable) return summary;

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) setValue(member.spendLimitMonthly); }}
      title={t('limits.title', { name: member.name })}
      content={(
        <Space direction="vertical" size={10} style={{ width: 260 }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{t('limits.hint')}</Text>
          <InputNumber
            min={0}
            step={10}
            prefix={currency}
            value={value}
            onChange={setValue}
            placeholder={t('limits.placeholder')}
            style={{ width: '100%' }}
          />
          <Space>
            <Button type="primary" size="small" onClick={() => { onSave(value ?? null); setOpen(false); }}>{t('limits.save')}</Button>
            {limit !== null && limit !== undefined && (
              <Button size="small" onClick={() => { onSave(null); setOpen(false); }}>{t('limits.remove')}</Button>
            )}
          </Space>
        </Space>
      )}
    >
      <div style={{ cursor: 'pointer' }}>
        {summary}
        <div><Text type="link" style={{ fontSize: 12 }}>{t('limits.edit')}</Text></div>
      </div>
    </Popover>
  );
};

/**
 * A team's members and invitations. Only inside a team — a personal account
 * has no members — and the management controls only for Owner/Admin; every
 * member can see who else is in the team.
 */
const TeamSettingsPage = () => {
  const { t } = useTranslation(['teams', 'common']);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const {
    activeTeam, isPersonal, role, can, switchTeam, reload,
  } = useTeam();
  const manage = can('team.members');
  const [discoverable, setDiscoverable] = useState(false);
  const setLimits = can('team.limits');
  const { currency } = useBilling();

  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('developer');
  const [sending, setSending] = useState(false);
  const [lastLink, setLastLink] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, i] = await Promise.all([
        teamsApi.members(),
        manage ? teamsApi.invitations() : Promise.resolve({ invitations: [] }),
      ]);
      setMembers(m.members || []);
      setInvites(i.invitations || []);
    } catch (err) {
      message.error(teamErrorText(t, err));
    } finally {
      setLoading(false);
    }
  }, [manage, t]);

  useEffect(() => { if (!isPersonal) load(); }, [isPersonal, load]);
  useEffect(() => { setDiscoverable(!!activeTeam?.discoverableByDomain); }, [activeTeam?.discoverableByDomain]);

  if (isPersonal) {
    return (
      <Card style={cardStyle(isDark)}>
        <Empty description={t('settings.personalOnly')} />
      </Card>
    );
  }

  const act = async (fn, okText) => {
    try {
      await fn();
      if (okText) message.success(okText);
      load();
    } catch (err) {
      message.error(teamErrorText(t, err));
    }
  };

  /**
   * Invite one person, or a whole list pasted out of an email or a
   * spreadsheet — commas, spaces and line breaks all separate addresses.
   * Inviting a team is one action, not one action repeated.
   *
   * Each address is sent on its own so one bad one cannot lose the rest: the
   * ones that worked are invited, and the ones that did not are named with the
   * reason the server gave.
   */
  const invite = async () => {
    const addresses = email.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean);
    if (!addresses.length) return;

    setSending(true);
    const failures = [];
    let sent = 0;
    let lastUrl = '';
    for (const address of addresses) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await teamsApi.invite(null, address, inviteRole);
        lastUrl = data.inviteUrl || '';
        sent += 1;
      } catch (err) {
        failures.push(`${address} — ${teamErrorText(t, err)}`);
      }
    }
    setSending(false);

    // The copy-link shortcut only makes sense for a single invitation.
    setLastLink(addresses.length === 1 ? lastUrl : '');
    if (sent) {
      setEmail(failures.length ? failures.map((f) => f.split(' — ')[0]).join(', ') : '');
      message.success(addresses.length === 1 ? t('settings.inviteSent') : t('settings.invitesSent', { count: sent }));
    }
    failures.forEach((line) => message.error(line));
    load();
  };

  const leave = async () => {
    try {
      await teamsApi.leave();
      message.success(t('settings.left', { team: activeTeam.name }));
      switchTeam(null);
      reload();
      navigate('/dashboard');
    } catch (err) {
      message.error(teamErrorText(t, err));
    }
  };

  const assignableFor = (myRole) => ASSIGNABLE.filter((r) => RANK[r] <= RANK[myRole]);

  const memberColumns = [
    {
      title: t('settings.member'),
      key: 'member',
      render: (_, m) => (
        <div>
          <Text strong>{m.name}</Text>
          {String(m.userId) === String(user?.id) && <Tag style={{ marginInlineStart: 8 }}>{t('settings.you')}</Tag>}
          <div><Text type="secondary" style={{ fontSize: 12.5 }}>{m.email}</Text></div>
        </div>
      ),
    },
    {
      title: t('settings.role'),
      key: 'role',
      width: 200,
      render: (_, m) => (manage && canManage(role, m) && String(m.userId) !== String(user?.id) ? (
        <Select
          value={m.role}
          style={{ width: 170 }}
          options={assignableFor(role).map((r) => ({ value: r, label: t(`roles.${r}`) }))}
          onChange={(next) => act(() => teamsApi.changeRole(m.userId, next), t('settings.roleChanged'))}
        />
      ) : (
        <Tag color={m.role === 'owner' ? 'gold' : 'blue'}>{t(`roles.${m.role}`)}</Tag>
      )),
    },
    // Only for someone who may see the team's money — the server sends these
    // figures to no one else.
    ...(members.some((m) => 'monthSpend' in m) ? [{
      title: t('limits.column'),
      key: 'limit',
      width: 210,
      render: (_, m) => (
        <LimitCell
          member={m}
          currency={currency}
          t={t}
          editable={setLimits && canManage(role, m)}
          onSave={(limit) => act(() => teamsApi.setLimit(m.userId, limit), t('limits.saved'))}
        />
      ),
    }] : []),
    {
      title: t('settings.joined'),
      dataIndex: 'joinedAt',
      width: 150,
      render: (d) => formatDate(d, 'medium'),
    },
    {
      key: 'actions',
      width: 70,
      align: 'right',
      render: (_, m) => (manage && canManage(role, m) && String(m.userId) !== String(user?.id) ? (
        <Popconfirm
          title={t('settings.removeConfirm', { name: m.name })}
          description={t('settings.removeHint')}
          okText={t('settings.remove')}
          okButtonProps={{ danger: true }}
          onConfirm={() => act(() => teamsApi.removeMember(m.userId), t('settings.removed'))}
        >
          <Tooltip title={t('settings.remove')}><Button type="text" danger icon={<DeleteOutlined />} /></Tooltip>
        </Popconfirm>
      ) : null),
    },
  ];

  const inviteColumns = [
    { title: t('settings.email'), dataIndex: 'email', key: 'email' },
    { title: t('settings.role'), dataIndex: 'role', key: 'role', width: 140, render: (r) => <Tag>{t(`roles.${r}`)}</Tag> },
    { title: t('settings.expires'), dataIndex: 'expiresAt', key: 'expires', width: 150, render: (d) => formatDate(d, 'medium') },
    {
      key: 'actions',
      width: 110,
      align: 'right',
      render: (_, inv) => (
        <Button size="small" onClick={() => act(() => teamsApi.revokeInvitation(inv.id), t('settings.revoked'))}>
          {t('settings.revoke')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}><TeamOutlined /> {activeTeam?.name}</Title>
          <Text type="secondary">{t('settings.subtitle', { role: t(`roles.${role}`) })}</Text>
        </div>
        {role !== 'owner' && (
          <Popconfirm
            title={t('settings.leaveConfirm', { team: activeTeam?.name })}
            okText={t('settings.leave')}
            okButtonProps={{ danger: true }}
            onConfirm={leave}
          >
            <Button danger icon={<LogoutOutlined />}>{t('settings.leave')}</Button>
          </Popconfirm>
        )}
      </div>

      {manage && (
        <Card style={{ ...cardStyle(isDark), marginBottom: 20 }} title={<Space><UserAddOutlined />{t('settings.inviteTitle')}</Space>}>
          <Space.Compact style={{ width: '100%', maxWidth: 620 }}>
            <Input
              prefix={<MailOutlined />}
              placeholder={t('settings.invitePlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onPressEnter={invite}
            />
            <Select
              value={inviteRole}
              onChange={setInviteRole}
              style={{ width: 150 }}
              options={assignableFor(role).map((r) => ({ value: r, label: t(`roles.${r}`) }))}
            />
            <Button type="primary" loading={sending} onClick={invite}>{t('settings.send')}</Button>
          </Space.Compact>
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12.5 }}>{t(`roleHints.${inviteRole}`)}</Text>
          </div>
          {lastLink && (
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              message={t('settings.linkReady')}
              description={(
                <Space wrap>
                  <Text code copyable={false} style={{ wordBreak: 'break-all' }}>{lastLink}</Text>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard?.writeText(lastLink); message.success(t('settings.copied')); }}>
                    {t('settings.copy')}
                  </Button>
                </Space>
              )}
            />
          )}
        </Card>
      )}

      <Card style={{ ...cardStyle(isDark), marginBottom: 20 }} styles={{ body: { padding: 0 } }} title={t('settings.membersTitle', { count: members.length })}>
        <Table rowKey="userId" columns={memberColumns} dataSource={members} loading={loading} pagination={false} scroll={{ x: 640 }} />
      </Card>

      {/*
        A handover changes who holds which role, so the account context and
        this page's own lists are both re-read. Nobody is navigated away:
        offering, cancelling or declining leaves you where you were, and
        accepting leaves you in the team you now own.
      */}
      <OwnershipCard
        members={members}
        role={role}
        currentUserId={user?.id}
        onChanged={() => { reload(); load(); }}
      />

      {manage && (
        <Card style={{ ...cardStyle(isDark), marginBottom: 20 }} styles={{ body: { padding: 0 } }} title={t('settings.pendingTitle', { count: invites.length })}>
          <Table
            rowKey="id"
            columns={inviteColumns}
            dataSource={invites}
            loading={loading}
            pagination={false}
            scroll={{ x: 560 }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('settings.noPending')} /> }}
          />
        </Card>
      )}

      {manage && (
        <JoinLinkCard
          discoverable={discoverable}
          onDiscoverabilityChange={can('team.settings') ? async (on) => {
            try {
              await teamsApi.setDiscoverability(on);
              setDiscoverable(on);
              message.success(t('joinLink.discoverableSaved'));
            } catch (err) {
              message.error(teamErrorText(t, err));
            }
          } : null}
        />
      )}

      {can('team.settings') && <DomainCard />}

      {can('team.activity') && <TeamActivityCard />}

      {can('team.delete') && (
        <CloseTeamCard
          teamName={activeTeam?.name}
          currency={currency}
          onClosed={() => { switchTeam(null); reload(); navigate('/dashboard'); }}
        />
      )}
    </>
  );
};

export default TeamSettingsPage;
