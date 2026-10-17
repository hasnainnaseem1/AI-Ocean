import React from 'react';
import {
  Row, Col, Card, Space, Typography, Button, Alert, Progress,
} from 'antd';
import {
  ReloadOutlined, HeartOutlined, RiseOutlined, FallOutlined, UserSwitchOutlined, AlertOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import TabHeader from '../../components/analytics/TabHeader';
import ChartCard from '../../components/charts/ChartCard';
import TimeSeriesChart from '../../components/charts/TimeSeriesChart';
import DistributionChart from '../../components/charts/DistributionChart';
import CohortHeatmap from '../../components/charts/CohortHeatmap';
import MetricLegend from '../../components/charts/MetricLegend';
import { StatRow, StatCard } from '../../components/StatRow';
import { StatCardsSkeleton, TableRowsSkeleton } from '../../components/Skeletons';
import retentionApi from '../../api/retentionApi';
import useAnalyticsQuery from '../../hooks/useAnalyticsQuery';
import useAnalyticsWindow from '../../hooks/useAnalyticsWindow';
import PeriodPicker from '../../components/analytics/PeriodPicker';
import ExportButton from '../../components/analytics/ExportButton';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import {
  TILE, STATUS_COLORS, muted, monoNumeric,
} from '../../theme/colors';
import { formatNumber } from '../../utils/helpers';

const { Text } = Typography;

const money = (v) => `$${formatNumber(Number(v || 0).toFixed(2))}`;
const int = (v) => formatNumber(Math.round(Number(v || 0)));
const percent = (v) => (v === null || v === undefined ? '—' : `${v}%`);

/**
 * Retention.
 *
 * Built around a distinction the two halves of this page keep apart on
 * purpose: **do accounts stay** and **does the money stay**. They answer
 * differently and often in opposite directions — one large customer growing
 * can hold net revenue retention above 100% in a month when a third of the
 * logos walked out. Averaging them, or showing only the flattering one, is how
 * a retention page stops being evidence.
 *
 * Gross revenue retention is shown beside net for the same reason: GRR ignores
 * expansion entirely, so it is the number that cannot be papered over.
 */
const RetentionPage = ({ embedded = false, onSwitchTab = null }) => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { hasPermission } = usePermission();
  const canSeeRevenue = hasPermission(PERMISSIONS.ANALYTICS_REVENUE);

  const { params: windowParams, key: windowKey, picker } = useAnalyticsWindow();

  const {
    data, errors, loading, failedCount, reload,
  } = useAnalyticsQuery({
    cohorts: () => retentionApi.getCohorts(windowParams),
    lifecycle: () => retentionApi.getLifecycle(windowParams),
    riskTrend: () => retentionApi.getRiskTrend(windowParams),
    // Asked for only when it can be answered — a 403 in the failure banner on
    // every page load would train an operator to ignore the banner.
    ...(canSeeRevenue ? { revenue: () => retentionApi.getRevenueRetention(windowParams) } : {}),
  }, [windowKey, canSeeRevenue]);

  const cohorts = data.cohorts;
  const lifecycle = data.lifecycle;
  const revenue = data.revenue;
  const riskTrend = data.riskTrend;
  const windowLabel = cohorts?.window
    ? `${cohorts.window.label} · ${cohorts.window.timezone}`
    : '';

  const bandSeries = (riskTrend?.bands || []).map((b) => ({ field: b.key, label: b.label }));

  const SUBTITLE = 'Whether accounts stay, whether the money stays with them, and who looks like leaving';
  const toolbar = (
    <>
      {/* Inside the tabbed shell this is a sibling tab, so the shortcut
          switches tab rather than navigating away. */}
      <Button
        size="small"
        icon={<AlertOutlined />}
        onClick={() => (embedded && onSwitchTab ? onSwitchTab('churn-risk') : navigate('/analytics/churn-risk'))}
      >
        At-risk list
      </Button>
      <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={() => reload({ quiet: true })}>
        Refresh
      </Button>
      <PeriodPicker {...picker} />
      <ExportButton tab="retention" params={windowParams} />
    </>
  );

  return (
    <div>
      {embedded ? <TabHeader subtitle={SUBTITLE} extra={toolbar} /> : (
        <PageHeader
          title="Retention"
          subtitle={SUBTITLE}
          breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Analytics', path: '/analytics' }, { label: 'Retention' }]}
          extra={<Space>{toolbar}</Space>}
        />
      )}

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

      {loading && !lifecycle ? <StatCardsSkeleton count={4} /> : (
        <StatRow>
          <StatCard
            count={4}
            tone="green"
            icon={<HeartOutlined />}
            label="Accounts that stayed"
            value={percent(revenue?.accounts?.logoRetentionPercent)}
            /* Three distinct states, said plainly rather than all rendering as
               a dash: not allowed to see it, allowed but nothing to compare
               against, or a real figure. */
            caption={(() => {
              if (!canSeeRevenue) return 'Needs the Revenue Analytics permission';
              if (!revenue) return 'Loading…';
              if (!revenue.accounts.startingBase) return 'Nothing was billed in the previous period to compare against';
              return `${int(revenue.accounts.retained)} of ${int(revenue.accounts.startingBase)} carried on from last period`;
            })()}
          />
          <StatCard
            count={4}
            tone="blue"
            icon={<RiseOutlined />}
            label="Net revenue kept"
            value={canSeeRevenue ? percent(revenue?.netRetentionPercent) : '—'}
            caption={canSeeRevenue
              ? 'Existing accounts only — new ones excluded'
              : 'Hidden without the Revenue Analytics permission'}
          />
          <StatCard
            count={4}
            tone={revenue && revenue.grossRetentionPercent !== null && revenue.grossRetentionPercent < 90 ? 'amber' : 'cyan'}
            icon={<FallOutlined />}
            label="Gross revenue kept"
            value={canSeeRevenue ? percent(revenue?.grossRetentionPercent) : '—'}
            caption={canSeeRevenue
              ? 'Ignores expansion — the number growth cannot hide'
              : 'Hidden without the Revenue Analytics permission'}
          />
          <StatCard
            count={4}
            tone="purple"
            icon={<UserSwitchOutlined />}
            label="Came back"
            value={int((lifecycle?.states || []).find((s) => s.key === 'returning')?.accounts)}
            caption={`Silent for ${lifecycle?.reactivationDays ?? 60}+ days, then active again`}
          />
        </StatRow>
      )}

      {/* The one comparison worth calling out in words: a healthy NRR sitting
          on top of a bad GRR means growth is covering for leakage. */}
      {/* `revenue &&` first, deliberately: `revenue?.x !== null` is TRUE while
          the request is still in flight, because optional chaining yields
          undefined and undefined is not null. Reading the next field then
          throws and takes the whole page down — which is exactly what it did. */}
      {canSeeRevenue && revenue
        && revenue.grossRetentionPercent !== null
        && revenue.netRetentionPercent !== null
        && revenue.netRetentionPercent >= 100 && revenue.grossRetentionPercent < 90 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 14, borderRadius: 10 }}
          message="Growth is covering for churn"
          description={`Net retention is ${revenue.netRetentionPercent}% but gross is ${revenue.grossRetentionPercent}% — existing accounts are shrinking and leaving, and expansion elsewhere is hiding it.`}
        />
      )}

      {revenue?.caveat && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 14, borderRadius: 10 }}
          message={revenue.caveat}
        />
      )}

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24}>
          <ChartCard
            title="Do accounts stay?"
            subtitle="Each row is a signup month; each column a month after it"
            loading={loading && !cohorts}
            error={errors.cohorts}
            onRetry={() => reload()}
            empty={!(cohorts?.matrix || []).length}
            emptyText="No cohorts yet — this fills in as accounts age"
            definition={cohorts?.definition}
            /* Passed as a prop, not rendered as a child: ChartCard swaps its
               children for the empty state, so a caveat written inside them
               disappears exactly when there is least data and most need to
               explain it. (Month 0 not being 100% is a real signal, not a bug
               — saying so stops somebody "fixing" it.) */
            caveat={cohorts?.caveat}
            window={windowLabel}
          >
            <CohortHeatmap matrix={cohorts?.matrix || []} periods={cohorts?.periods || 12} />
          </ChartCard>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={8}>
          <ChartCard
            title="Where accounts are in their life"
            loading={loading && !lifecycle}
            error={errors.lifecycle}
            onRetry={() => reload()}
            empty={!(lifecycle?.states || []).some((s) => s.accounts > 0)}
            emptyText="Nothing was active in this period"
            definition={lifecycle?.definition}
            window={windowLabel}
          >
            <DistributionChart
              rows={lifecycle?.states || []}
              labelField="label"
              valueField="accounts"
              valueFormat={(v) => `${int(v)} account${Number(v) === 1 ? '' : 's'}`}
              limit={5}
            />
          </ChartCard>

        </Col>

        <Col xs={24} lg={16}>
          <ChartCard
            title="How risk has moved"
            subtitle="From the nightly scores"
            loading={loading && !riskTrend}
            error={errors.riskTrend}
            onRetry={() => reload()}
            empty={(riskTrend?.series || []).length < 2}
            emptyText="Not enough risk history to plot yet — a score is written once a night, so this fills in from tomorrow"
            definition="Accounts in each risk band, as scored that night."
            /* The series is deliberately not gap-filled — a night the job did
               not run has no point, because a zero would say everyone
               recovered — so this caveat has to survive the empty state too. */
            caveat={riskTrend?.caveat}
            window={windowLabel}
            height={250}
          >
            <TimeSeriesChart
              data={riskTrend?.series || []}
              series={bandSeries}
              kind="column"
              stack
              height={250}
            />
          </ChartCard>
        </Col>
      </Row>

      {canSeeRevenue && (
        <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
          <Col xs={24}>
            <Card
              size="small"
              title={(
                <Space size={7}>
                  <RiseOutlined style={{ color: TILE.blue.fg(isDark) }} />
                  <Text strong style={{ fontSize: 14 }}>Where the money went, against last period</Text>
                </Space>
              )}
            >
              {loading && !revenue ? <TableRowsSkeleton rows={3} /> : (
                <>
                  <Row gutter={[14, 14]}>
                    {[
                      { label: 'Was being billed', value: revenue?.starting, tone: 'blue', n: revenue?.accounts?.startingBase },
                      { label: 'Stopped entirely', value: revenue?.churned, tone: 'pink', n: revenue?.accounts?.churned },
                      { label: 'Spent less', value: revenue?.contraction, tone: 'amber', n: revenue?.accounts?.contracted },
                      { label: 'Spent more', value: revenue?.expansion, tone: 'green', n: revenue?.accounts?.expanded },
                      { label: 'Brand new', value: revenue?.newRevenue, tone: 'purple', n: revenue?.accounts?.new, extra: ' — not in the rates above' },
                    ].map((c) => ({
                      ...c,
                      note: `${int(c.n)} account${Number(c.n) === 1 ? '' : 's'}${c.extra || ''}`,
                    })).map((c) => (
                      <Col xs={12} md={8} lg={4} key={c.label}>
                        <Text style={{ fontSize: 11, color: muted(isDark), display: 'block' }}>{c.label}</Text>
                        <Text strong style={{ ...monoNumeric, fontSize: 17, color: TILE[c.tone].fg(isDark) }}>
                          {money(c.value)}
                        </Text>
                        <div><Text style={{ fontSize: 10.5, color: muted(isDark) }}>{c.note}</Text></div>
                      </Col>
                    ))}
                    <Col xs={24} lg={4}>
                      <Text style={{ fontSize: 11, color: muted(isDark), display: 'block' }}>Gross kept</Text>
                      <Progress
                        percent={Math.min(100, revenue?.grossRetentionPercent ?? 0)}
                        size="small"
                        strokeColor={(revenue?.grossRetentionPercent ?? 0) >= 90
                          ? STATUS_COLORS.success[isDark ? 'dark' : 'light']
                          : STATUS_COLORS.warning[isDark ? 'dark' : 'light']}
                      />
                    </Col>
                  </Row>
                  <MetricLegend definition={revenue?.definition} window={windowLabel} />
                </>
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default RetentionPage;
