import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, List, Avatar, Button, Typography, Empty, message,
} from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle } from '../../theme/colors';
import teamsApi from '../../api/teamsApi';
import { formatDate } from '../../utils/format';
import { teamErrorText } from './TeamOnboardingPage';

const { Text } = Typography;

/**
 * What has happened in this organization — who invited whom, who changed a
 * role or a limit, who joined or left, who handed the team over.
 *
 * The server sends an `action` key plus the values it needs, never a finished
 * sentence, so every entry reads in the language the viewer is using. An
 * action this build has no wording for falls back to a plain description
 * rather than printing a key at someone.
 */
const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase();

const TeamActivityCard = () => {
  const { t } = useTranslation(['teams', 'common']);
  const { isDark } = useTheme();
  const [entries, setEntries] = useState([]);
  const [before, setBefore] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cursor = null) => {
    setLoading(true);
    try {
      const data = await teamsApi.activity(cursor ? { before: cursor } : {});
      setEntries((prev) => (cursor ? [...prev, ...(data.activity || [])] : (data.activity || [])));
      setBefore(data.nextBefore || null);
    } catch (err) {
      message.error(teamErrorText(t, err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const sentence = (e) => {
    // i18next reads a dot as nesting, so `member.joined` becomes
    // `member_joined` on the way to the translation file.
    const key = `activity.${String(e.action).replace(/\./g, '_')}`;
    const text = t(key, {
      actor: e.actor?.name || e.actor?.email,
      target: e.targetName || '',
      role: e.metadata?.role ? t(`roles.${e.metadata.role}`) : '',
      from: e.metadata?.from ? t(`roles.${e.metadata.from}`) : '',
      to: e.metadata?.to ? t(`roles.${e.metadata.to}`) : '',
      limit: e.metadata?.limit ?? '',
      defaultValue: '',
    });
    return text || t('activity.unknown', { actor: e.actor?.name || e.actor?.email });
  };

  return (
    <Card
      style={{ ...cardStyle(isDark), marginBottom: 20 }}
      title={<span><HistoryOutlined /> {t('activity.title')}</span>}
      extra={<Text type="secondary" style={{ fontSize: 12.5 }}>{t('activity.subtitle')}</Text>}
    >
      <List
        loading={loading && entries.length === 0}
        dataSource={entries}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('activity.empty')} /> }}
        renderItem={(e) => (
          <List.Item key={e.id}>
            <List.Item.Meta
              avatar={<Avatar src={e.actor?.avatar || undefined} size="small">{initials(e.actor?.name)}</Avatar>}
              title={<Text style={{ fontWeight: 400 }}>{sentence(e)}</Text>}
              description={<Text type="secondary" style={{ fontSize: 12 }}>{formatDate(e.createdAt, 'dateTime')}</Text>}
            />
          </List.Item>
        )}
      />
      {before && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button size="small" loading={loading} onClick={() => load(before)}>{t('activity.loadMore')}</Button>
        </div>
      )}
    </Card>
  );
};

export default TeamActivityCard;
