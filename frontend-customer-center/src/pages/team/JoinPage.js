import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Button, Typography, Space, Spin, Result, Tag, message,
} from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTeam } from '../../context/TeamContext';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle } from '../../theme/colors';
import teamsApi from '../../api/teamsApi';
import { rememberInvite } from '../../auth/safeNext';
import { teamErrorText } from './TeamOnboardingPage';

const { Title, Text, Paragraph } = Typography;

/**
 * Where a join link lands.
 *
 * Signed out, it shows only what a stranger may see: the organization's name,
 * how many people are in it, and the role on offer. Signing in is required
 * before anything can be asked for, and asking is all that happens — the page
 * says so plainly, because somebody who clicks "join" and then sees nothing
 * change would reasonably think it had failed.
 */
const JoinPage = () => {
  const { token } = useParams();
  const { t } = useTranslation(['teams', 'common']);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { reload } = useTeam();
  const { isDark } = useTheme();

  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPreview(await teamsApi.previewJoinLink(token));
      setError(null);
    } catch (err) {
      setError(teamErrorText(t, err));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => { load(); }, [load]);

  const signIn = () => {
    // Come straight back here once they are signed in.
    rememberInvite(`/join/${token}`);
    navigate(`/login?next=${encodeURIComponent(`/join/${token}`)}`);
  };

  const ask = async () => {
    setSending(true);
    try {
      const out = await teamsApi.useJoinLink(token);
      setDone(out);
      reload();
    } catch (err) {
      message.error(teamErrorText(t, err));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  if (error) {
    return (
      <Result
        status="404"
        title={t('joinPage.invalidTitle')}
        subTitle={error}
        extra={<Button type="primary" onClick={() => navigate('/dashboard')}>{t('invite.goHome')}</Button>}
      />
    );
  }

  if (done) {
    return (
      <Result
        status="success"
        title={done.joined ? t('joinPage.joinedTitle', { team: preview.teamName }) : t('joinPage.askedTitle')}
        subTitle={done.joined ? t('joinPage.joinedBody') : t('joinPage.askedBody', { team: preview.teamName })}
        extra={<Button type="primary" onClick={() => navigate('/dashboard')}>{t('invite.goHome')}</Button>}
      />
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '48px auto' }}>
      <Card style={cardStyle(isDark)}>
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>
            <TeamOutlined /> {t('joinPage.title', { team: preview.teamName })}
          </Title>
          <Space wrap>
            <Tag>{t('joinPage.members', { count: preview.memberCount })}</Tag>
            <Tag color="blue">{t(`roles.${preview.role}`)}</Tag>
          </Space>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t('joinPage.whatHappens')}
          </Paragraph>

          {user ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {t('joinPage.asYou', { email: user.email })}
              </Text>
              <Button type="primary" loading={sending} onClick={ask}>{t('joinPage.ask')}</Button>
            </Space>
          ) : (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Button type="primary" onClick={signIn}>{t('joinPage.signIn')}</Button>
              <Text type="secondary" style={{ fontSize: 12.5 }}>{t('joinPage.signUpHint')}</Text>
            </Space>
          )}
        </Space>
      </Card>
    </div>
  );
};

export default JoinPage;
