import React, { useState } from 'react';
import {
  Card, Button, Modal, Typography, Space, Alert, message,
} from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle } from '../../theme/colors';
import teamsApi from '../../api/teamsApi';
import { formatAmount } from '../../utils/money';
import { teamErrorText } from './TeamOnboardingPage';

const { Text, Paragraph } = Typography;

/**
 * Closing the organization — the owner's last action, and the one that cannot
 * be undone from here.
 *
 * The server does the refusing, and this screen shows exactly what it said:
 * something still deployed, a balance still owed, or credit still in the
 * wallet. The last of those is not a refusal so much as a question — the money
 * is given up by closing, so the amount is put on screen and the customer has
 * to say yes to that specific number rather than to a vague warning.
 */
const CloseTeamCard = ({ teamName, currency, onClosed }) => {
  const { t } = useTranslation(['teams', 'common']);
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocker, setBlocker] = useState(null);
  const [forfeit, setForfeit] = useState(null);

  const attempt = async (forfeitBalance = false) => {
    setBusy(true);
    try {
      await teamsApi.closeTeam({ forfeitBalance });
      message.success(t('close.done', { team: teamName }));
      setOpen(false);
      if (onClosed) onClosed();
    } catch (err) {
      const { code, details } = err?.response?.data || {};
      if (code === 'BALANCE_REMAINING') {
        // Not a dead end: the customer is shown the exact figure and asked again.
        setForfeit(details || {});
        setBlocker(null);
      } else {
        setForfeit(null);
        setBlocker(teamErrorText(t, err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card
        style={{ ...cardStyle(isDark), marginBottom: 20, borderColor: isDark ? '#5c2626' : '#ffccc7' }}
        title={<span style={{ color: '#cf1322' }}><WarningOutlined /> {t('close.title')}</span>}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{t('close.hint')}</Text>
          <Button danger onClick={() => { setBlocker(null); setForfeit(null); setOpen(true); }}>
            {t('close.action')}
          </Button>
        </Space>
      </Card>

      <Modal
        open={open}
        title={t('close.confirmTitle', { team: teamName })}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Paragraph style={{ marginBottom: 0 }}>{t('close.confirmBody')}</Paragraph>

          {blocker && <Alert type="error" showIcon message={blocker} />}

          {forfeit && (
            <Alert
              type="warning"
              showIcon
              message={t('close.balanceTitle', {
                amount: `${forfeit.currency || currency} ${formatAmount(forfeit.balance)}`,
              })}
              description={t('close.balanceBody')}
            />
          )}

          <Space>
            <Button onClick={() => setOpen(false)}>{t('common:cancel', 'Cancel')}</Button>
            <Button danger type="primary" loading={busy} onClick={() => attempt(!!forfeit)}>
              {forfeit ? t('close.confirmForfeit') : t('close.action')}
            </Button>
          </Space>
        </Space>
      </Modal>
    </>
  );
};

export default CloseTeamCard;
