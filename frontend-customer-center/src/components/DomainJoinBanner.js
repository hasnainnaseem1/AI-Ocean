import React, { useEffect, useState } from 'react';
import { Alert, Button, Space, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTeam } from '../context/TeamContext';
import teamsApi from '../api/teamsApi';

/**
 * "Somebody at your company is already here."
 *
 * Shown to a customer whose own verified address is at the same domain as an
 * organization whose owner chose to be findable that way. Nobody can ask about
 * a domain that is not their own, and nothing appears unless that organization
 * opted in — so this can never be used to discover which companies are
 * customers here.
 *
 * One button, and it asks. What comes back is a line saying somebody has to
 * approve it, because a request that looks like a join and then does nothing
 * would read as a failure.
 *
 * The enterprise path (a DNS-verified company domain, off unless the platform
 * turns it on) surfaces through the same banner, including the case where it
 * has already taken the person in automatically.
 */
const DomainJoinBanner = () => {
  const { t } = useTranslation(['teams', 'common']);
  const { reload } = useTeam();
  const [hints, setHints] = useState([]);
  const [joined, setJoined] = useState([]);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      teamsApi.companyHint().catch(() => ({ organizations: [] })),
      teamsApi.myJoinRequests().catch(() => ({ requests: [] })),
      // The enterprise domain feature; usually off, and then this is empty.
      teamsApi.discover().catch(() => ({ joined: [], canRequest: [] })),
    ]).then(([hint, mine, discovered]) => {
      if (!live) return;
      setHints([...(hint.organizations || []), ...(discovered.canRequest || []).map((d) => ({
        teamId: d.teamId, name: d.name, domain: d.domain, requested: d.requested,
      }))]);
      setPending(mine.requests || []);
      setJoined(discovered.joined || []);
      if ((discovered.joined || []).length) reload();
    }).catch(() => { /* teams may be off entirely */ });
    return () => { live = false; };
    // Once per mount: this is a greeting, not a live feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async (teamId) => {
    setBusy(teamId);
    try {
      await teamsApi.requestCompanyJoin(teamId);
      message.success(t('discover.asked'));
      setHints((prev) => prev.map((h) => (h.teamId === teamId ? { ...h, requested: true } : h)));
    } catch {
      message.error(t('errors.generic'));
    } finally {
      setBusy(null);
    }
  };

  if (dismissed) return null;
  const waiting = pending.filter((p) => !hints.some((h) => h.teamId === p.teamId));
  if (!hints.length && !joined.length && !waiting.length) return null;

  return (
    <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 16 }}>
      {joined.map((team) => (
        <Alert
          key={team.id}
          type="success"
          showIcon
          closable
          onClose={() => setDismissed(true)}
          message={t('discover.joinedTitle', { team: team.name })}
          description={t('discover.joinedBody', { role: t(`roles.${team.role}`) })}
        />
      ))}

      {waiting.map((r) => (
        <Alert
          key={r.id}
          type="info"
          showIcon
          closable
          onClose={() => setDismissed(true)}
          message={t('discover.waitingTitle', { team: r.teamName })}
          description={t('discover.waiting')}
        />
      ))}

      {hints.map((team) => (
        <Alert
          key={team.teamId}
          type="info"
          showIcon
          closable
          onClose={() => setDismissed(true)}
          message={t('discover.foundTitle', { team: team.name, domain: team.domain })}
          description={(
            <Space direction="vertical" size={8}>
              <span>
                {team.requested ? t('discover.waiting') : t('discover.foundBody')}
                {team.ownerHint && !team.requested ? ` ${t('discover.createdBy', { owner: team.ownerHint })}` : ''}
              </span>
              {!team.requested && (
                <Button type="primary" size="small" loading={busy === team.teamId} onClick={() => ask(team.teamId)}>
                  {t('discover.ask')}
                </Button>
              )}
            </Space>
          )}
        />
      ))}
    </Space>
  );
};

export default DomainJoinBanner;
