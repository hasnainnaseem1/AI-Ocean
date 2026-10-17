import React, { useState } from 'react';
import {
  Row, Col, Card, Table, Tag, Segmented, Space, Typography, Button, Alert, Badge, Tooltip,
} from 'antd';
import {
  ReloadOutlined, GlobalOutlined, EyeOutlined, TeamOutlined,
  LoginOutlined, CompassOutlined, MobileOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import TabHeader from '../../components/analytics/TabHeader';
import ChartCard from '../../components/charts/ChartCard';
import TimeSeriesChart from '../../components/charts/TimeSeriesChart';
import DistributionChart from '../../components/charts/DistributionChart';
import MetricLegend from '../../components/charts/MetricLegend';
import { StatRow, StatCard } from '../../components/StatRow';
import { StatCardsSkeleton, TableRowsSkeleton } from '../../components/Skeletons';
import trafficApi from '../../api/trafficApi';
import useAnalyticsQuery from '../../hooks/useAnalyticsQuery';
import useAnalyticsWindow from '../../hooks/useAnalyticsWindow';
import PeriodPicker from '../../components/analytics/PeriodPicker';
import ExportButton from '../../components/analytics/ExportButton';
import { useTheme } from '../../contexts/ThemeContext';
import {
  TILE, STATUS_COLORS, muted, monoNumeric,
} from '../../theme/colors';
import { formatNumber } from '../../utils/helpers';

const { Text } = Typography;

const int = (v) => formatNumber(Math.round(Number(v || 0)));
const percent = (v) => (v === null || v === undefined ? '—' : `${v}%`);

/** Seconds → the roughest unit that still reads honestly. */
const secs = (s) => {
  if (s === null || s === undefined) return '—';
  const v = Number(s);
  if (v < 60) return `${Math.round(v)}s`;
  if (v < 3600) return `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`;
  return `${Math.round(v / 3600)}h`;
};

const BREAKDOWNS = [
  { key: 'source', label: 'Source' },
  { key: 'medium', label: 'Channel' },
  { key: 'referrer', label: 'Referrer' },
  { key: 'campaign', label: 'Campaign' },
];

/**
 * Traffic, from the platform's own collector.
 *
 * ── Why there is no Google Analytics on this page ──
 *
 * It was a deliberate choice when the phase was planned: the platform records
 * its own visits. That buys three things — the data belongs to the operator,
 * there is no third-party script on a customer's marketing site, and no
 * consent banner is needed because nothing is stored on the visitor's device.
 * The visitor identifier is a hash re-salted every midnight, so the same
 * person is unlinkable across days by design.
 *
 * ── What the page keeps saying out loud ──
 *
 * Every figure names the source that produced it. Inside the retention window
 * it is counted from individual page views; beyond it, from the nightly
 * rollups. The two are not the same precision, and a reader comparing this
 * month with last year is entitled to know which they are looking at.
 *
 * Three things this data genuinely cannot answer — returning visitors,
 * country, and which visit produced a signup — are stated on the cards where
 * somebody would otherwise look for them, rather than left as empty charts.
 */
const TrafficPage = ({ embedded = false }) => {
  const { isDark } = useTheme();
  const { params: windowParams, key: windowKey, picker } = useAnalyticsWindow();
  const [site, setSite] = useState('all');
  const [by, setBy] = useState('source');

  const siteParam = site === 'all' ? undefined : site;

  const {
    data, errors, loading, failedCount, reload,
  } = useAnalyticsQuery({
    summary: () => trafficApi.getSummary({ ...windowParams, site: siteParam }),
    trend: () => trafficApi.getTrend({ ...windowParams, site: siteParam }),
    pages: () => trafficApi.getPages({ ...windowParams, site: siteParam, limit: 15 }),
    audience: () => trafficApi.getAudience({ ...windowParams, site: siteParam }),
    conversions: () => trafficApi.getConversions({ ...windowParams, site: siteParam }),
  }, [windowKey, siteParam]);

  const breakdownQuery = useAnalyticsQuery({
    breakdown: () => trafficApi.getBreakdown({ ...windowParams, site: siteParam, by, limit: 12 }),
  }, [windowKey, siteParam, by]);

  const summary = data.summary;
  const audience = data.audience;
  const conversions = data.conversions;
  const breakdown = breakdownQuery.data.breakdown;
  const windowLabel = summary?.window
    ? `${summary.window.label} · ${summary.window.timezone}`
    : '';

  const sourceTag = summary?.source && (
    <Tooltip title={summary.sourceNote}>
      <Tag color={summary.source === 'events' ? 'blue' : 'default'} style={{ fontSize: 10 }}>
        {summary.source === 'events' ? 'exact' : 'from rollups'}
      </Tag>
    </Tooltip>
  );

  const pageColumns = [
    {
      title: 'Page',
      dataIndex: 'path',
      key: 'path',
      render: (v) => <Text style={{ fontSize: 12.5, fontFamily: monoNumeric.fontFamily }}>{v}</Text>,
    },
    {
      title: 'Views',
      dataIndex: 'views',
      key: 'views',
      align: 'right',
      width: 110,
      render: (v, r) => (
        <span style={monoNumeric}>
          {int(v)}
          <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 5 }}>{r.share}%</Text>
        </span>
      ),
    },
    {
      title: 'Visits', dataIndex: 'sessions', key: 'sessions', align: 'right', width: 90, render: (v) => <span style={monoNumeric}>{int(v)}</span>,
    },
    {
      title: 'Landed here',
      dataIndex: 'entries',
      key: 'entries',
      align: 'right',
      width: 110,
      render: (v) => (
        <Tooltip title="Visits that began on this page">
          <span style={monoNumeric}>{int(v)}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Time on page',
      dataIndex: 'averageSeconds',
      key: 'averageSeconds',
      align: 'right',
      width: 120,
      render: (v) => <span style={monoNumeric}>{secs(v)}</span>,
    },
  ];

  const breakdownColumns = [
    {
      title: BREAKDOWNS.find((b) => b.key === by)?.label || 'Value',
      dataIndex: 'value',
      key: 'value',
      render: (v) => <Text style={{ fontSize: 12.5 }}>{v}</Text>,
    },
    {
      title: 'Visits',
      dataIndex: 'sessions',
      key: 'sessions',
      align: 'right',
      width: 110,
      render: (v, r) => (
        <span style={monoNumeric}>
          {int(v)}
          <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 5 }}>{r.share}%</Text>
        </span>
      ),
    },
    {
      title: 'Bounced',
      dataIndex: 'bounceRatePercent',
      key: 'bounceRatePercent',
      align: 'right',
      width: 100,
      render: (v) => (
        <Text style={{
          fontSize: 12,
          color: v !== null && v >= 70 ? STATUS_COLORS.warning[isDark ? 'dark' : 'light'] : undefined,
        }}
        >
          {percent(v)}
        </Text>
      ),
    },
    {
      title: 'Stayed', dataIndex: 'averageSeconds', key: 'averageSeconds', align: 'right', width: 100, render: (v) => <span style={monoNumeric}>{secs(v)}</span>,
    },
  ];

  const SUBTITLE = 'Visits to the marketing site and the customer centre, recorded by the platform itself';
  const toolbar = (
    <>
      <Segmented
        size="small"
        value={site}
        onChange={setSite}
        options={[
          { label: 'All sites', value: 'all' },
          { label: 'Marketing', value: 'marketing' },
          { label: 'Customer', value: 'customer' },
        ]}
      />
      <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={() => reload({ quiet: true })}>
        Refresh
      </Button>
      <PeriodPicker {...picker} />
      {/* The site filter and the breakdown dimension go with the window: the
          file should be what is on the screen, not everything behind it. */}
      <ExportButton tab="traffic" params={{ ...windowParams, site: siteParam, by }} />
    </>
  );

  return (
    <div>
      {embedded ? <TabHeader subtitle={SUBTITLE} extra={toolbar} /> : (
        <PageHeader
          title="Traffic"
          subtitle={SUBTITLE}
          breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Analytics', path: '/analytics' }, { label: 'Traffic' }]}
          extra={<Space wrap>{toolbar}</Space>}
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

      {loading && !summary ? <StatCardsSkeleton count={4} /> : (
        <StatRow>
          <StatCard
            count={4}
            tone="blue"
            icon={<EyeOutlined />}
            label="Page views"
            value={int(summary?.views)}
            caption={summary?.previous
              ? `${int(summary.previous.views)} in the period before`
              : ''}
          />
          <StatCard
            count={4}
            tone="cyan"
            icon={<CompassOutlined />}
            label="Visits"
            value={int(summary?.sessions)}
            /* With no visits both figures are null, and "— pages per visit ·
               — each" reads as a broken template rather than as "nothing
               happened". Say the latter. */
            caption={summary?.sessions
              ? `${summary.viewsPerSession ?? '—'} pages per visit · ${secs(summary.averageSessionSeconds)} each`
              : 'No visits recorded in this period'}
          />
          <StatCard
            count={4}
            tone="purple"
            icon={<TeamOutlined />}
            label="Visitors"
            value={int(summary?.visitors)}
            caption="Counted fresh each day — see the note below"
          />
          <StatCard
            count={4}
            tone={summary && summary.bounceRatePercent !== null && summary.bounceRatePercent >= 70 ? 'amber' : 'green'}
            icon={<LoginOutlined />}
            label="Bounced"
            value={percent(summary?.bounceRatePercent)}
            caption="One page, and gone within seconds"
          />
        </StatRow>
      )}

      {/* The privacy design has a measurement consequence, and it is stated
          where somebody would otherwise mistrust the number. */}
      {summary?.visitorsCaveat && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 14, borderRadius: 10 }}
          message="How visitors are counted"
          description={summary.visitorsCaveat}
        />
      )}

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={16}>
          <ChartCard
            title={<Space size={8}>Traffic over time {sourceTag}</Space>}
            subtitle="Views, visits and visitors"
            loading={loading && !data.trend}
            error={errors.trend}
            onRetry={() => reload()}
            empty={!(data.trend?.series || []).some((p) => p.views > 0)}
            emptyText="Nothing recorded in this period — tracking may have been switched off, or this window predates it"
            definition={data.trend?.sourceNote}
            window={windowLabel}
            height={260}
          >
            <TimeSeriesChart
              data={data.trend?.series || []}
              series={[
                { field: 'views', label: 'Page views' },
                { field: 'sessions', label: 'Visits' },
                { field: 'visitors', label: 'Visitors' },
              ]}
              height={260}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <GlobalOutlined style={{ color: TILE.green.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>On the site now</Text>
              </Space>
            )}
          >
            {loading && !summary ? <TableRowsSkeleton rows={2} /> : (
              <>
                <Space align="baseline" size={10}>
                  <Badge status={summary?.onlineNow > 0 ? 'processing' : 'default'} />
                  <Text strong style={{ ...monoNumeric, fontSize: 30 }}>{int(summary?.onlineNow)}</Text>
                  <Text style={{ fontSize: 12, color: muted(isDark) }}>
                    {summary?.onlineNow === 1 ? 'visit' : 'visits'} active
                  </Text>
                </Space>
                <MetricLegend
                  definition="Visits that have sent something in the last five minutes."
                  /* Not a live feed — the number is as old as the page. Saying
                     so avoids an operator reading a stale zero as "nobody is
                     here" while somebody is reading the pricing page. */
                  caveat="This is a snapshot from when the page loaded, not a live counter — press Refresh for the current figure."
                />
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={14}>
          <Card
            size="small"
            title={<Space size={7}><EyeOutlined style={{ color: TILE.blue.fg(isDark) }} /><Text strong style={{ fontSize: 14 }}>Most-read pages</Text></Space>}
          >
            {loading && !data.pages ? <TableRowsSkeleton rows={6} /> : (
              <>
                <Table
                  size="small"
                  rowKey="path"
                  tableLayout="fixed"
                  pagination={false}
                  dataSource={data.pages?.pages || []}
                  columns={pageColumns}
                  locale={{ emptyText: 'No page views in this period' }}
                />
                <MetricLegend
                  definition="Grouped by path pattern, so every blog post counts towards /blog/:slug rather than appearing as its own row."
                  /* Views whose tab closed before the browser could report a
                     duration are EXCLUDED from the average, not counted as
                     zero seconds. */
                  caveat={data.pages?.caveat}
                  window={windowLabel}
                />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={<Space size={7}><CompassOutlined style={{ color: TILE.cyan.fg(isDark) }} /><Text strong style={{ fontSize: 14 }}>Where visits come from</Text></Space>}
            extra={(
              <Segmented
                size="small"
                value={by}
                onChange={setBy}
                options={BREAKDOWNS.map((b) => ({ label: b.label, value: b.key }))}
              />
            )}
          >
            {breakdownQuery.loading && !breakdown ? <TableRowsSkeleton rows={5} /> : (
              <>
                <Table
                  size="small"
                  rowKey="value"
                  tableLayout="fixed"
                  pagination={false}
                  dataSource={breakdown?.items || []}
                  columns={breakdownColumns}
                  locale={{ emptyText: 'Nothing recorded in this period' }}
                />
                <MetricLegend
                  /* Counted per VISIT, not per page view: somebody who read ten
                     pages after arriving from one link is one referral. */
                  definition="Counted once per visit, not per page — somebody who read ten pages is one arrival."
                  window={windowLabel}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={5}>
          <ChartCard
            title="Devices"
            loading={loading && !audience}
            error={errors.audience}
            onRetry={() => reload()}
            empty={!(audience?.device || []).length}
            emptyText="Nothing recorded yet"
          >
            <DistributionChart
              rows={audience?.device || []}
              labelField="value"
              valueField="sessions"
              valueFormat={(v) => `${int(v)} visits`}
              limit={4}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={5}>
          <ChartCard
            title="Browsers"
            loading={loading && !audience}
            error={errors.audience}
            onRetry={() => reload()}
            empty={!(audience?.browser || []).length}
            emptyText="Nothing recorded yet"
          >
            <DistributionChart
              rows={audience?.browser || []}
              labelField="value"
              valueField="sessions"
              valueFormat={(v) => `${int(v)} visits`}
              limit={6}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={5}>
          <ChartCard
            title="Systems"
            loading={loading && !audience}
            error={errors.audience}
            onRetry={() => reload()}
            empty={!(audience?.os || []).length}
            emptyText="Nothing recorded yet"
            /* Country is the thing a reader looks for here and will not find.
               Said on the card rather than left as a missing chart. */
            caveat={audience?.caveat}
          >
            <DistributionChart
              rows={audience?.os || []}
              labelField="value"
              valueField="sessions"
              valueFormat={(v) => `${int(v)} visits`}
              limit={6}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={9}>
          <ChartCard
            title="Does any of it turn into customers?"
            subtitle="Visits and new accounts on one axis"
            loading={loading && !conversions}
            error={errors.conversions}
            onRetry={() => reload()}
            empty={!(conversions?.series || []).some((p) => p.sessions > 0 || p.signups > 0)}
            emptyText="Nothing to compare in this period"
            definition={conversions?.signupRatePercent !== null && conversions?.signupRatePercent !== undefined
              ? `${int(conversions.totalSignups)} accounts from ${int(conversions.totalSessions)} visits — ${conversions.signupRatePercent}%.`
              : `${int(conversions?.totalSignups)} accounts, ${int(conversions?.totalSessions)} tracked visits.`}
            /* Nothing links a signup to the visit that produced it, and when
               the two counts disagree outright the rate is withheld rather
               than printed as a number that reads as a broken page. */
            caveat={conversions?.caveat}
            window={windowLabel}
            height={230}
          >
            <TimeSeriesChart
              data={conversions?.series || []}
              series={[
                { field: 'sessions', label: 'Visits' },
                { field: 'signups', label: 'New accounts' },
              ]}
              height={230}
            />
          </ChartCard>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24}>
          <Alert
            type="info"
            showIcon
            icon={<MobileOutlined />}
            style={{ borderRadius: 10 }}
            message="This is the platform's own data — there is no third-party analytics on your sites"
            description="Visits are recorded by a script served from this platform. It sets no cookie and stores nothing on a visitor's device, and the identifier it uses is re-salted every midnight, so nobody can be followed from one day to the next. Sensitive query parameters — invitation and password-reset tokens — are removed before a URL is stored. Tracking, which surfaces report, and how long raw data is kept are all set in Settings."
          />
        </Col>
      </Row>
    </div>
  );
};

export default TrafficPage;
