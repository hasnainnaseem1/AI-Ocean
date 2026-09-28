import React, { useCallback, useEffect, useState } from 'react';
import {
  Row, Col, Card, Typography, Switch, InputNumber, Button, Space, Divider, Alert, message,
} from 'antd';
import {
  SyncOutlined, StopOutlined, BellOutlined, CloudServerOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import StatusBadge from '../components/StatusBadge';
import walletApi from '../api/walletApi';
import { useTheme } from '../context/ThemeContext';
import { useBilling } from '../context/SiteContext';
import { cardStyle as surfaceStyle, monoNumeric } from '../theme/colors';
import { getLimits, saveLimits } from '../utils/billingMock';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

/** One control per row: label + explanation on the left, the input on the right. */
const ControlRow = ({ icon, title, description, children, last }) => (
  <>
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: 20, padding: '4px 0', flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', gap: 12, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 16, opacity: 0.6, marginTop: 2 }}>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ display: 'block' }}>{title}</Text>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{description}</Text>
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
    {!last && <Divider style={{ margin: '16px 0' }} />}
  </>
);

/**
 * A page-level group header with a scope badge, so it's obvious at a glance
 * which controls only matter if you fund the account with prepaid credit,
 * versus which apply no matter how the bill gets paid.
 */
const SectionHeading = ({ title, tone, badge, description }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <Title level={5} style={{ margin: 0 }}>{title}</Title>
      <StatusBadge tone={tone} label={badge} size="small" />
    </div>
    <Text type="secondary" style={{ fontSize: 12.5 }}>{description}</Text>
  </div>
);

/**
 * Everything that decides when spending stops. In pay-as-you-go there's no
 * plan ceiling doing this for you, so these controls are the only thing
 * standing between a forgotten deployment and a surprise bill.
 *
 * Split into two scopes because they answer different questions: wallet
 * controls only matter if the account is funded by prepaid credit, while
 * spending controls cap what runs no matter how the bill gets settled.
 * Mixing them under one "Spending" card was confusing — a future
 * postpaid-invoice customer would see auto top-up and wonder what it had
 * to do with them.
 *
 * Deliberately its own page rather than a Billing tab — this is set to grow
 * (per-model caps, team budgets, alert routing) well past what a tab holds.
 */
const UsageLimitsPage = () => {
  const { t } = useTranslation(['account', 'common']);
  const { isDark } = useTheme();
  const { currency, creditsEnabled } = useBilling();
  const card = surfaceStyle(isDark);

  const [limits, setLimits] = useState(getLimits);
  const [wallet, setWallet] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [savingAuto, setSavingAuto] = useState(false);

  // Swallowing this left the page showing a zero balance and zero spend as
  // though they were real. Say the figures couldn't be loaded instead.
  const loadWallet = useCallback(() => {
    if (!creditsEnabled) return;
    walletApi.get()
      .then((w) => { setWallet(w.wallet); setLoadError(null); })
      .catch(() => setLoadError(t('account:limits.balanceLoadFailedBody')));
    // `t` changes identity with the language, so a switch refreshes rather than
    // leaving this message stranded in the previous one.
  }, [creditsEnabled, t]);

  useEffect(loadWallet, [loadWallet]);

  const patchLimits = (patch) => {
    setLimits(saveLimits(patch));
    message.success(t('account:limits.updated'));
  };

  const saveAutoTopUp = async (patch) => {
    setSavingAuto(true);
    try {
      const data = await walletApi.updateAutoTopUp(patch);
      setWallet((w) => ({ ...w, autoTopUp: data.autoTopUp }));
      message.success(t('account:wallet.autoTopUpUpdated'));
    } catch (err) {
      message.error(err.response?.data?.message || t('account:wallet.autoTopUpFailed'));
    } finally {
      setSavingAuto(false);
    }
  };

  const auto = wallet?.autoTopUp || {};

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ marginBottom: 4 }}>{t('account:limits.title')}</Title>
        <Text type="secondary">{t('account:limits.subtitle')}</Text>
      </div>

      {loadError && (
        <Alert
          type="error" showIcon
          style={{ marginBottom: 16 }}
          message={t('account:limits.balanceLoadFailed')}
          description={loadError}
          action={<Button size="small" onClick={loadWallet}>{t('common:action.retry')}</Button>}
        />
      )}

      <Alert
        type="info" showIcon
        message={t('account:limits.notEnforcedTitle')}
        description={t('account:limits.notEnforcedBody')}
        style={{ marginBottom: 28, borderRadius: 12 }}
      />

      {/* ── Wallet controls — only meaningful if this account runs on
           prepaid credit rather than a monthly invoice. ── */}
      {creditsEnabled && (
        <>
          <SectionHeading
            title={t('account:wallet.title')}
            tone="info"
            badge={t('account:wallet.badge')}
            description={t('account:wallet.description')}
          />
          <Row gutter={[24, 24]} style={{ marginBottom: 32 }}>
            <Col xs={24} lg={12}>
              <Card title={t('account:wallet.autoTopUp')} style={{ ...card, height: '100%' }} styles={{ body: { padding: '20px 24px' } }}>
                <ControlRow
                  icon={<SyncOutlined />}
                  title={t('account:wallet.keepToppedUp')}
                  description={t('account:wallet.keepToppedUpBody')}
                >
                  <Switch
                    checked={!!auto.enabled}
                    loading={savingAuto}
                    onChange={(enabled) => saveAutoTopUp({ enabled })}
                  />
                </ControlRow>

                <ControlRow
                  icon={<ThunderboltOutlined />}
                  title={t('account:wallet.topUpBy')}
                  description={t('account:wallet.topUpByBody')}
                  last
                >
                  <InputNumber
                    disabled={!auto.enabled}
                    min={10} max={5000}
                    value={auto.amount ?? 50}
                    prefix={currency}
                    style={{ width: 140, ...monoNumeric }}
                    onChange={(amount) => amount && saveAutoTopUp({ amount })}
                  />
                </ControlRow>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title={t('account:wallet.balanceAlerts')} style={{ ...card, height: '100%' }} styles={{ body: { padding: '20px 24px' } }}>
                <ControlRow
                  icon={<BellOutlined />}
                  title={t('account:wallet.lowBalanceAlert')}
                  description={t('account:wallet.lowBalanceAlertBody')}
                >
                  <InputNumber
                    min={0} max={10000}
                    value={limits.lowBalanceAlert}
                    prefix={currency}
                    style={{ width: 140, ...monoNumeric }}
                    onChange={(lowBalanceAlert) => patchLimits({ lowBalanceAlert })}
                  />
                </ControlRow>

                <ControlRow
                  icon={<BellOutlined />}
                  title={t('account:wallet.triggerBelow')}
                  description={t('account:wallet.triggerBelowBody')}
                  last
                >
                  <InputNumber
                    disabled={!auto.enabled}
                    min={0} max={1000}
                    value={auto.threshold ?? 10}
                    prefix={currency}
                    style={{ width: 140, ...monoNumeric }}
                    onChange={(threshold) => threshold !== null && saveAutoTopUp({ threshold })}
                  />
                </ControlRow>
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* ── Usage & spending controls — apply no matter how the bill gets
           settled: prepaid credit today, a monthly invoice later. ── */}
      <SectionHeading
        title={t('account:controls.title')}
        tone="neutral"
        badge={t('account:controls.badge')}
        description={t('account:controls.description')}
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <Card title={t('account:controls.spendingCaps')} style={{ ...card, height: '100%' }} styles={{ body: { padding: '20px 24px' } }}>
            <ControlRow
              icon={<StopOutlined />}
              title={t('account:controls.monthlyCap')}
              description={t('account:controls.monthlyCapBody')}
            >
              <InputNumber
                min={0} max={100000}
                value={limits.monthlySpendCap}
                prefix={currency}
                placeholder={t('account:controls.noCap')}
                style={{ width: 140, ...monoNumeric }}
                onChange={(monthlySpendCap) => patchLimits({ monthlySpendCap })}
              />
            </ControlRow>

            <ControlRow
              icon={<StopOutlined />}
              title={t('account:controls.pauseAtCap')}
              description={t('account:controls.pauseAtCapBody')}
              last
            >
              <Switch
                checked={limits.pauseAtCap}
                disabled={limits.monthlySpendCap === null}
                onChange={(pauseAtCap) => patchLimits({ pauseAtCap })}
              />
            </ControlRow>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={t('account:controls.resourceCeilings')} style={{ ...card, height: '100%' }} styles={{ body: { padding: '20px 24px' } }}>
            <ControlRow
              icon={<CloudServerOutlined />}
              title={t('account:controls.maxConcurrent')}
              description={t('account:controls.maxConcurrentBody')}
            >
              <InputNumber
                min={1} max={100}
                value={limits.maxConcurrentDeployments}
                placeholder={t('account:controls.unlimited')}
                style={{ width: 140, ...monoNumeric }}
                onChange={(maxConcurrentDeployments) => patchLimits({ maxConcurrentDeployments })}
              />
            </ControlRow>

            <ControlRow
              icon={<ThunderboltOutlined />}
              title={t('account:controls.maxHourlyRate')}
              description={t('account:controls.maxHourlyRateBody')}
              last
            >
              <InputNumber
                min={0} max={1000} step={0.5}
                value={limits.maxHourlyRate}
                prefix={currency}
                placeholder={t('account:controls.noLimit')}
                style={{ width: 140, ...monoNumeric }}
                onChange={(maxHourlyRate) => patchLimits({ maxHourlyRate })}
              />
            </ControlRow>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginTop: 24 }}>
        <Button
          onClick={() => {
            setLimits(saveLimits({
              monthlySpendCap: null, pauseAtCap: true, lowBalanceAlert: 25,
              maxConcurrentDeployments: null, maxHourlyRate: null,
            }));
            message.success(t('account:limits.reset'));
          }}
        >
          {t('account:limits.resetButton')}
        </Button>
      </Space>
    </>
  );
};

export default UsageLimitsPage;
