import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Row, Col, Typography, Button, Space, Table, Alert,
  InputNumber, message,
} from 'antd';
import {
  WalletOutlined, ClockCircleOutlined, PlusOutlined,
  ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import StatusBadge from '../../../components/StatusBadge';
import Sparkline from '../../../components/Sparkline';
import { StatRow, StatCard } from '../../../components/StatRow';
import { StatCardsSkeleton, TableRowsSkeleton } from '../../../components/Skeletons';
import walletApi from '../../../api/walletApi';
import { useTheme } from '../../../context/ThemeContext';
import { useBilling } from '../../../context/SiteContext';
import { cardStyle as surfaceStyle, monoNumeric, GRADIENT, STATUS_COLORS } from '../../../theme/colors';
import { formatDate, formatNumber } from '../../../utils/format';
import { formatAmount } from '../../../utils/money';
import { useTranslation } from 'react-i18next';

const { Title, Text, Paragraph } = Typography;

/**
 * Holds a translation *key*, not a label: this is a module-level constant, so
 * there is no `t` in scope here, and a string resolved at import time could
 * never follow a later language change. Call sites do `t(m.labelKey)`.
 */
const TYPE_META = {
  topup: { tone: 'success', labelKey: 'billing:credits.topup' },
  signup_credit: { tone: 'info', labelKey: 'billing:credits.signupCredit' },
  bonus: { tone: 'info', labelKey: 'billing:credits.bonus' },
  charge: { tone: 'neutral', labelKey: 'billing:credits.usage' },
  refund: { tone: 'success', labelKey: 'billing:credits.refund' },
  adjustment: { tone: 'warning', labelKey: 'billing:credits.adjustment' },
  debt_accrual: { tone: 'error', labelKey: 'billing:credits.debtRecorded' },
  debt_settlement: { tone: 'success', labelKey: 'billing:credits.debtPaid' },
};

/**
 * Prepaid credit — a way to fund the account ahead of usage rather than the
 * account's primary billing model. The cost picture itself lives on Overview;
 * this tab is about putting money in and seeing every movement of it.
 */
const CreditsTab = ({ onGoToTab }) => {
  const { t } = useTranslation(['billing', 'common']);
  const { isDark } = useTheme();
  const { creditsEnabled, currency } = useBilling();

  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [amount, setAmount] = useState(null);
  const [toppingUp, setToppingUp] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([walletApi.get(), walletApi.getTransactions({ limit: 50 })])
      .then(([w, tx]) => {
        setWallet(w.wallet);
        setTransactions(tx.transactions || []);
        setAmount((current) => current ?? w.wallet.settings?.topUpPresets?.[1] ?? 50);
        setError(null);
      })
      .catch((err) => setError(err.response?.data?.message || t('billing:credits.loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (creditsEnabled) load();
    else setLoading(false);
  }, [creditsEnabled, load]);

  const topUp = async () => {
    if (!amount || amount <= 0) {
      message.error(t('billing:credits.enterAmount'));
      return;
    }
    setToppingUp(true);
    try {
      const data = await walletApi.createTopUp(amount);
      if (data.url) window.location.href = data.url;
      else message.error(t('billing:credits.checkoutFailed'));
    } catch (err) {
      message.error(err.response?.data?.message || t('billing:credits.checkoutFailed'));
    } finally {
      setToppingUp(false);
    }
  };

  const card = surfaceStyle(isDark);

  if (loading && !wallet) {
    return (
      <>
        <StatCardsSkeleton count={3} />
        <TableRowsSkeleton rows={6} />
      </>
    );
  }

  if (error) {
    return <Alert type="error" showIcon message={error} action={<Button onClick={load}>{t('common:action.retry')}</Button>} />;
  }

  const balanceTrend = transactions.slice(0, 20).map((tx) => tx.balanceAfter).reverse();
  const noRunway = wallet?.runwayDays === null || wallet?.runwayDays === undefined;

  const presets = wallet?.settings?.topUpPresets || [25, 50, 100, 250];
  const minTopUp = wallet?.settings?.minTopUp ?? 10;
  const maxTopUp = wallet?.settings?.maxTopUp ?? 5000;

  const outstanding = wallet?.outstandingBalance || 0;
  const hasDebt = outstanding > 0;

  // What this exact top-up would do, computed live as the amount changes —
  // debt is always paid first, and only what's left over becomes spendable.
  const enteredAmount = amount || 0;
  const willSettle = hasDebt ? Math.min(enteredAmount, outstanding) : 0;
  const willRemain = Math.max(0, enteredAmount - willSettle);

  const columns = [
    {
      title: t('billing:credits.date'),
      dataIndex: 'createdAt',
      width: 150,
      render: (d) => formatDate(d, 'dateTime'),
    },
    {
      title: t('billing:credits.type'),
      dataIndex: 'type',
      width: 150,
      // Named `entryType`, not `t` — the original parameter name shadowed the
      // translator inside exactly the block that now needs it.
      render: (entryType) => {
        const m = TYPE_META[entryType] || { tone: 'neutral' };
        return <StatusBadge tone={m.tone} label={m.labelKey ? t(m.labelKey) : entryType} size="small" />;
      },
    },
    { title: t('billing:invoice.description'), dataIndex: 'description', ellipsis: true },
    {
      title: t('billing:credits.amount'),
      dataIndex: 'amount',
      width: 150,
      align: 'right',
      // debt_accrual and a card-funded debt_settlement never touch the
      // spendable balance at all (see the CreditTransaction class comment on
      // the backend) — their `amount` is genuinely 0, so showing that plainly
      // would read as a broken row. debtDelta is the real, non-zero number
      // for those; everything else already has a meaningful `amount`.
      render: (a, record) => {
        if (a === 0 && record.debtDelta) {
          const d = record.debtDelta;
          return (
            <Text strong style={{ color: d >= 0 ? STATUS_COLORS.error.light : STATUS_COLORS.success.light, ...monoNumeric }}>
              {d >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {currency} {formatAmount(Math.abs(d))}
              <Text type="secondary" style={{ fontWeight: 400, fontSize: 11, display: 'block' }}>
                {d >= 0 ? t('billing:credits.addedToDebt') : t('billing:credits.paidOffDebt')}
              </Text>
            </Text>
          );
        }
        return (
          <Text strong style={{ color: a >= 0 ? STATUS_COLORS.success.light : STATUS_COLORS.error.light, ...monoNumeric }}>
            {a >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {currency} {formatAmount(Math.abs(a))}
          </Text>
        );
      },
    },
    {
      title: t('billing:credits.balance'),
      dataIndex: 'balanceAfter',
      width: 120,
      align: 'right',
      render: (b, record) => (
        <div style={{ textAlign: 'end' }}>
          <Text type="secondary" style={monoNumeric}>{currency} {formatAmount(b)}</Text>
          {record.outstandingAfter > 0 && (
            <Text style={{ display: 'block', fontSize: 11, color: STATUS_COLORS.error.light, ...monoNumeric }}>
              {t('billing:credits.owed', { amount: `${currency} ${formatAmount(record.outstandingAfter)}` })}
            </Text>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <Title level={5} style={{ margin: 0 }}>{t('billing:overview.creditBalance')}</Title>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {t('billing:credits.prepaidSubtitle')}
        </Text>
      </div>

      <StatRow>
        <StatCard count={3} sm={12} style={{ background: GRADIENT, border: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 13, flexShrink: 0,
              background: 'rgba(255,255,255,0.22)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>
              <WalletOutlined />
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
              textTransform: 'uppercase', lineHeight: 1.35, color: 'rgba(255,255,255,0.85)',
            }}>
              {t('billing:credits.currentBalance')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', color: '#fff', ...monoNumeric }}>
                {formatAmount((wallet?.balance ?? 0))}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{currency}</span>
            </div>
            {balanceTrend.length >= 2 && (
              <Sparkline values={balanceTrend} width={66} height={32} color="#fff" filled={false} />
            )}
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'rgba(255,255,255,0.8)' }}>
            {wallet?.lifetimeTopUp
              ? t('billing:credits.addedAllTime', { amount: `${currency} ${formatAmount(wallet.lifetimeTopUp)}` })
              : t('billing:credits.prepaidCredit')}
          </div>
        </StatCard>

        <StatCard
          count={3} sm={12}
          icon={<ClockCircleOutlined />} tone="cyan"
          label={t('billing:credits.estimatedRunway')}
          value={noRunway ? '--' : wallet.runwayDays}
          suffix={noRunway ? '' : t('billing:credits.daysSuffix')}
          caption={noRunway ? t('billing:credits.nothingRunning') : t('billing:credits.beforeRunsOut')}
        />

        <StatCard
          count={3} sm={12}
          icon={<ArrowDownOutlined />} tone="purple"
          label={t('billing:credits.lifetimeSpend')}
          value={formatAmount((wallet?.lifetimeSpend ?? 0))}
          suffix={currency}
          caption={t('billing:credits.lifetimeSpendCaption')}
        />
      </StatRow>

      {hasDebt && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 24, borderRadius: 12 }}
          message={t('billing:credits.outstanding', { amount: `${currency} ${formatAmount(outstanding)}` })}
          description={t('billing:credits.outstandingBody')}
        />
      )}

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={9}>
          <Card title={t('common:action.addCredit')} style={card} styles={{ body: { padding: 24 } }}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Space size={8} wrap>
                {presets.map((preset) => (
                  <Button
                    key={preset}
                    type={amount === preset ? 'primary' : 'default'}
                    onClick={() => setAmount(preset)}
                  >
                    {currency} {preset}
                  </Button>
                ))}
              </Space>

              <div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  {t('billing:credits.enterAmountRange', { currency, min: minTopUp, max: formatNumber(maxTopUp) })}
                </Text>
                <InputNumber
                  style={{ width: '100%' }} size="large"
                  min={minTopUp} max={maxTopUp}
                  value={amount} onChange={setAmount} prefix={currency}
                />
              </div>

              {hasDebt && enteredAmount > 0 && (
                <div style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: STATUS_COLORS.warning.bg(isDark),
                }}>
                  <Text style={{ fontSize: 12.5, display: 'block' }}>
                    {t('billing:credits.ofYourAmount', { amount: `${currency} ${formatAmount(enteredAmount)}` })}{' '}
                    <Text strong>{currency} {formatAmount(willSettle)}</Text> {t('billing:credits.willSettle')}{' '}
                    <Text strong>{currency} {formatAmount(willRemain)}</Text> {t('billing:credits.willRemain')}
                  </Text>
                </div>
              )}

              <Button type="primary" size="large" block icon={<PlusOutlined />} loading={toppingUp} onClick={topUp}>
                {t('billing:credits.addAmount', { amount: `${currency} ${amount || 0}` })}
              </Button>

              <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                {t('billing:credits.paymentProviderNote')}
                {hasDebt
                  ? t('billing:credits.settlesDebtFirst')
                  : t('billing:credits.resumesPaused')}
              </Paragraph>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={15}>
          <Card title={t('billing:credits.transactionHistory')} style={card} styles={{ body: { padding: 0 } }}>
            <Table
              className="ledger-table"
              columns={columns}
              dataSource={transactions}
              rowKey="id"
              loading={loading}
              pagination={transactions.length > 15 ? { pageSize: 15 } : false}
              scroll={{ x: 700 }}
              locale={{ emptyText: t('billing:credits.noTransactions') }}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default CreditsTab;
