import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Button, Space, Typography, Select, InputNumber, Alert, List, Avatar, Popconfirm, Switch, message,
} from 'antd';
import { LinkOutlined, CopyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle } from '../../theme/colors';
import teamsApi from '../../api/teamsApi';
import { formatDate } from '../../utils/format';
import { teamErrorText } from './TeamOnboardingPage';

const { Text } = Typography;

const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase();

/**
 * The join link, and the people waiting on an answer.
 *
 * The one thing this screen keeps saying, because it is the whole reason the
 * link is safe to paste into a company chat: opening it does not put anybody
 * in the organization. It puts them in the list below, and somebody here
 * decides. A link that is forwarded, screenshotted or left behind by someone
 * who has moved on gets that person a refusal, not an account that spends
 * money.
 *
 * The link itself is shown once, when it is made. After that only its shape is
 * known — the server keeps a hash, not the link.
 */
const JoinLinkCard = ({ discoverable, onDiscoverabilityChange }) => {
  const { t } = useTranslation(['teams', 'common']);
  const { isDark } = useTheme();

  const [state, setState] = useState(null);
  const [requests, setRequests] = useState([]);
  const [fresh, setFresh] = useState('');
  const [role, setRole] = useState('developer');
  const [days, setDays] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [link, pending] = await Promise.all([
        teamsApi.joinLink(),
        teamsApi.joinRequests().catch(() => ({ requests: [] })),
      ]);
      setState(link.enabled ? link : null);
      if (link.enabled && days === null) setDays(link.defaultExpiryDays);
      setRequests(pending.requests || []);
    } catch {
      // Not allowed to see it, or join links are off for this platform.
      setState(null);
    }
    // `days` is seeded once from the platform default and then owned by the
    // person editing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      const out = await fn();
      if (okText) message.success(okText);
      await load();
      return out;
    } catch (err) {
      message.error(teamErrorText(t, err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    const out = await run(() => teamsApi.issueJoinLink({ role, expiryDays: days }), t('joinLink.created'));
    if (out?.link?.url) setFresh(out.link.url);
  };

  const copy = (value) => {
    navigator.clipboard?.writeText(value);
    message.success(t('settings.copied'));
  };

  if (!state) return null;
  const { link } = state;

  return (
    <Card style={{ ...cardStyle(isDark), marginBottom: 20 }} title={<span><LinkOutlined /> {t('joinLink.title')}</span>}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>{t('joinLink.hint')}</Text>

        {fresh && (
          <Alert
            type="success"
            showIcon
            message={t('joinLink.copyNow')}
            description={(
              <Space wrap>
                <Text code style={{ wordBreak: 'break-all' }}>{fresh}</Text>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copy(fresh)}>{t('settings.copy')}</Button>
              </Space>
            )}
          />
        )}

        {link ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Text style={{ fontSize: 13 }}>
              {t('joinLink.live', {
                role: t(`roles.${link.role}`),
                date: formatDate(link.expiresAt, 'dateTime'),
              })}
            </Text>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {t('joinLink.usedCount', { count: link.usedCount })}
            </Text>
            <Space wrap>
              <Button loading={busy} onClick={issue}>{t('joinLink.reissue')}</Button>
              <Popconfirm
                title={t('joinLink.revokeConfirm')}
                description={t('joinLink.revokeHint')}
                okText={t('joinLink.revoke')}
                okButtonProps={{ danger: true }}
                onConfirm={() => run(() => teamsApi.revokeJoinLink(), t('joinLink.revoked'))}
              >
                <Button danger loading={busy}>{t('joinLink.revoke')}</Button>
              </Popconfirm>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('joinLink.reissueHint')}</Text>
          </Space>
        ) : (
          <Space wrap>
            <Select
              value={role}
              style={{ width: 170 }}
              onChange={setRole}
              options={[
                { value: 'developer', label: t('roles.developer') },
                { value: 'viewer', label: t('roles.viewer') },
              ]}
            />
            <InputNumber
              min={1}
              max={state.maxExpiryDays}
              value={days}
              onChange={setDays}
              addonAfter={t('joinLink.days')}
              style={{ width: 150 }}
            />
            <Button type="primary" loading={busy} onClick={issue}>{t('joinLink.create')}</Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('joinLink.maxDays', { count: state.maxExpiryDays })}
            </Text>
          </Space>
        )}

        <div>
          <Text strong style={{ fontSize: 13 }}>{t('joinLink.requestsTitle', { count: requests.length })}</Text>
          <List
            size="small"
            dataSource={requests}
            locale={{ emptyText: t('joinLink.noRequests') }}
            renderItem={(r) => (
              <List.Item
                key={r.id}
                actions={[
                  <Button
                    key="approve"
                    type="primary"
                    size="small"
                    loading={busy}
                    onClick={() => run(() => teamsApi.approveJoinRequest(r.id), t('joinLink.approved', { name: r.name }))}
                  >
                    {t('joinLink.approve')}
                  </Button>,
                  <Button
                    key="decline"
                    size="small"
                    loading={busy}
                    onClick={() => run(() => teamsApi.declineJoinRequest(r.id), t('joinLink.declined'))}
                  >
                    {t('joinLink.decline')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<Avatar src={r.avatar || undefined} size="small">{initials(r.name)}</Avatar>}
                  title={<Text>{r.name}</Text>}
                  description={(
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {r.email} · {t(`joinLink.via_${r.via}`)}
                    </Text>
                  )}
                />
              </List.Item>
            )}
          />
        </div>

        {onDiscoverabilityChange && (
          <Space align="start">
            <Switch
              checked={!!discoverable}
              onChange={(on) => onDiscoverabilityChange(on)}
              disabled={busy}
            />
            <div>
              <Text style={{ fontSize: 13 }}>{t('joinLink.discoverable')}</Text>
              <div><Text type="secondary" style={{ fontSize: 12.5 }}>{t('joinLink.discoverableHint')}</Text></div>
            </div>
          </Space>
        )}
      </Space>
    </Card>
  );
};

export default JoinLinkCard;
