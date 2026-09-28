import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Button, Space, Spin, Tag, Typography, theme,
} from 'antd';
import { useTranslation } from 'react-i18next';
import AuthShell from '../../components/AuthShell';
import { useAuth } from '../../context/AuthContext';
import teamsApi from '../../api/teamsApi';
import { rememberInvite } from '../../auth/safeNext';
import { teamErrorText } from './TeamOnboardingPage';
import { setActiveTeamId } from '../../auth/activeTeam';
import { useTeam } from '../../context/TeamContext';

const { Text } = Typography;

/**
 * The page an invitation email links to. Works signed in or out:
 *   - signed out: shows the invitation and sends them to sign in or create an
 *     account for the invited address, coming back here afterwards;
 *   - signed in as the invited address: accept or decline;
 *   - signed in as someone else: says so, instead of failing on click.
 * The server makes every one of these decisions again — this page only
 * avoids offering a button that would be refused.
 */
const InvitePage = () => {
  const { t } = useTranslation(['teams', 'common']);
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, token: session, logout } = useAuth();
  const { reload: reloadTeams } = useTeam();
  const { token: tok } = theme.useToken();

  const [inv, setInv] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    teamsApi.previewInvitation(token)
      .then((data) => setInv(data.invitation))
      .catch(() => setLoadError(true));
  }, [token]);

  const here = `/invite/${token}`;

  const goSignIn = (path) => {
    rememberInvite(here);
    navigate(`${path}?next=${encodeURIComponent(here)}&email=${encodeURIComponent(inv.email)}`);
  };

  const accept = async () => {
    setError(''); setBusy('accept');
    try {
      const data = await teamsApi.acceptInvitation(token);
      setActiveTeamId(data.team.id);
      reloadTeams();
      setDone({ kind: 'accepted', team: data.team.name });
    } catch (err) {
      setError(teamErrorText(t, err));
    } finally { setBusy(null); }
  };

  const decline = async () => {
    setError(''); setBusy('decline');
    try {
      await teamsApi.declineInvitation(token);
      setDone({ kind: 'declined' });
    } catch (err) {
      setError(teamErrorText(t, err));
    } finally { setBusy(null); }
  };

  if (loadError) {
    return (
      <AuthShell title={t('invite.invalidTitle')} subtitle={t('invite.invalidBody')}>
        <Button type="primary" block onClick={() => navigate(session ? '/dashboard' : '/login')}>{t('invite.goHome')}</Button>
      </AuthShell>
    );
  }
  if (!inv) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  if (done) {
    return (
      <AuthShell title={done.kind === 'accepted' ? t('invite.accepted', { team: done.team }) : t('invite.declined')}>
        <Button type="primary" block onClick={() => navigate('/dashboard', { replace: true })}>{t('invite.goHome')}</Button>
      </AuthShell>
    );
  }

  if (inv.status !== 'OPEN') {
    return (
      <AuthShell title={t('invite.closedTitle')} subtitle={t(`invite.closed.${inv.status}`)}>
        <Button type="primary" block onClick={() => navigate(session ? '/dashboard' : '/login')}>{t('invite.goHome')}</Button>
      </AuthShell>
    );
  }

  const signedInAs = user?.email?.toLowerCase();
  const mismatch = session && signedInAs && signedInAs !== inv.email;

  return (
    <AuthShell
      title={t('invite.title', { team: inv.teamName })}
      subtitle={inv.invitedBy
        ? t('invite.invitedBy', { inviter: inv.invitedBy, team: inv.teamName })
        : t('invite.invitedNoName', { team: inv.teamName })}
    >
      <div style={{
        border: `1px solid ${tok.colorBorderSecondary}`, borderRadius: tok.borderRadiusLG,
        padding: 16, marginBottom: 20,
      }}>
        <Space direction="vertical" size={6}>
          <Text type="secondary">{t('invite.role')}</Text>
          <Space size={8}>
            <Tag color="blue" style={{ fontSize: 13, padding: '2px 10px' }}>{t(`roles.${inv.role}`)}</Tag>
            <Text type="secondary" style={{ fontSize: 12.5 }}>{t(`roleHints.${inv.role}`, { defaultValue: '' })}</Text>
          </Space>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{t('invite.forEmail', { email: inv.email })}</Text>
        </Space>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16, borderRadius: tok.borderRadius }} />}

      {!session && (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {inv.accountExists ? (
            <Button type="primary" block size="large" onClick={() => goSignIn('/login')}>{t('invite.signIn')}</Button>
          ) : (
            <Button type="primary" block size="large" onClick={() => goSignIn('/signup')}>{t('invite.createAccount')}</Button>
          )}
        </Space>
      )}

      {mismatch && (
        <>
          <Alert
            type="warning"
            showIcon
            message={t('invite.mismatchTitle')}
            description={t('invite.mismatchBody', { current: user.email, email: inv.email })}
            style={{ marginBottom: 16, borderRadius: tok.borderRadius }}
          />
          <Button block size="large" onClick={() => { rememberInvite(here); logout(); navigate(`/login?next=${encodeURIComponent(here)}&email=${encodeURIComponent(inv.email)}`); }}>
            {t('invite.signOut')}
          </Button>
        </>
      )}

      {session && !mismatch && (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Button type="primary" block size="large" loading={busy === 'accept'} disabled={!!busy} onClick={accept}>
            {t('invite.accept')}
          </Button>
          <Button block size="large" loading={busy === 'decline'} disabled={!!busy} onClick={decline}>
            {t('invite.decline')}
          </Button>
        </Space>
      )}
    </AuthShell>
  );
};

export default InvitePage;
