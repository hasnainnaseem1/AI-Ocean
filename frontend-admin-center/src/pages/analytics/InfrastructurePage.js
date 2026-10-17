import React from 'react';
import {
  Row, Col, Card, Table, Tag, Space, Typography, Button, Alert, Empty, Statistic, Tooltip,
} from 'antd';
import {
  ReloadOutlined, ClusterOutlined, ThunderboltOutlined, WarningOutlined,
  BulbOutlined, BuildOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import TabHeader from '../../components/analytics/TabHeader';
import ChartCard from '../../components/charts/ChartCard';
import TimeSeriesChart from '../../components/charts/TimeSeriesChart';
import DistributionChart from '../../components/charts/DistributionChart';
import FunnelChart from '../../components/charts/FunnelChart';
import StockBar from '../../components/charts/StockBar';
import MetricLegend from '../../components/charts/MetricLegend';
import { StatRow, StatCard } from '../../components/StatRow';
import { StatCardsSkeleton, TableRowsSkeleton } from '../../components/Skeletons';
import infrastructureApi from '../../api/infrastructureApi';
import useAnalyticsQuery from '../../hooks/useAnalyticsQuery';
import useAnalyticsWindow from '../../hooks/useAnalyticsWindow';
import PeriodPicker from '../../components/analytics/PeriodPicker';
import ExportButton from '../../components/analytics/ExportButton';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted, monoNumeric } from '../../theme/colors';
import { formatNumber } from '../../utils/helpers';

const { Text } = Typography;

const money = (v) => `$${formatNumber(Number(v || 0).toFixed(2))}`;
const hours = (v) => `${formatNumber(Math.round(Number(v || 0)))}h`;

/**
 * Infrastructure analytics — the machines, not the money.
 *
 * Four questions, in the order an operator asks them:
 *   1. What can I not sell right now?        (stock)
 *   2. What is actually being used?           (consumption)
 *   3. Where do requests get stuck?           (lifecycle funnel)
 *   4. Is our own sizing advice any good?     (the engine's record)
 *
 * The fourth is the one nothing has ever shown. Every deployment already
 * records which tier the recommendation engine suggested and whether the
 * customer took it — the column has been filled in since the engine shipped
 * and never once read. It turns out to be the most pointed chart on the page.
 */
/**
 * `embedded` is set when this renders as a tab inside `/analytics` rather than
 * as a page of its own. The shell has already drawn the title and the
 * breadcrumbs, so a second heading here would just repeat what the tab bar
 * said; only the subtitle and this view's own controls remain.
 */
const InfrastructurePage = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { hasPermission } = usePermission();
  const canSeeRevenue = hasPermission(PERMISSIONS.ANALYTICS_REVENUE);

  const { params: windowParams, key: windowKey, picker } = useAnalyticsWindow();

  const { data, errors, loading, failedCount, reload } = useAnalyticsQuery({
    tiers: () => infrastructureApi.getTiers(windowParams),
    capacity: () => infrastructureApi.getCapacityTrend(windowParams),
    outages: () => infrastructureApi.getStockOutages(windowParams),
    consumption: () => infrastructureApi.getConsumption(windowParams),
    components: () => infrastructureApi.getComponents(windowParams),
    lifecycle: () => infrastructureApi.getLifecycle(windowParams),
    sizing: () => infrastructureApi.getSizingEffectiveness(windowParams),
    customBuilds: () => infrastructureApi.getCustomBuilds(windowParams),
  }, [windowKey]);

  const tiers = data.tiers?.tiers || [];
  const totals = data.tiers?.totals || {};
  const thresholds = data.tiers?.thresholds || {};
  const consumption = data.consumption;
  const lifecycle = data.lifecycle;
  const sizing = data.sizing;
  const builds = data.customBuilds;
  const windowLabel = data.tiers?.window
    ? `${data.tiers.window.label} · ${data.tiers.window.timezone}`
    : '';

  // Worst stock first — the list is read top-down and the top is the point.
  const RANK = { out: 0, critical: 1, low: 2, ok: 3, unlimited: 4 };
  const sortedTiers = [...tiers].sort(
    (a, b) => (RANK[a.stockLevel] ?? 9) - (RANK[b.stockLevel] ?? 9),
  );

  const tierColumns = [
    {
      title: 'Machine type',
      dataIndex: 'name',
      key: 'name',
      render: (name, r) => (
        <div>
          <Text strong style={{ fontSize: 12.5 }}>{name}</Text>
          <div><Text style={{ fontSize: 11, color: muted(isDark) }}>{r.gpu || r.category || '—'}</Text></div>
        </div>
      ),
    },
    {
      title: 'Stock',
      key: 'stock',
      width: 150,
      render: (_, r) => (r.stockLevel === 'unlimited'
        ? <Text type="secondary" style={{ fontSize: 12 }}>No ceiling set</Text>
        : (
          <Space size={6}>
            <Tag color={{ out: 'red', critical: 'red', low: 'orange', ok: 'green' }[r.stockLevel]}>
              {r.available}/{r.capacityTotal}
            </Tag>
            <Text style={{ fontSize: 11, color: muted(isDark) }}>{r.freePercent}% free</Text>
          </Space>
        )),
    },
    {
      title: 'Running',
      dataIndex: 'activeDeployments',
      key: 'activeDeployments',
      width: 90,
      align: 'right',
    },
    {
      title: 'Hours used',
      dataIndex: 'hoursInWindow',
      key: 'hoursInWindow',
      width: 110,
      align: 'right',
      render: (v) => <span style={monoNumeric}>{hours(v)}</span>,
    },
    ...(canSeeRevenue ? [{
      title: 'Earned',
      dataIndex: 'revenueInWindow',
      key: 'revenueInWindow',
      width: 110,
      align: 'right',
      render: (v) => <span style={monoNumeric}>{money(v)}</span>,
    }] : []),
  ];

  const SUBTITLE = 'Machine types, stock, what ran on them, and whether our sizing advice holds up';
  const toolbar = (
    <>
      <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={() => reload({ quiet: true })}>
        Refresh
      </Button>
      <PeriodPicker {...picker} />
      <ExportButton tab="infrastructure" params={windowParams} />
    </>
  );
  const header = embedded ? <TabHeader subtitle={SUBTITLE} extra={toolbar} /> : (
    <PageHeader
      title="Infrastructure"
      subtitle={SUBTITLE}
      breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Analytics', path: '/analytics' }, { label: 'Infrastructure' }]}
      extra={<Space>{toolbar}</Space>}
    />
  );

  return (
    <div>
      {header}

      {failedCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message={`${failedCount} section${failedCount === 1 ? '' : 's'} could not be loaded`}
          description={Object.entries(errors).map(([k, m]) => `${k}: ${m}`).join(' · ')}
          action={<Button size="small" onClick={() => reload()}>Retry</Button>}
        />
      )}

      {/* ── Headline: what can we not sell right now ── */}
      {loading && !data.tiers ? <StatCardsSkeleton count={4} /> : (
        <StatRow>
          <StatCard
            count={4} tone="blue" icon={<ClusterOutlined />}
            label="Machine types" value={totals.tiers ?? 0}
            caption={`${totals.capacityAllocated ?? 0} of ${totals.capacityTotal ?? 0} units allocated`}
            onClick={() => navigate('/tiers')}
          />
          <StatCard
            count={4} tone="pink" icon={<WarningOutlined />}
            label="Out of stock" value={totals.out ?? 0}
            caption={(totals.out ?? 0) > 0 ? 'Nobody can deploy these right now' : 'Everything is available'}
            onClick={() => navigate('/tiers')}
          />
          <StatCard
            count={4} tone="amber" icon={<WarningOutlined />}
            label="Running low" value={(totals.low ?? 0) + (totals.critical ?? 0)}
            caption={`Flagged below ${thresholds.lowPercent ?? 25}% free`}
          />
          <StatCard
            count={4} tone="purple" icon={<ThunderboltOutlined />}
            label="Machine hours" value={hours(consumption?.byKind?.compute?.hours)}
            caption="Billed compute time in this period"
          />
        </StatRow>
      )}

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        {/* ── Stock, worst first ── */}
        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={<Space size={7}><ClusterOutlined style={{ color: TILE.blue.fg(isDark) }} />
              <Text strong style={{ fontSize: 14 }}>Stock right now</Text></Space>}
            extra={<Button type="link" size="small" onClick={() => navigate('/tiers')}>Manage</Button>}
          >
            {loading && !data.tiers ? <TableRowsSkeleton rows={4} /> : (
              <>
                {sortedTiers.map((t) => (
                  <StockBar key={t.id} tier={t} onClick={() => navigate('/tiers')} />
                ))}
                <MetricLegend
                  definition={`Flagged as low below ${thresholds.lowPercent ?? 25}% free, critical below ${thresholds.criticalPercent ?? 10}%. Both are editable in the analytics policy.`}
                  caveat={totals.unlimited ? `${totals.unlimited} machine type${totals.unlimited === 1 ? ' has' : 's have'} no capacity ceiling set, so they can never report as out of stock.` : undefined}
                />
              </>
            )}
          </Card>
        </Col>

        {/* ── Stock over time ── */}
        <Col xs={24} lg={14}>
          <ChartCard
            title="Capacity over time"
            subtitle="Units free, from the daily capacity snapshot"
            loading={loading && !data.capacity}
            error={errors.capacity}
            onRetry={() => reload()}
            /* A line needs two points. One snapshot renders as a lone vertical
               spike that reads as a dramatic event rather than as "we have only
               started recording", so it is shown as the empty state instead —
               which says exactly that. */
            empty={(data.capacity?.series || []).length < 2}
            emptyText="Not enough capacity history to plot yet — a snapshot is taken once a day, so this fills in from tomorrow"
            definition="One snapshot per machine type per day. Stock-outs between snapshots are captured as separate events."
            window={windowLabel}
            height={250}
          >
            <TimeSeriesChart
              data={data.capacity?.series || []}
              series={[{ field: 'available', label: 'Units free' }]}
              height={250}
            />
          </ChartCard>
        </Col>
      </Row>

      {/* ── Outages + consumption breakdowns ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={8}>
          <Card
            size="small"
            title={<Space size={7}><WarningOutlined style={{ color: STATUS_COLORS.warning[isDark ? 'dark' : 'light'] }} />
              <Text strong style={{ fontSize: 14 }}>Time out of stock</Text></Space>}
          >
            {(data.outages?.totals || []).length ? (
              <>
                {data.outages.totals.map((o) => (
                  <div key={o.tierId} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                    <Text style={{ fontSize: 12 }} ellipsis>{o.tierName}</Text>
                    <Text style={{ ...monoNumeric, fontSize: 12 }}>
                      {o.hoursOut}h
                      <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 6 }}>
                        ×{o.occurrences}
                      </Text>
                    </Text>
                  </div>
                ))}
                <MetricLegend definition="Measured from the capacity event log — each stock-out lasts until the next capacity change." window={windowLabel} />
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<Text type="secondary" style={{ fontSize: 12.5 }}>No recorded stock-outs in this period</Text>} />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title={<Space size={7}><ThunderboltOutlined style={{ color: TILE.purple.fg(isDark) }} />
            <Text strong style={{ fontSize: 14 }}>Hours by machine type</Text></Space>}
          >
            <DistributionChart
              rows={consumption?.byTier || []}
              valueField="hours"
              valueFormat={hours}
              emptyText="Nothing billed in this period"
            />
            <MetricLegend definition="Billed compute hours. Custom builds are grouped together — they have no tier of their own." window={windowLabel} />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title={<Space size={7}><DatabaseOutlined style={{ color: TILE.cyan.fg(isDark) }} />
            <Text strong style={{ fontSize: 14 }}>Hours by model</Text></Space>}
          >
            <DistributionChart
              rows={consumption?.byModel || []}
              valueField="hours"
              valueFormat={hours}
              emptyText="Nothing billed in this period"
            />
            <MetricLegend definition="Which models customers actually run, measured in billed machine time rather than deployment count." window={windowLabel} />
          </Card>
        </Col>
      </Row>

      {/* ── Compute vs storage, and the series ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={16}>
          <ChartCard
            title="What was consumed"
            subtitle="Machine time against storage held by paused deployments"
            loading={loading && !data.consumption}
            error={errors.consumption}
            onRetry={() => reload()}
            empty={!(consumption?.series || []).some((r) => r.computeHours || r.storageHours)}
            definition="Compute is time a machine was running. Storage is the disk a paused deployment still holds — billed, but doing nothing."
            window={windowLabel}
            height={250}
          >
            <TimeSeriesChart
              data={consumption?.series || []}
              kind="area"
              stack
              series={[
                { field: 'computeHours', label: 'Compute hours' },
                { field: 'storageHours', label: 'Storage hours' },
              ]}
              height={250}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title={<Text strong style={{ fontSize: 14 }}>Compute vs storage</Text>}>
            <Row gutter={12}>
              <Col span={12}>
                <Statistic title="Compute" value={Math.round(consumption?.byKind?.compute?.hours || 0)} suffix="h"
                  valueStyle={{ fontSize: 20, color: TILE.purple.fg(isDark) }} />
              </Col>
              <Col span={12}>
                <Statistic title="Storage" value={Math.round(consumption?.byKind?.storage?.hours || 0)} suffix="h"
                  valueStyle={{ fontSize: 20, color: TILE.amber.fg(isDark) }} />
              </Col>
            </Row>
            <MetricLegend
              definition="Storage hours accrue on paused deployments that still hold a disk."
              caveat={(consumption?.byKind?.storage?.hours || 0) > (consumption?.byKind?.compute?.hours || 0)
                ? 'More hours are being billed for idle storage than for running machines.'
                : undefined}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Funnel + sizing effectiveness ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title={<Space size={7}><BuildOutlined style={{ color: TILE.green.fg(isDark) }} />
            <Text strong style={{ fontSize: 14 }}>From request to running</Text></Space>}
          >
            {loading && !lifecycle ? <TableRowsSkeleton rows={4} /> : (
              <>
                <FunnelChart stages={lifecycle?.funnel || []} dropLabel="did not get through" />
                <div style={{ marginTop: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 11.5, color: muted(isDark) }}>
                    Median approval: <b>{lifecycle?.approvalLatency?.medianMinutes ?? '—'}</b> min
                    {lifecycle?.approvalLatency?.p90Minutes != null && ` (p90 ${lifecycle.approvalLatency.p90Minutes})`}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: muted(isDark) }}>
                    Rejected: <b>{lifecycle?.rejectionRate ?? 0}%</b>
                  </Text>
                  <Text style={{ fontSize: 11.5, color: muted(isDark) }}>
                    Failed: <b>{lifecycle?.failureRate ?? 0}%</b>
                  </Text>
                </div>
                <MetricLegend
                  definition="Stage times come from the deployment status history, so an approval is timed from when it was actually recorded."
                  window={windowLabel}
                />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title={<Space size={7}><BulbOutlined style={{ color: TILE.amber.fg(isDark) }} />
            <Text strong style={{ fontSize: 14 }}>Does our sizing advice hold up?</Text></Space>}
          >
            {loading && !sizing ? <TableRowsSkeleton rows={3} /> : (sizing?.sampled ? (
              <>
                <Row gutter={12} style={{ marginBottom: 12 }}>
                  <Col span={8}>
                    <Statistic title="Took our advice" value={sizing.followedPercent} suffix="%"
                      valueStyle={{ fontSize: 20, color: TILE.green.fg(isDark) }} />
                  </Col>
                  <Col span={8}>
                    <Tooltip title="Median hours a deployment ran, for customers who followed the recommendation">
                      <Statistic title="Ran for (followed)" value={sizing.outcomes.followed.medianRuntimeHours ?? 0} suffix="h"
                        valueStyle={{ fontSize: 20 }} />
                    </Tooltip>
                  </Col>
                  <Col span={8}>
                    <Tooltip title="Median hours a deployment ran, for customers who chose something else">
                      <Statistic title="Ran for (ignored)" value={sizing.outcomes.notFollowed.medianRuntimeHours ?? 0} suffix="h"
                        valueStyle={{ fontSize: 20 }} />
                    </Tooltip>
                  </Col>
                </Row>

                <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  Terminated within a week:{' '}
                  <b>{sizing.outcomes.followed.terminatedWithin7dPercent}%</b> of those who followed,{' '}
                  <b style={{ color: STATUS_COLORS.warning[isDark ? 'dark' : 'light'] }}>
                    {sizing.outcomes.notFollowed.terminatedWithin7dPercent}%
                  </b>{' '}
                  of those who did not.
                </Text>

                {(sizing.topOverrides || []).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Text style={{ fontSize: 11.5, color: muted(isDark) }}>Most common overrides</Text>
                    {sizing.topOverrides.slice(0, 4).map((o) => (
                      <div key={o.change} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                        <Text style={{ fontSize: 11.5 }} ellipsis>{o.change}</Text>
                        <Text style={{ ...monoNumeric, fontSize: 11.5 }}>{o.count}</Text>
                      </div>
                    ))}
                  </div>
                )}

                <MetricLegend
                  definition={`Based on ${sizing.sampled} deployment${sizing.sampled === 1 ? '' : 's'} where the engine produced a recommendation.`}
                  window={windowLabel}
                  caveat={sizing.sampled < 20 ? 'Too few deployments to read much into yet — treat as a direction, not a verdict.' : undefined}
                />
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<Text type="secondary" style={{ fontSize: 12.5 }}>No sized deployments in this period</Text>} />
            ))}
          </Card>
        </Col>
      </Row>

      {/* ── Components and custom builds ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title={<Text strong style={{ fontSize: 14 }}>What custom builds asked for</Text>}>
            {(data.components?.customBuildDemand || []).length ? (
              <>
                <DistributionChart
                  rows={data.components.customBuildDemand}
                  labelField="name"
                  valueField="requests"
                  valueFormat={(v) => `${v}×`}
                />
                <MetricLegend
                  definition="Components requested in builds customers assembled themselves — demand the tier catalogue did not serve."
                  window={windowLabel}
                  caveat={data.components.customBuildDemand.some((d) => !d.inCatalogue)
                    ? 'Some requested components are no longer in the active catalogue.'
                    : undefined}
                />
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<Text type="secondary" style={{ fontSize: 12.5 }}>No custom builds in this period</Text>} />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title={<Text strong style={{ fontSize: 14 }}>Custom builds</Text>}>
            <Row gutter={12} style={{ marginBottom: 10 }}>
              <Col span={12}>
                <Statistic title="Built their own" value={builds?.count ?? 0}
                  suffix={builds?.sharePercent ? `(${builds.sharePercent}%)` : ''}
                  valueStyle={{ fontSize: 20 }} />
              </Col>
              <Col span={12}>
                <Statistic title="From the catalogue" value={builds?.catalogueCount ?? 0} valueStyle={{ fontSize: 20 }} />
              </Col>
            </Row>
            {(builds?.topConfigurations || []).length ? (
              <>
                <Text style={{ fontSize: 11.5, color: muted(isDark) }}>Configurations built more than once</Text>
                {builds.topConfigurations.filter((c) => c.count > 1).slice(0, 5).map((c) => (
                  <div key={c.signature} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ fontSize: 11.5 }} ellipsis>{c.signature}</Text>
                    <Text style={{ ...monoNumeric, fontSize: 11.5 }}>×{c.count}</Text>
                  </div>
                ))}
                <MetricLegend definition="A configuration several customers assembled independently is a machine type worth adding to the catalogue." />
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: 12.5 }}>No repeated configurations yet</Text>
            )}
          </Card>
        </Col>
      </Row>

      {/* ── The full table, last — scanning beats drilling ── */}
      <Card size="small" style={{ marginTop: 14 }} title={<Text strong style={{ fontSize: 14 }}>All machine types</Text>}>
        <Table
          size="small"
          loading={loading && !data.tiers}
          dataSource={sortedTiers}
          columns={tierColumns}
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active machine types" /> }}
        />
      </Card>
    </div>
  );
};

export default InfrastructurePage;
