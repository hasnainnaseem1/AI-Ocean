import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Select, Button, Space, Typography, Alert, Popconfirm, message,
} from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle } from '../../theme/colors';
import teamsApi from '../../api/teamsApi';
import { formatDate } from '../../utils/format';
import { teamErrorText } from './TeamOnboardingPage';

const { Text } = Typography;

/**
 * Handing the organization to somebody else.
 *
 * Two sides, one card. The owner offers it to a member and can take the offer
 * back; the member it was offered to sees the offer here and answers it. Until
 * they accept, nothing has changed — which is the point: owning the account
 * means answering for what it spends, and that is not something one person can
 * put on another.
 *
 * None of the money moves with it, and the card says so, because "transfer" is
 * exactly the word a customer might expect to move a balance.
 */
const OwnershipCard = ({
  members, role, currentUserId, onChanged,
}) => {
  const { t } = useTranslation(['teams', 'common']);
  const { isDark } = useTheme();
  const isOwner = role === 'owner';

  const [pending, setPending] = useState(null);
  const [incoming, setIncoming] = useState(null);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ pending: open }, { offers }] = await Promise.all([
        teamsApi.ownership(),
        teamsApi.myOffers(),
      ]);
      setPending(open || null);
      // The one that concerns this team, if the offer is for me.
      setIncoming((offers || []).find((o) => open && o.id === open.id) || null);
    } catch {
      // A team whose ownership cannot be read is still a usable team; the
      // section simply stays empty rather than breaking the page.
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      message.success(okText);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      message.error(teamErrorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  // Anyone but the owner and anyone whose account is not usable; the server
  // checks again and refuses for reasons the UI cannot see (an unpaid balance
  // on an account of theirs, for one).
  const candidates = (members || [])
    .filter((m) => m.role !== 'owner' && String(m.userId) !== String(currentUserId))
    .map((m) => ({ value: m.userId, label: `${m.name} · ${t(`roles.${m.role}`)}` }));

  if (incoming) {
    return (
      <Card style={{ ...cardStyle(isDark), marginBottom: 20 }} title={<span><SwapOutlined /> {t('ownership.title')}</span>}>
        <Alert
          type="info"
          showIcon
          message={t('ownership.offeredToYou', { from: incoming.from?.name || incoming.from?.email })}
          description={(
            <Space direction="vertical" size={10}>
              <Text>{t('ownership.whatItMeans')}</Text>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {t('ownership.expires', { date: formatDate(incoming.expiresAt, 'dateTime') })}
              </Text>
              <Space>
                <Button
                  type="primary"
                  loading={busy}
                  onClick={() => run(() => teamsApi.acceptOwnership(incoming.id), t('ownership.accepted'))}
                >
                  {t('ownership.accept')}
                </Button>
                <Button
                  loading={busy}
                  onClick={() => run(() => teamsApi.declineOwnership(incoming.id), t('ownership.declined'))}
                >
                  {t('ownership.decline')}
                </Button>
              </Space>
            </Space>
          )}
        />
      </Card>
    );
  }

  if (!isOwner) return null;

  return (
    <Card style={{ ...cardStyle(isDark), marginBottom: 20 }} title={<span><SwapOutlined /> {t('ownership.title')}</span>}>
      {pending ? (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message={t('ownership.waitingOn', { name: pending.to?.name || pending.to?.email })}
            description={t('ownership.expires', { date: formatDate(pending.expiresAt, 'dateTime') })}
          />
          <Button loading={busy} onClick={() => run(() => teamsApi.cancelOwnership(), t('ownership.cancelled'))}>
            {t('ownership.cancel')}
          </Button>
        </Space>
      ) : (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{t('ownership.hint')}</Text>
          <Space wrap>
            <Select
              style={{ minWidth: 260 }}
              placeholder={t('ownership.pickMember')}
              value={target}
              onChange={setTarget}
              options={candidates}
              notFoundContent={t('ownership.noCandidates')}
            />
            <Popconfirm
              title={t('ownership.confirmTitle')}
              description={t('ownership.confirmBody')}
              okText={t('ownership.offer')}
              disabled={!target}
              onConfirm={() => run(() => teamsApi.offerOwnership(target), t('ownership.offered'))}
            >
              <Button type="primary" disabled={!target} loading={busy}>{t('ownership.offer')}</Button>
            </Popconfirm>
          </Space>
        </Space>
      )}
    </Card>
  );
};

export default OwnershipCard;
