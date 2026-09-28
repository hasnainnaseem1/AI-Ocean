import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Row, Col, Typography, Tag, Descriptions, Button, Space, Timeline,
  Alert, Spin, Result, Table, Popconfirm, Input, Tooltip, Tabs, Modal,
  message,
} from 'antd';
import {
  ArrowLeftOutlined, CopyOutlined, EyeOutlined, EyeInvisibleOutlined,
  PauseCircleOutlined, PlayCircleOutlined, StopOutlined, DeleteOutlined,
  LinkOutlined, ReloadOutlined, ThunderboltOutlined, ClockCircleOutlined,
  DollarOutlined, CalendarOutlined, SwapOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import Sparkline from '../../components/Sparkline';
import { StatRow, StatCard } from '../../components/StatRow';
import { DetailSkeleton } from '../../components/Skeletons';
import deploymentsApi from '../../api/deploymentsApi';
import walletApi from '../../api/walletApi';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import { useTeam } from '../../context/TeamContext';
import { cardStyle as surfaceStyle, monoNumeric, ltrTechnical } from '../../theme/colors';
import { formatHours, humanDuration, formatClock } from '../../utils/duration';
import { STATUS_META, STATUS_TONE } from './DeploymentsListPage';
import { formatRate, formatAmount } from '../../utils/money';
import { formatDate, formatNumber, EMPTY } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

const formatDateTime = (d) =>
  formatDate(d, 'dateTime');

/**
 * The machine's specification, snapshot onto the deployment at order time.
 *
 * Each part is only named when the machine has it — a CPU- or memory-optimised
 * tier has no accelerator, and reading "0× (0GB)" would be worse than saying
 * nothing.
 */
const machineSpec = (tier) => {
  if (!tier) return '—';
  const parts = [];
  if (tier.gpuCount > 0) {
    parts.push(`${tier.gpuCount}× ${tier.gpuModel || 'accelerator'}${tier.vramGb ? ` (${tier.vramGb}GB)` : ''}`);
  }
  if (tier.vcpu) parts.push(`${tier.vcpu} vCPU`);
  if (tier.ramGb) parts.push(`${tier.ramGb}GB RAM`);
  if (tier.storageGb) parts.push(`${tier.storageGb}GB ${tier.storageType || 'storage'}`);
  return parts.join(' · ') || '—';
};

/**
 * The billing method, always visible next to the status badge and switchable
 * in one click — this used to be a line buried at the bottom of a
 * Configuration list, which was the single hardest thing on this page to
 * find. It still has a fuller explanation on the Billing tab; this is the
 * at-a-glance-and-act version.
 */
const BillingMethodTag = ({
  deployment, acting, onSwitch, paygAvailable = true, canSwitch = true,
}) => {
  const { t } = useTranslation('deployments');
  const isPayg = deployment.billingMethod === 'payg';
  const nextMethod = isPayg ? 'prepaid' : 'payg';
  const busy = acting === `billing-${nextMethod}`;

  // Nothing to switch to: a terminated deployment, or a prepaid one whose
  // owner does not have pay-as-you-go (platform switch off, or blocked by an
  // admin). A PAYG deployment can always be moved back to prepaid.
  if (deployment.status === 'terminated' || !canSwitch || (!isPayg && !paygAvailable)) {
    return <Tag>{isPayg ? t('billingMethod.payg') : t('billingMethod.prepaid')}</Tag>;
  }

  return (
    <Popconfirm
      title={t('billingMethod.switchConfirm', {
        method: nextMethod === 'payg' ? t('billingMethod.payg') : t('billingMethod.prepaid'),
      })}
      onConfirm={() => onSwitch(nextMethod)}
    >
      <Tag
        color={isPayg ? 'gold' : 'blue'}
        icon={<SwapOutlined />}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {busy ? t('billingMethod.switching') : (isPayg ? t('billingMethod.payg') : t('billingMethod.prepaid'))}
      </Tag>
    </Popconfirm>
  );
};

const DeploymentDetailPage = () => {
  const { t } = useTranslation(['deployments', 'common']);
  const { id } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { currency, creditsEnabled: money } = useBilling();
  // What this member's role allows in the current account (the server
  // refuses the rest). `money` is false for Developer / Viewer.
  const { can } = useTeam();
  const canOperate = can('deployments.operate');
  const canSwitchMethod = can('deployments.billingMethod');

  const [deployment, setDeployment] = useState(null);
  const [usage, setUsage] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [storageGrace, setStorageGrace] = useState(null);
  // Whether this customer can use pay-as-you-go at all — decided by the
  // server (platform switch plus any per-customer setting), so the page never
  // offers a switch it would then refuse.
  const [paygAvailable, setPaygAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acting, setActing] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [requirementsOpen, setRequirementsOpen] = useState(false);

  const [apiKey, setApiKey] = useState(null);
  const [revealing, setRevealing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    deploymentsApi
      .get(id)
      .then((data) => {
        setDeployment(data.deployment);
        setStorageGrace(data.storageGrace || null);
        setPaygAvailable(data.paygAvailable !== false);
        setError(null);
        // Runway is what tells someone their machine is about to be stopped.
        // Failing to load it must never break the page it sits on.
        if (money) walletApi.get().then((w) => setWallet(w.wallet || w)).catch(() => {});
        return deploymentsApi.getUsage(id).then(setUsage).catch(() => {});
      })
      .catch((err) => setError(err.response?.data?.message || t('deployments:detail.loadFailed')))
      .finally(() => setLoading(false));
    // `t` changes identity with the language, so a switch reloads rather than
    // leaving a failure message stranded in the previous one.
  }, [id, t, money]);

  useEffect(load, [load]);

  const act = async (action) => {
    setActing(action);
    try {
      const result = await deploymentsApi[action](id);
      message.success(result.message || t('common:action.done'));
      load();
    } catch (err) {
      const data = err.response?.data;
      message.error(data?.message || t('deployments:detail.actionFailed'));
      if (data?.code === 'INSUFFICIENT_CREDIT') navigate('/billing?tab=credits');
    } finally {
      setActing(null);
    }
  };

  /**
   * Switches prepaid <-> pay-as-you-go. Works at any time — not only from the
   * auto-suspend offer below — but when it IS exactly the deployment that was
   * just paused for lack of credit, the backend also attempts an immediate
   * resume, so the response is checked for that rather than assumed.
   */
  const switchBillingMethod = async (method) => {
    setActing(`billing-${method}`);
    try {
      const result = await deploymentsApi.setBillingMethod(id, method);
      const label = method === 'payg' ? 'pay-as-you-go' : 'prepaid';
      if (result.resumeAttempted) {
        message[result.resumed ? 'success' : 'warning'](
          result.resumed
            ? t('deployments:billingMethod.switchedResumed', { method: label })
            : t('deployments:billingMethod.switchedNotResumed', { method: label, reason: result.resumeError?.message || t('deployments:alerts.checkAccount') })
        );
      } else {
        message.success(t('deployments:billingMethod.switched', { method: label }));
      }
      load();
    } catch (err) {
      message.error(err.response?.data?.message || t('deployments:billingMethod.switchFailed'));
    } finally {
      setActing(null);
    }
  };

  const revealKey = async () => {
    if (apiKey) { setApiKey(null); return; }
    setRevealing(true);
    try {
      const data = await deploymentsApi.revealApiKey(id);
      setApiKey(data.apiKey);
    } catch (err) {
      message.error(err.response?.data?.message || t('deployments:endpoint.revealFailed'));
    } finally {
      setRevealing(false);
    }
  };

  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(t('deployments:endpoint.copied', { label }));
    } catch {
      message.error(t('deployments:endpoint.copyFailed'));
    }
  };

  const card = surfaceStyle(isDark);

  if (loading && !deployment) {
    return <DetailSkeleton />;
  }

  if (error || !deployment) {
    return (
        <Result
          status="404"
          title={t('deployments:detail.notFound')}
          subTitle={error}
          extra={<Button type="primary" onClick={() => navigate('/deployments')}>{t('deployments:detail.back')}</Button>}
        />
    );
  }

  const meta = STATUS_META[deployment.status] || { color: 'default' };
  const isLive = deployment.status === 'running';
  const hasEndpoint = !!deployment.endpoint?.url;
  const isPayg = deployment.billingMethod === 'payg';
  // Time on the clock that the hourly billing job has not charged for yet —
  // see the stat cards below for why every "total" here needs it beside it.
  const unbilled = usage?.totals?.unbilled?.hours > 0 ? usage.totals.unbilled : null;

  const usageColumns = [
    { title: t('deployments:history.periodStart'), dataIndex: 'periodStart', render: formatDateTime },
    {
      // Without this a customer seeing a charge on a paused deployment has no
      // way to tell it apart from compute they thought they had stopped.
      title: 'For',
      dataIndex: 'kind',
      width: 110,
      render: (kind) => (kind === 'storage' ? (
        <Tooltip title={t('deployments:detail.storageTooltip')}>
          <Tag color="gold">{t('common:label.storage')}</Tag>
        </Tooltip>
      ) : <Tag>{t('common:label.compute')}</Tag>),
    },
    {
      title: t('common:label.hours'),
      dataIndex: 'hours',
      align: 'right',
      width: 100,
      render: (h) => (
        <Tooltip title={humanDuration(h)}>
          <span style={monoNumeric}>{formatHours(h)}</span>
        </Tooltip>
      ),
    },
    {
      // Three decimals, matching the rate shown everywhere else in billing and
      // the rate the charge was actually computed from. Rounded to two, a
      // storage rate of 0.034 reads as 0.03 — a 12% error on the one number
      // the customer would use to work out what a stopped machine is costing.
      title: t('common:label.rate'),
      dataIndex: 'rate',
      align: 'right',
      width: 110,
      render: (r) => <span style={monoNumeric}>{currency} {formatRate(r)}</span>,
    },
    {
      title: t('common:label.charge'),
      dataIndex: 'amount',
      align: 'right',
      width: 120,
      render: (a, row) => (
        <Space size={4}>
          <Text strong style={monoNumeric}>{currency} {formatAmount(a)}</Text>
          {!row.charged && <Tooltip title={t('deployments:detail.notChargedTooltip')}><Tag>plan</Tag></Tooltip>}
        </Space>
      ),
    },
  ];

  const overviewContent = (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={14}>
        <Card title={t('deployments:endpoint.title')} style={card} styles={{ body: { padding: 24 } }}>
          {!hasEndpoint ? (
            <Text type="secondary">
              {t('deployments:endpoint.pending')}
            </Text>
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>{t('deployments:endpoint.baseUrl')}</Text>
                <Input
                  readOnly
                  value={deployment.endpoint.url}
                  addonAfter={
                    <CopyOutlined style={{ cursor: 'pointer' }} onClick={() => copy(deployment.endpoint.url, t('deployments:endpoint.endpointUrl'))} />
                  }
                />
              </div>

              {deployment.endpoint.hasApiKey && can('deployments.apiKey') && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>{t('deployments:endpoint.apiKey')}</Text>
                  <Input
                    readOnly
                    value={apiKey || deployment.endpoint.apiKeyMasked}
                    addonAfter={
                      <Space size={10}>
                        <Tooltip title={apiKey ? t('common:action.hide') : t('common:action.reveal')}>
                          {revealing
                            ? <Spin size="small" />
                            : apiKey
                              ? <EyeInvisibleOutlined style={{ cursor: 'pointer' }} onClick={revealKey} />
                              : <EyeOutlined style={{ cursor: 'pointer' }} onClick={revealKey} />}
                        </Tooltip>
                        {apiKey && (
                          <CopyOutlined style={{ cursor: 'pointer' }} onClick={() => copy(apiKey, t('deployments:endpoint.apiKey'))} />
                        )}
                      </Space>
                    }
                  />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('deployments:endpoint.revealAudited')}
                  </Text>
                </div>
              )}

              {deployment.endpoint.docsUrl && (
                <Button type="link" icon={<LinkOutlined />} href={deployment.endpoint.docsUrl} target="_blank" rel="noopener noreferrer" style={{ paddingInlineStart: 0 }}>
                  {t('deployments:endpoint.docs')}
                </Button>
              )}

              {isLive && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>{t('deployments:endpoint.quickTest')}</Text>
                  <pre style={{
                    background: isDark ? '#0E1120' : '#F7F9FF',
                    border: `1px solid ${isDark ? '#242942' : '#ECEFF8'}`,
                    borderRadius: 10, padding: 14, fontSize: 12, overflowX: 'auto', margin: 0,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  }}>
{`curl ${deployment.endpoint.url}/chat/completions \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${deployment.model?.slug}","messages":[{"role":"user","content":"Hello"}]}'`}
                  </pre>
                </div>
              )}
            </Space>
          )}
        </Card>
      </Col>

      <Col xs={24} lg={10}>
        <Card
          title={t('deployments:config.title')}
          style={card}
          styles={{ body: { padding: 24 } }}
          extra={
            <Button
              type="link"
              size="small"
              icon={<FileTextOutlined />}
              style={{ paddingInlineEnd: 0 }}
              onClick={() => setRequirementsOpen(true)}
            >
              {t('deployments:config.viewRequirements')}
            </Button>
          }
        >
          <Descriptions column={1} size="small" colon={false}>
            <Descriptions.Item label={t('common:label.model')}>{deployment.model?.name}</Descriptions.Item>
            <Descriptions.Item label={t('deployments:config.parameters')}>{deployment.model?.parameterSize || '—'}</Descriptions.Item>
            <Descriptions.Item label={t('deployments:config.context')}>
              {deployment.model?.contextLength
                ? t('catalog:model.tokens', { count: deployment.model.contextLength, formatted: formatNumber(deployment.model.contextLength) })
                : EMPTY}
            </Descriptions.Item>
            <Descriptions.Item label={t('deployments:config.machine')}>
              {deployment.tier?.name || '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('deployments:config.specification')}>
              <span style={ltrTechnical}>{machineSpec(deployment.tier)}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t('common:label.region')}>{deployment.region}</Descriptions.Item>
            <Descriptions.Item label={t('deployments:config.requested')}>{formatDateTime(deployment.createdAt)}</Descriptions.Item>
            {money && deployment.stoppedPricePerHour > 0 && (
              <Descriptions.Item label={t('deployments:config.whilePaused')}>
                {t('deployments:detail.whilePausedRate', { rate: `${currency} ${formatRate(deployment.stoppedPricePerHour)}` })}
                {deployment.tier?.storageGb
                  ? t('deployments:detail.holdsYourDisk', {
                    size: deployment.tier.storageGb,
                    kind: deployment.tier.storageType || t('deployments:detail.disk'),
                  })
                  : ''}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      </Col>
    </Row>
  );

  const billingContent = (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card title={t('deployments:billingMethod.title')} style={card} styles={{ body: { padding: 24 } }}>
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Space size={10} align="center">
            <Tag color={isPayg ? 'gold' : 'blue'} style={{ fontSize: 13, padding: '2px 10px' }}>
              {isPayg ? t('deployments:billingMethod.payg') : t('deployments:billingMethod.prepaidBalance')}
            </Tag>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {isPayg
                ? t('deployments:billingMethod.paygBody')
                : t('deployments:billingMethod.prepaidBody')}
            </Text>
          </Space>
          {canSwitchMethod && deployment.status !== 'terminated' && (isPayg || paygAvailable) && (
            <Button
              icon={<SwapOutlined />}
              loading={acting === `billing-${isPayg ? 'prepaid' : 'payg'}`}
              onClick={() => switchBillingMethod(isPayg ? 'prepaid' : 'payg')}
            >
              {isPayg ? t('deployments:billingMethod.switchToPrepaid') : t('deployments:billingMethod.switchToPayg')}
            </Button>
          )}
        </Space>
      </Card>

      <Card
        title={
          <Space size={12} align="center">
            <span>{t('deployments:history.title')}</span>
            {usage?.trend?.length >= 2 && (
              <Sparkline values={usage.trend.map((t) => t.amount)} width={90} height={26} />
            )}
          </Space>
        }
        extra={usage ? (
          <Tooltip title={t('deployments:history.billedUpTo', { clock: formatClock(usage.totals?.billedThrough) })}>
            <Text type="secondary">
              {formatHours(usage.totals?.hours || 0)} · {currency} {formatAmount((usage.totals?.cost || 0))} billed
            </Text>
          </Tooltip>
        ) : null}
        style={card}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          className="ledger-table"
          columns={usageColumns}
          dataSource={usage?.recent || []}
          rowKey={(r) => r.id}
          pagination={(usage?.recent || []).length > 10 ? { pageSize: 10 } : false}
          locale={{ emptyText: t('deployments:history.none') }}
          scroll={{ x: 560 }}
        />
      </Card>
    </Space>
  );

  const activityContent = (
    <Card style={card} styles={{ body: { padding: 24 } }}>
      <Timeline
        items={(deployment.statusHistory || []).slice().reverse().map((h) => {
          const m = STATUS_META[h.status] || {};
          return {
            color: m.color === 'processing' ? 'blue' : m.color === 'default' ? 'gray' : m.color,
            children: (
              <Space direction="vertical" size={0}>
                <Text strong>{m.labelKey ? t(m.labelKey) : h.status}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(h.at)}</Text>
                {h.note && <Text style={{ fontSize: 12 }}>{h.note}</Text>}
              </Space>
            ),
          };
        })}
      />
    </Card>
  );

  return (
    <>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/deployments')} style={{ marginBottom: 16, paddingInlineStart: 0 }}>
        {t('deployments:detail.back')}
      </Button>

      {deployment.autoSuspendedForCredit && (
        <Alert
          type="warning"
          showIcon
          message={t('deployments:alerts.pausedNoCredit')}
          description={
            t('deployments:alerts.pausedNoCreditBody')
            + (money && deployment.stoppedPricePerHour > 0
              ? t('deployments:alerts.pausedNoCreditDisk', {
                storageGb: deployment.tier?.storageGb || '',
                rate: `${currency} ${formatRate(deployment.stoppedPricePerHour)}`,
              })
              : '')
          }
          action={money ? (
            <Space>
              {canSwitchMethod && deployment.paygOfferedAt && deployment.billingMethod === 'prepaid' && paygAvailable && (
                <Button
                  size="small"
                  loading={acting === 'billing-payg'}
                  onClick={() => switchBillingMethod('payg')}
                >
                  {t('deployments:billingMethod.switchToPayg')}
                </Button>
              )}
              <Button size="small" type="primary" onClick={() => navigate('/billing?tab=credits')}>{t('common:action.addCredit')}</Button>
            </Space>
          ) : <Text type="secondary" style={{ fontSize: 12 }}>{t('deployments:alerts.askBilling')}</Text>}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {deployment.debtLimitSuspended && (
        <Alert
          type="error"
          showIcon
          message={t('deployments:alerts.pausedDebtLimit')}
          description={t('deployments:alerts.pausedDebtLimitBody')}
          action={money ? (
            <Button size="small" type="primary" onClick={() => navigate('/billing?tab=credits')}>
              {t('common:action.addCredit')}
            </Button>
          ) : <Text type="secondary" style={{ fontSize: 12 }}>{t('deployments:alerts.askBilling')}</Text>}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {deployment.cardGateSuspended && (
        <Alert
          type="warning"
          showIcon
          message={t('deployments:alerts.pausedCardRequired')}
          description={t('deployments:alerts.pausedCardRequiredBody')}
          action={money
            ? <Button size="small" type="primary" onClick={() => navigate('/billing?tab=cards')}>{t('common:action.addCard')}</Button>
            : <Text type="secondary" style={{ fontSize: 12 }}>{t('deployments:alerts.askBilling')}</Text>}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {storageGrace && (
        <Alert
          type={storageGrace.daysRemaining <= 1 ? 'error' : 'warning'}
          showIcon
          message={
            storageGrace.enabled
              ? t('deployments:alerts.storageGraceDaysLeft', { count: storageGrace.daysRemaining })
              : t('deployments:alerts.unpaidStorage')
          }
          description={storageGrace.message}
          action={money
            ? <Button size="small" type="primary" onClick={() => navigate('/billing?tab=credits')}>{t('common:action.addCredit')}</Button>
            : <Text type="secondary" style={{ fontSize: 12 }}>{t('deployments:alerts.askBilling')}</Text>}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {/*
        The warning half. A machine is stopped the instant the balance runs out,
        which is the correct behaviour but a nasty surprise if the first you
        hear of it is the deployment already being paused.

        Only shown for a PREPAID deployment — pay-as-you-go never pauses for
        balance (a shortfall becomes debt instead, see deploymentBilling.js),
        so telling a payg deployment "this will pause" would be simply wrong.
      */}
      {deployment.status === 'running' && !isPayg && wallet?.isLow && wallet.runwayHours !== null && (
        <Alert
          type={wallet.runwayHours < 6 ? 'error' : 'warning'}
          showIcon
          message={
            wallet.runwayHours < 1
              ? t('deployments:alerts.willPauseWithinHour')
              : `About ${wallet.runwayHours < 48
                ? `${wallet.runwayHours.toFixed(1)} hours`
                : `${(wallet.runwayHours / 24).toFixed(1)} days`} of credit left`
          }
          description={
            t('deployments:alerts.lowBalanceBody', {
              balance: `${currency} ${formatAmount((wallet.balance ?? 0))}`,
              burnRate: `${currency} ${formatAmount((wallet.burnRatePerHour ?? 0))}`,
              stopAt: `${currency} ${formatAmount((wallet.stopAtBalance ?? 0))}`,
            })
          }
          action={<Button size="small" type="primary" onClick={() => navigate('/billing?tab=credits')}>{t('common:action.addCredit')}</Button>}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {/*
        The pay-as-you-go equivalent — same low-wallet trigger, but the
        correct explanation: this deployment keeps running, and the shortfall
        goes to the saved card / outstanding balance instead of pausing it.
      */}
      {deployment.status === 'running' && isPayg && wallet?.isLow && (
        <Alert
          type="info"
          showIcon
          message={t('deployments:alerts.lowBalance')}
          description={
            t('deployments:alerts.paygNeverPauses', { balance: `${currency} ${formatAmount(wallet.balance ?? 0)}` })
          }
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {deployment.status === 'rejected' && deployment.rejectionReason && (
        <Alert
          type="error"
          showIcon
          message={t('deployments:alerts.declined')}
          description={deployment.rejectionReason}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {['pending_review', 'approved', 'provisioning'].includes(deployment.status) && (
        <Alert
          type="info"
          showIcon
          message={
            deployment.status === 'pending_review'
              ? t('deployments:alerts.underReview')
              : t('deployments:alerts.beingSetUp')
          }
          description={t('deployments:alerts.emailWhenLive')}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={load}>{t('common:action.refresh')}</Button>}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {/* Header */}
      <Card style={{ ...card, marginBottom: 20 }} styles={{ body: { padding: '20px 24px' } }}>
        <Row align="middle" gutter={[16, 12]} justify="space-between">
          <Col>
            <Space size={10} align="center" wrap style={{ marginBottom: 4 }}>
              <Title level={3} style={{ margin: 0 }}>{deployment.deploymentName}</Title>
              <StatusBadge tone={STATUS_TONE[deployment.status] || 'neutral'} label={meta.labelKey ? t(meta.labelKey) : deployment.status} pulse={isLive} />
              <BillingMethodTag deployment={deployment} acting={acting} onSwitch={switchBillingMethod} paygAvailable={paygAvailable} canSwitch={canSwitchMethod} />
            </Space>
            <div>
              <Text type="secondary">
                {t('deployments:detail.modelOnMachine', { model: deployment.model?.name, machine: deployment.tier?.name })} · {deployment.region}
              </Text>
            </div>
          </Col>
          <Col>
            <Space wrap>
              {canOperate && isLive && (
                <Button icon={<PauseCircleOutlined />} loading={acting === 'pause'} onClick={() => act('pause')}>
                  {t('common:action.pause')}
                </Button>
              )}
              {canOperate && ['paused', 'stopped'].includes(deployment.status) && (
                <Button type="primary" icon={<PlayCircleOutlined />} loading={acting === 'resume'} onClick={() => act('resume')}>
                  {t('common:action.resume')}
                </Button>
              )}
              {canOperate && ['running', 'paused'].includes(deployment.status) && (
                <Popconfirm title={t('deployments:confirm.stopTitle')} description={t('deployments:confirm.stopBodyShort')} onConfirm={() => act('stop')}>
                  <Button icon={<StopOutlined />} loading={acting === 'stop'}>{t('common:action.stop')}</Button>
                </Popconfirm>
              )}
              {(can('deployments.terminate') || (can('deployments.terminateOwn') && deployment.createdByMe))
                && deployment.status !== 'terminated' && (
                <Popconfirm
                  title={t('deployments:confirm.terminateTitle')}
                  description={t('deployments:confirm.terminateBodyShort')}
                  okButtonProps={{ danger: true }}
                  onConfirm={() => act('terminate')}
                >
                  <Button danger icon={<DeleteOutlined />} loading={acting === 'terminate'}>{t('common:action.terminate')}</Button>
                </Popconfirm>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Cost stats — cross-cutting, so it stays visible above the tabs
          rather than living inside just one of them. */}
      <StatRow style={{ marginBottom: 8 }}>
        {money && (
        <StatCard
          icon={<ThunderboltOutlined />}
          tone="pink"
          label={t('deployments:detail.hourlyRate')}
          value={formatRate(deployment.effectiveRate)}
          suffix={currency}
          caption={deployment.planDiscountPercent > 0
            ? `Includes ${deployment.planDiscountPercent}% plan discount`
            : t('deployments:detail.hourlyCaption')}
        />
        )}
        {/*
          * Both of these stop at the billing watermark, so both now say so and
          * say what is still on the clock behind it. Left as bare totals they
          * looked stale or plain wrong — a deployment up for fifty minutes
          * showing less runtime than one started half an hour later whose bill
          * had been settled when it was stopped.
          */}
        <StatCard
          icon={<ClockCircleOutlined />}
          tone="cyan"
          label={t('deployments:detail.billedRuntime')}
          value={formatHours(deployment.totalRuntimeHours || 0).replace(/h$/, '')}
          suffix={t('common:label.hours')}
          caption={unbilled
            ? t('deployments:detail.plusSinceNotBilled', { duration: humanDuration(unbilled.hours), clock: formatClock(usage?.totals?.billedThrough) })
            : t('deployments:detail.chargedUpTo', { clock: formatClock(deployment.lastBilledAt) })}
        />
        {money && (
        <StatCard
          icon={<DollarOutlined />}
          tone="purple"
          label={t('deployments:detail.totalSpent')}
          value={formatAmount((deployment.totalCost || 0))}
          suffix={currency}
          caption={unbilled
            ? t('deployments:detail.plusUsedSinceLastRun', { amount: `${currency} ${formatAmount(unbilled.cost)}` })
            : t('deployments:detail.totalCaption')}
        />
        )}
        <StatCard
          icon={<CalendarOutlined />}
          tone="blue"
          label={t('deployments:detail.startedOn')}
          value={deployment.startedAt
            ? formatDate(deployment.startedAt, 'monthDay')
            : t('deployments:detail.notYet')}
          caption={deployment.startedAt ? t('deployments:detail.startedCaption') : t('deployments:detail.notStartedCaption')}
        />
      </StatRow>

      {/*
        Tabbed rather than one long stacked page — keeps each screen to one
        job (configure, pay, watch history), and leaves an obvious slot for a
        future Metrics tab once per-deployment monitoring exists, instead of
        the page growing taller every time something is added to it.
      */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'overview', label: t('deployments:tabs.overview'), children: overviewContent },
          ...(money ? [{ key: 'billing', label: t('deployments:tabs.billing'), children: billingContent }] : []),
          { key: 'activity', label: t('deployments:tabs.activity'), children: activityContent },
        ]}
      />

      <Modal
        title={t('deployments:config.requirementsTitle')}
        open={requirementsOpen}
        onCancel={() => setRequirementsOpen(false)}
        footer={<Button onClick={() => setRequirementsOpen(false)}>{t('common:action.close')}</Button>}
      >
        {(deployment.requirements || []).length === 0 ? (
          <Text type="secondary">{t('deployments:config.noRequirements')}</Text>
        ) : (
          <Descriptions column={1} size="small" bordered>
            {deployment.requirements.map((r) => (
              <Descriptions.Item key={r.questionKey} label={r.question}>
                {Array.isArray(r.answer)
                  ? r.answer.join(', ')
                  : typeof r.answer === 'boolean'
                    ? (r.answer ? 'Yes' : 'No')
                    : String(r.answer ?? '—')}
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Modal>
    </>
  );
};

export default DeploymentDetailPage;
