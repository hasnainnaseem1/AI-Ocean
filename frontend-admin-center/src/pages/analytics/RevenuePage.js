import React from 'react';
import {
  Row, Col, Card, Table, Tag, Space, Typography, Button, Alert, Empty, Statistic, Progress,
} from 'antd';
import {
  ReloadOutlined, DollarOutlined, WalletOutlined, AccountBookOutlined,
  CreditCardOutlined, WarningOutlined, RiseOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import TabHeader from '../../components/analytics/TabHeader';
import ChartCard from '../../components/charts/ChartCard';
import TimeSeriesChart from '../../components/charts/TimeSeriesChart';
import DistributionChart from '../../components/charts/DistributionChart';
import AgingBars from '../../components/charts/AgingBars';
import MetricLegend from '../../components/charts/MetricLegend';
import { StatRow, StatCard } from '../../components/StatRow';
import { StatCardsSkeleton, TableRowsSkeleton } from '../../components/Skeletons';
import revenueApi from '../../api/revenueApi';
import useAnalyticsQuery from '../../hooks/useAnalyticsQuery';
import useAnalyticsWindow from '../../hooks/useAnalyticsWindow';
import PeriodPicker from '../../components/analytics/PeriodPicker';
import ExportButton from '../../components/analytics/ExportButton';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted, monoNumeric } from '../../theme/colors';
import { formatNumber } from '../../utils/helpers';

const { Text } = Typography;

const money = (v) => `$${formatNumber(Number(v || 0).toFixed(2))}`;

/**
 * The money.
 *
 * Built around one distinction the old Analytics page never made: **cash in is
 * not revenue**. A top-up is money received into a wallet; a usage charge is
 * money the platform earned by running a machine. They are different numbers,
 * they move independently, and reporting either one as "revenue" hides the
 * situation this platform is actually in — where usage can be billed straight
 * to debt and earn nothing at all.
 *
 * So the page leads with earned vs collected side by side, and the funding
 * split (wallet vs debt) sits immediately under it, because that ratio is the
 * difference between a healthy month and an expensive one.
 */
const RevenuePage = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { params: windowParams, key: windowKey, picker } = useAnalyticsWindow();

  const { data, errors, loading, failedCount, reload } = useAnalyticsQuery({
    summary: () => revenueApi.getSummary(windowParams),
    trend: () => revenueApi.getTrend(windowParams),
    recurring: () => revenueApi.getRecurring(windowParams),
    wallets: () => revenueApi.getWallets(windowParams),
    receivables: () => revenueApi.getReceivables(windowParams),
    payments: () => revenueApi.getPayments(windowParams),
    dunning: () => revenueApi.getDunning(windowParams),
    gateway: () => revenueApi.getByDimension({ ...windowParams, by: 'gateway' }),
    byTier: () => revenueApi.getByDimension({ ...windowParams, by: 'tier' }),
    topAccounts: () => revenueApi.getTopAccounts({ ...windowParams, limit: 8 }),
  }, [windowKey]);

  const s = data.summary;
  const wallets = data.wallets;
  const rec = data.receivables;
  const dunning = data.dunning;
  const recurring = data.recurring;
  const windowLabel = s?.window ? `${s.window.label} · ${s.window.timezone}` : '';

  const debtShare = s?.funding?.debtSharePercent ?? 0;

  const accountColumns = [
    {
      title: 'Account',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name, r) => (
        <div>
          <Space size={6}>
            <Text strong style={{ fontSize: 12.5 }}>{name}</Text>
            {r.kind === 'team' && <Tag style={{ marginInlineEnd: 0 }}>org</Tag>}
            {r.disputeHold && <Tag color="red" style={{ marginInlineEnd: 0 }}>hold</Tag>}
          </Space>
          <div><Text style={{ fontSize: 11, color: muted(isDark) }}>{r.ownerEmail || '—'}</Text></div>
        </div>
      ),
    },
    {
      title: 'Earned', dataIndex: 'earned', key: 'earned', width: 110, align: 'right',
      render: (v) => <span style={monoNumeric}>{money(v)}</span>,
    },
    {
      title: 'Topped up', dataIndex: 'topUps', key: 'topUps', width: 110, align: 'right',
      render: (v) => <span style={monoNumeric}>{money(v)}</span>,
    },
    {
      title: 'Owes', dataIndex: 'outstanding', key: 'outstanding', width: 110, align: 'right',
      render: (v) => (Number(v) > 0
        ? <Text type="danger" style={monoNumeric}>{money(v)}</Text>
        : <Text type="secondary">—</Text>),
    },
  ];

  const SUBTITLE = 'What the platform earned, what it collected, and what it is still owed';
  const toolbar = (
    <>
      <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={() => reload({ quiet: true })}>
        Refresh
      </Button>
      <PeriodPicker {...picker} />
      <ExportButton tab="revenue" params={windowParams} />
    </>
  );
  const header = embedded ? <TabHeader subtitle={SUBTITLE} extra={toolbar} /> : (
    <PageHeader
      title="Revenue & billing"
      subtitle={SUBTITLE}
      breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Analytics', path: '/analytics' }, { label: 'Revenue' }]}
      extra={<Space>{toolbar}</Space>}
    />
  );

  return (
    <div>
      {header}

      {failedCount > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 14, borderRadius: 10 }}
          message={`${failedCount} section${failedCount === 1 ? '' : 's'} could not be loaded`}
          description={Object.entries(errors).map(([k, m]) => `${k}: ${m}`).join(' · ')}
          action={<Button size="small" onClick={() => reload()}>Retry</Button>}
        />
      )}

      {/* ── Earned vs collected, and how it was funded ── */}
      {loading && !s ? <StatCardsSkeleton count={4} /> : (
        <StatRow>
          <StatCard
            count={4} tone="green" icon={<DollarOutlined />}
            label="Earned" value={money(s?.grossRevenue)} delta={s?.delta?.grossRevenue}
            caption="Billed for machines run and seats held"
          />
          <StatCard
            count={4} tone="amber" icon={<WalletOutlined />}
            label="Collected" value={money(s?.topUps)} delta={s?.delta?.topUps}
            caption="Money added to wallets — not the same as earned"
            onClick={() => navigate('/wallets')}
          />
          <StatCard
            count={4} tone="pink" icon={<AccountBookOutlined />}
            label="Still owed" value={money(rec?.outstanding)}
            caption={rec?.accounts ? `across ${rec.accounts} account${rec.accounts === 1 ? '' : 's'}` : 'Nothing outstanding'}
            onClick={() => navigate('/receivables')}
          />
          <StatCard
            count={4} tone="purple" icon={<RiseOutlined />}
            label="Revenue per account" value={money(s?.arpa)}
            caption={`${s?.payingAccounts ?? 0} account${s?.payingAccounts === 1 ? '' : 's'} were charged this period`}
          />
        </StatRow>
      )}

      {/*
        The single most consequential ratio on the platform, given its own
        banner rather than a chart: usage billed straight to debt earns
        nothing until somebody collects it.
      */}
      {s && debtShare > 0 && (
        <Card size="small" style={{ marginTop: 14 }}>
          <Row gutter={[16, 10]} align="middle">
            <Col xs={24} md={10}>
              <Text strong style={{ fontSize: 13.5 }}>How this period&apos;s usage was funded</Text>
              <div style={{ marginTop: 6 }}>
                <Progress
                  percent={100}
                  success={{ percent: 100 - debtShare }}
                  strokeColor={STATUS_COLORS.error[isDark ? 'dark' : 'light']}
                  showInfo={false}
                  size="small"
                />
              </div>
              <Text style={{ fontSize: 11.5, color: muted(isDark) }}>
                {money(s.funding.fromWallet)} paid from wallets · {money(s.funding.toDebt)} billed to debt
              </Text>
            </Col>
            <Col xs={24} md={14}>
              <Text style={{
                fontSize: 13,
                color: debtShare > 50 ? STATUS_COLORS.error[isDark ? 'dark' : 'light'] : undefined,
              }}
              >
                <b>{debtShare}%</b> of what was billed this period went onto debt rather than coming
                out of a wallet.
                {debtShare > 50 && ' Most of what the platform earned has not been collected.'}
              </Text>
              <MetricLegend definition="Taken from how each usage tick was actually funded, not from the deployment's current billing method — which may have changed since." />
            </Col>
          </Row>
        </Card>
      )}

      {/* ── Movement over time ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={16}>
          <ChartCard
            title="Money movement"
            subtitle="What came in against what was charged"
            loading={loading && !data.trend}
            error={errors.trend}
            onRetry={() => reload()}
            empty={!(data.trend?.series || []).some((r) => r.topUps || r.charges)}
            definition="Top-ups are money received. Charges are what was billed for usage. Refunds are money returned."
            window={windowLabel}
            height={260}
          >
            <TimeSeriesChart
              data={data.trend?.series || []}
              series={[
                { field: 'topUps', label: 'Top-ups' },
                { field: 'charges', label: 'Charged' },
                { field: 'refunds', label: 'Refunds' },
              ]}
              height={260}
              valueFormat={(v) => `$${formatNumber(Number(v).toFixed(0))}`}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title={<Text strong style={{ fontSize: 14 }}>Recurring revenue</Text>}>
            <Row gutter={10}>
              <Col span={12}>
                <Statistic title="MRR" value={recurring?.mrr ?? 0} prefix="$"
                  valueStyle={{ fontSize: 20, color: TILE.green.fg(isDark) }} />
              </Col>
              <Col span={12}>
                <Statistic title="ARR" value={recurring?.arr ?? 0} prefix="$"
                  valueStyle={{ fontSize: 20 }} />
              </Col>
            </Row>
            <div style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 11.5, color: muted(isDark) }}>
                {recurring?.payingAccounts ?? 0} paying accounts · {money(recurring?.arpa)} each
              </Text>
            </div>
            <MetricLegend
              definition={recurring?.definition}
              caveat="This platform has no subscriptions, so MRR is an annualised view of metered usage rather than contracted revenue."
            />
          </Card>
        </Col>
      </Row>

      {/* ── Receivables ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={8}>
          <Card
            size="small"
            title={<Space size={7}><AccountBookOutlined style={{ color: TILE.pink.fg(isDark) }} />
              <Text strong style={{ fontSize: 14 }}>How old the debt is</Text></Space>}
            extra={<Button type="link" size="small" onClick={() => navigate('/receivables')}>Chase</Button>}
          >
            {loading && !rec ? <TableRowsSkeleton rows={3} /> : (
              <>
                <AgingBars buckets={rec?.aging || []} total={rec?.outstanding} />
                {rec?.dso !== null && rec?.dso !== undefined && (
                  <Text style={{ fontSize: 11.5, color: muted(isDark), display: 'block', marginTop: 10 }}>
                    At this period&apos;s earning rate that is <b>{rec.dso} days</b> of revenue uncollected.
                  </Text>
                )}
                <MetricLegend
                  definition="Aged from the day each account first went into debt. Buckets are set in the analytics policy."
                  caveat={rec?.concentration?.[0]?.sharePercent >= (rec?.concentrationWarnPercent ?? 20)
                    ? `${rec.concentration[0].sharePercent}% of everything owed sits with one account.`
                    : undefined}
                />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <ChartCard
            title="Debt movement"
            subtitle="What was accrued, settled and written off"
            loading={loading && !rec}
            error={errors.receivables}
            onRetry={() => reload()}
            empty={!(rec?.movement || []).some((r) => r.accrued || r.settled || r.writtenOff)}
            definition="Accrued is usage billed to debt. Settled is debt collected. Written off is debt the platform gave up on."
            window={windowLabel}
            height={230}
          >
            <TimeSeriesChart
              data={rec?.movement || []}
              kind="column"
              series={[
                { field: 'accrued', label: 'Accrued' },
                { field: 'settled', label: 'Settled' },
                { field: 'writtenOff', label: 'Written off' },
              ]}
              height={230}
              valueFormat={(v) => `$${formatNumber(Number(v).toFixed(0))}`}
            />
          </ChartCard>
        </Col>
      </Row>

      {/* ── Wallets, gateway mix, what earns ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={8}>
          <ChartCard
            title="Wallet balances held"
            subtitle="Rebuilt from the ledger, not a snapshot"
            loading={loading && !wallets}
            error={errors.wallets}
            onRetry={() => reload()}
            empty={(wallets?.series || []).length < 2}
            emptyText="Not enough ledger movement to plot a balance history yet"
            definition={wallets?.definition}
            window={windowLabel}
            height={200}
          >
            <TimeSeriesChart
              data={wallets?.series || []}
              kind="area"
              series={[
                { field: 'balance', label: 'Held in wallets' },
                { field: 'outstanding', label: 'Owed to us' },
              ]}
              height={200}
              valueFormat={(v) => `$${formatNumber(Number(v).toFixed(0))}`}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title={<Text strong style={{ fontSize: 14 }}>Where the money came in</Text>}>
            <DistributionChart
              rows={data.gateway?.rows || []}
              valueField="amount"
              valueFormat={money}
              emptyText="No top-ups in this period"
            />
            <MetricLegend definition="Attributed from the credit ledger — the payments table has no gateway column at all." window={windowLabel} />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title={<Text strong style={{ fontSize: 14 }}>What earned the money</Text>}>
            <DistributionChart
              rows={data.byTier?.rows || []}
              valueField="amount"
              valueFormat={money}
              emptyText="Nothing billed in this period"
            />
            <MetricLegend definition="Billed usage by machine type. Custom builds are grouped together." window={windowLabel} />
          </Card>
        </Col>
      </Row>

      {/* ── Can we still collect? ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={<Space size={7}><CreditCardOutlined style={{ color: TILE.amber.fg(isDark) }} />
              <Text strong style={{ fontSize: 14 }}>Can we still collect?</Text></Space>}
            extra={<Button type="link" size="small" onClick={() => navigate('/wallets')}>Wallets</Button>}
          >
            {loading && !dunning ? <TableRowsSkeleton rows={3} /> : (
              <>
                <Row gutter={10} style={{ marginBottom: 10 }}>
                  <Col span={8}>
                    <Statistic title="No card on file" value={dunning?.accountsWithNoMethod ?? 0}
                      suffix={`/ ${dunning?.totalAccounts ?? 0}`}
                      valueStyle={{
                        fontSize: 19,
                        color: (dunning?.accountsWithNoMethod ?? 0) > 0
                          ? STATUS_COLORS.warning[isDark ? 'dark' : 'light'] : undefined,
                      }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title={`Expiring in ${dunning?.expiringWithinDays ?? 30}d`} value={dunning?.expiringSoon ?? 0}
                      valueStyle={{ fontSize: 19 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Charges failing" value={dunning?.autoChargeFailures?.length ?? 0}
                      valueStyle={{ fontSize: 19 }} />
                  </Col>
                </Row>

                {(dunning?.autoChargeFailures || []).slice(0, 4).map((f) => (
                  <div key={f.teamId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
                    <Text style={{ fontSize: 11.5, minWidth: 0 }} ellipsis>
                      {f.name} — {f.failures} failed{f.lastError ? `: ${f.lastError}` : ''}
                    </Text>
                    {/* The amount must never wrap mid-figure — "$1,51 1.14"
                        is unreadable as money. */}
                    <Text style={{ ...monoNumeric, fontSize: 11.5, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {money(f.outstanding)}
                    </Text>
                  </div>
                ))}

                <MetricLegend
                  definition="An account with no card and a growing balance cannot be collected from automatically — the usage simply becomes debt."
                  caveat={(dunning?.accountsWithNoMethod ?? 0) > 0
                    ? `${dunning.accountsWithNoMethod} of ${dunning.totalAccounts} accounts have no payment method at all.`
                    : undefined}
                />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title={<Text strong style={{ fontSize: 14 }}>Gateway attempts</Text>}>
            <Row gutter={10}>
              <Col span={8}>
                <Statistic title="Succeeded" value={data.payments?.succeeded ?? 0} valueStyle={{ fontSize: 19 }} />
              </Col>
              <Col span={8}>
                <Statistic title="Failed" value={data.payments?.failed ?? 0}
                  valueStyle={{ fontSize: 19, color: (data.payments?.failed ?? 0) > 0 ? STATUS_COLORS.error[isDark ? 'dark' : 'light'] : undefined }} />
              </Col>
              <Col span={8}>
                <Statistic title="Success rate"
                  value={data.payments?.successRate ?? 0} suffix="%" valueStyle={{ fontSize: 19 }} />
              </Col>
            </Row>
            <MetricLegend
              definition="Counted from gateway payment attempts. A failed attempt has no paid date, so it is dated from when it was created."
              window={windowLabel}
              caveat={data.payments?.attempts === 0 ? 'No gateway attempts in this period.' : undefined}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Biggest accounts ── */}
      <Card size="small" style={{ marginTop: 14 }}
        title={<Text strong style={{ fontSize: 14 }}>Biggest accounts</Text>}
        extra={<Button type="link" size="small" onClick={() => navigate('/teams')}>Organizations</Button>}
      >
        <Table
          size="small"
          loading={loading && !data.topAccounts}
          dataSource={data.topAccounts?.accounts || []}
          columns={accountColumns}
          rowKey="teamId"
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing charged in this period" /> }}
        />
        <Text style={{ fontSize: 11, color: muted(isDark), display: 'block', marginTop: 8 }}>
          <WarningOutlined style={{ marginRight: 5, opacity: 0.6 }} />
          Grouped by account — an organization counts once, not once per member.
        </Text>
      </Card>
    </div>
  );
};

export default RevenuePage;
