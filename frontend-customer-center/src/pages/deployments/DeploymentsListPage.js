import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Typography, Button, Space, Empty, Alert, Row, Col,
  Popconfirm, Tooltip, message,
} from 'antd';
import {
  RocketOutlined, PauseCircleOutlined, PlayCircleOutlined, StopOutlined,
  DeleteOutlined, ThunderboltOutlined, PlusOutlined, DollarOutlined, WalletOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import { StatRow, StatCard } from '../../components/StatRow';
import { TableRowsSkeleton } from '../../components/Skeletons';
import deploymentsApi from '../../api/deploymentsApi';
import walletApi from '../../api/walletApi';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import { useTeam } from '../../context/TeamContext';
import { cardStyle as surfaceStyle, monoNumeric, ltrTechnical } from '../../theme/colors';
import { formatHours, humanDuration, formatClock } from '../../utils/duration';
import { formatRate, formatAmount } from '../../utils/money';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

/**
 * The status vocabulary, shared by this page, the deployment detail page and
 * the dashboard.
 *
 * Holds a translation *key*, not a label. This is a module-level constant, so
 * there is no `t` in scope where it is written, and a string resolved once at
 * import time could never follow a later language change anyway. Every call
 * site does `t(meta.labelKey)`.
 */
export const STATUS_META = {
  pending_review: { color: 'blue', labelKey: 'common:status.pending_review' },
  approved: { color: 'cyan', labelKey: 'common:status.approved' },
  rejected: { color: 'red', labelKey: 'common:status.rejected' },
  provisioning: { color: 'processing', labelKey: 'common:status.provisioning' },
  running: { color: 'green', labelKey: 'common:status.running' },
  paused: { color: 'orange', labelKey: 'common:status.paused' },
  stopped: { color: 'default', labelKey: 'common:status.stopped' },
  failed: { color: 'red', labelKey: 'common:status.failed' },
  terminated: { color: 'default', labelKey: 'common:status.terminated' },
};

// Semantic tone for the dot-badge treatment — independent from STATUS_META's
// antd Tag colors, which some call sites still use directly.
export const STATUS_TONE = {
  pending_review: 'info',
  approved: 'info',
  rejected: 'error',
  provisioning: 'info',
  running: 'success',
  paused: 'warning',
  stopped: 'neutral',
  failed: 'error',
  terminated: 'neutral',
};

const DeploymentsListPage = () => {
  const { t } = useTranslation(['deployments', 'common']);
  const navigate = useNavigate();
  const { isDark } = useTheme();
  // `creditsEnabled` is false for a team member who may not see money — the
  // rate and spend columns and tiles go with it (the server sends none).
  const { currency, creditsEnabled } = useBilling();
  const { can } = useTeam();
  const canOperate = can('deployments.operate');
  const canTerminate = (row) => can('deployments.terminate') || (can('deployments.terminateOwn') && row.createdByMe);

  const [deployments, setDeployments] = useState([]);
  const [burnRate, setBurnRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [error, setError] = useState(null);
  const [wallet, setWallet] = useState(null);

  useEffect(() => {
    if (!creditsEnabled) return;
    walletApi.get().then((data) => setWallet(data.wallet)).catch(() => {});
  }, [creditsEnabled]);

  const load = useCallback(() => {
    setLoading(true);
    deploymentsApi
      .list({ limit: 100 })
      .then((data) => {
        setDeployments(data.deployments || []);
        setBurnRate(data.burnRatePerHour || 0);
        setError(null);
      })
      .catch((err) => setError(err.response?.data?.message || t('deployments:list.loadFailed')))
      .finally(() => setLoading(false));
    // `t` belongs here: its identity changes with the language, so the list
    // reloads on a switch rather than leaving a failure message stranded in
    // the previous one.
  }, [t]);

  useEffect(load, [load]);

  const act = async (id, action) => {
    setActing(`${id}:${action}`);
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

  const card = surfaceStyle(isDark);

  const running = deployments.filter((d) => d.status === 'running').length;
  const totalSpend = deployments.reduce((sum, d) => sum + (d.totalCost || 0), 0);
  const outstanding = Number(wallet?.outstandingBalance) || 0;

  /**
   * A paused deployment can carry more than one of these flags at once (a
   * debt-limit pause doesn't clear the credit flag that preceded it, say),
   * and the two that used to be checked here were an arbitrary subset of
   * four that actually exist. One ranked pick — most account-wide and least
   * self-resolving first — instead of stacking every true flag as its own
   * line, which reads as more wrong than paused.
   */
  const pauseReason = (row) => {
    if (row.debtLimitSuspended) return t('deployments:list.debtLimitPaused');
    if (row.cardGateSuspended) return t('deployments:list.cardRequired');
    if (row.autoSuspendedForCredit) return t('deployments:list.outOfCredit');
    if (row.hasUnpaidStorage) return t('deployments:list.unpaidStorage');
    return null;
  };

  const BILLING_METHOD_LABEL = {
    prepaid: 'deployments:billingMethod.prepaid',
    payg: 'deployments:billingMethod.payg',
  };

  const columns = [
    {
      title: t('deployments:list.columnDeployment'),
      dataIndex: 'deploymentName',
      render: (name, row) => (
        <Space direction="vertical" size={0}>
          <Button type="link" style={{ padding: 0, height: 'auto', fontWeight: 600 }} onClick={() => navigate(`/deployments/${row.id}`)}>
            {name}
          </Button>
          {/* Identifiers, not prose — pinned ltr so RTL truncates the end. */}
          <Text type="secondary" style={{ fontSize: 12, ...ltrTechnical }}>
            {row.model?.name} · {row.tier?.name}
            {row.billingMethod && BILLING_METHOD_LABEL[row.billingMethod] && (
              <> · {t(BILLING_METHOD_LABEL[row.billingMethod])}</>
            )}
          </Text>
        </Space>
      ),
    },
    {
      title: t('common:label.status'),
      dataIndex: 'status',
      width: 160,
      render: (status, row) => {
        const meta = STATUS_META[status] || {};
        const tone = STATUS_TONE[status] || 'neutral';
        const reason = pauseReason(row);
        return (
          <Space direction="vertical" size={2}>
            <StatusBadge tone={tone} label={meta.labelKey ? t(meta.labelKey) : status} pulse={status === 'running'} />
            {reason && <Text type="danger" style={{ fontSize: 11 }}>{reason}</Text>}
          </Space>
        );
      },
    },
    {
      money: true,
      title: t('common:label.rate'),
      dataIndex: 'effectiveRate',
      // Three decimals — the precision the charge is actually computed at, and
      // what every other rate in billing shows. Wide enough that "USD 15.492"
      // stays on one line; at 110px it was wrapping mid-figure.
      width: 140,
      align: 'right',
      render: (rate) => (
        <Text style={{ whiteSpace: 'nowrap', ...monoNumeric }}>
          {currency} {formatRate(rate)}
          <Text type="secondary" style={{ fontSize: 11 }}>{t('common:units.perHour')}</Text>
        </Text>
      ),
    },
    {
      // "Billed" rather than "Runtime": the figure only moves when the hourly
      // billing job runs, so a machine up for fifty minutes can legitimately
      // show less than one started later whose bill was settled on a stop.
      // Calling it runtime made that look like a bug.
      title: t('deployments:list.columnBilledRuntime'),
      dataIndex: 'totalRuntimeHours',
      width: 130,
      align: 'right',
      render: (h, row) => (
        <Tooltip title={t('deployments:list.billedRuntimeTooltip', { duration: humanDuration(h || 0), clock: formatClock(row.lastBilledAt) })}>
          <Text type="secondary" style={monoNumeric}>{formatHours(h || 0)}</Text>
        </Tooltip>
      ),
    },
    {
      money: true,
      title: t('deployments:list.columnSpent'),
      dataIndex: 'totalCost',
      width: 110,
      align: 'right',
      render: (c) => <Text strong style={monoNumeric}>{currency} {formatAmount((c || 0))}</Text>,
    },
    {
      title: t('common:label.actions'),
      key: 'actions',
      width: 220,
      render: (_, row) => {
        const busy = (a) => acting === `${row.id}:${a}`;
        return (
          <Space size={4}>
            {canOperate && row.status === 'running' && (
              <Button size="small" icon={<PauseCircleOutlined />} loading={busy('pause')} onClick={() => act(row.id, 'pause')}>
                {t('common:action.pause')}
              </Button>
            )}
            {canOperate && (row.status === 'paused' || row.status === 'stopped') && (
              <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={busy('resume')} onClick={() => act(row.id, 'resume')}>
                {t('common:action.resume')}
              </Button>
            )}
            {canOperate && ['running', 'paused'].includes(row.status) && (
              <Popconfirm
                title={t('deployments:confirm.stopTitle')}
                description={t('deployments:confirm.stopBody')}
                onConfirm={() => act(row.id, 'stop')}
              >
                <Button size="small" icon={<StopOutlined />} loading={busy('stop')}>{t('common:action.stop')}</Button>
              </Popconfirm>
            )}
            {canTerminate(row) && row.status !== 'terminated' && (
              <Popconfirm
                title={t('deployments:confirm.terminateTitle')}
                description={t('deployments:confirm.terminateBody')}
                okButtonProps={{ danger: true }}
                onConfirm={() => act(row.id, 'terminate')}
              >
                <Button size="small" danger icon={<DeleteOutlined />} loading={busy('terminate')} />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={2} style={{ marginBottom: 4 }}>{t('deployments:list.title')}</Title>
          <Text type="secondary">{t('deployments:list.subtitle')}</Text>
        </Col>
        {can('deployments.create') && (
          <Col>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/deploy')}>
              {t('common:action.newDeployment')}
            </Button>
          </Col>
        )}
      </Row>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 20, borderRadius: 12 }} />}

      <StatRow>
        <StatCard
          count={4} sm={12}
          icon={<RocketOutlined />}
          tone="green"
          label={t('deployments:list.runningNow')}
          value={running}
          caption={t('deployments:list.deploymentsInTotal', { count: deployments.length })}
        />
        {creditsEnabled && (
        <StatCard
          count={4} sm={12}
          icon={<ThunderboltOutlined />}
          tone="pink"
          label={t('deployments:list.currentBurnRate')}
          value={formatAmount(burnRate)}
          suffix={`${currency}${t('common:units.perHour')}`}
          caption={t('deployments:list.perDayAtThisRate', { amount: `${currency} ${formatAmount(burnRate * 24)}` })}
        />
        )}
        {creditsEnabled && (
        <StatCard
          count={4} sm={12}
          icon={<DollarOutlined />}
          tone="purple"
          label={t('deployments:list.totalSpent')}
          value={formatAmount(totalSpend)}
          suffix={currency}
          caption={t('deployments:list.totalCaption')}
        />
        )}
        {creditsEnabled && (
          <StatCard
            count={4} sm={12}
            icon={<WalletOutlined />}
            tone={outstanding > 0 ? 'amber' : 'green'}
            label={t('deployments:list.outstanding')}
            value={formatAmount(outstanding)}
            suffix={currency}
          />
        )}
      </StatRow>

      {loading ? (
        <TableRowsSkeleton rows={5} />
      ) : (
      <Card style={card} styles={{ body: { padding: 0 } }}>
        <Table
          className="ledger-table"
          columns={columns.filter((c) => creditsEnabled || !c.money).map(({ money, ...c }) => c)}
          dataSource={deployments}
          rowKey="id"
          rowClassName="row-hover"
          pagination={deployments.length > 20 ? { pageSize: 20 } : false}
          scroll={{ x: 900 }}
          locale={{
            emptyText: (
              <Empty
                description={t('deployments:list.empty')}
                style={{ padding: 40 }}
              >
                <Button type="primary" icon={<RocketOutlined />} onClick={() => navigate('/models')}>
                  {t('common:action.browseModels')}
                </Button>
              </Empty>
            ),
          }}
        />
      </Card>
      )}
    </>
  );
};

export default DeploymentsListPage;
