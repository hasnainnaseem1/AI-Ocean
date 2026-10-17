import React from 'react';
import {
  Row, Col, Card, Table, Tag, Space, Typography, Button, Alert, Progress, Tooltip,
} from 'antd';
import {
  ReloadOutlined, CustomerServiceOutlined, ClockCircleOutlined, InboxOutlined,
  UndoOutlined, SafetyCertificateOutlined, TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import TabHeader from '../../components/analytics/TabHeader';
import ChartCard from '../../components/charts/ChartCard';
import TimeSeriesChart from '../../components/charts/TimeSeriesChart';
import DistributionChart from '../../components/charts/DistributionChart';
import MetricLegend from '../../components/charts/MetricLegend';
import { StatRow, StatCard } from '../../components/StatRow';
import { StatCardsSkeleton, TableRowsSkeleton } from '../../components/Skeletons';
import supportAnalyticsApi from '../../api/supportAnalyticsApi';
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

/**
 * Minutes → the roughest unit that still reads honestly.
 *
 * `null` means "nothing to measure", which is a different statement from
 * "zero" and is rendered as a dash rather than as 0m.
 */
const mins = (m) => {
  if (m === null || m === undefined) return '—';
  const v = Number(m);
  if (v < 1) return 'under a minute';
  if (v < 90) return `${Math.round(v)}m`;
  if (v < 2880) return `${Math.round(v / 60)}h`;
  return `${Math.round(v / 1440)}d`;
};

const PRIORITY_COLOR = {
  urgent: 'red', high: 'orange', normal: 'blue', low: 'default',
};

/**
 * The support queue.
 *
 * Laid out as the four questions a support lead actually asks, in order:
 *
 *   1. Is the queue growing or shrinking?      (opened vs resolved)
 *   2. How long are people waiting?            (first response, resolution)
 *   3. What is piling up, and whose fault?     (backlog, waiting on whom)
 *   4. Are we keeping our promises?            (SLA, reopens)
 *
 * None of this could be asked before `ANLX-SUPPORT`: a ticket recorded only
 * its current status, so its whole past had to be reconstructed. The
 * reconstruction is not uniformly trustworthy, and the page says so where it
 * is not — which resolution times were guessed, which tickets carry no SLA
 * target at all, and the date from which a reopen could even be noticed. A
 * zero that means "not recorded" is marked as such rather than drawn as a
 * clean floor.
 */
const SupportPage = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { params: windowParams, key: windowKey, picker } = useAnalyticsWindow();

  const {
    data, errors, loading, failedCount, reload,
  } = useAnalyticsQuery({
    summary: () => supportAnalyticsApi.getSummary(windowParams),
    volume: () => supportAnalyticsApi.getVolume(windowParams),
    timing: () => supportAnalyticsApi.getTiming(windowParams),
    backlog: () => supportAnalyticsApi.getBacklog(windowParams),
    sla: () => supportAnalyticsApi.getSla(windowParams),
    agents: () => supportAnalyticsApi.getAgents(windowParams),
    reopens: () => supportAnalyticsApi.getReopens(windowParams),
  }, [windowKey]);

  const summary = data.summary;
  const backlog = data.backlog;
  const sla = data.sla;
  const reopens = data.reopens;
  const windowLabel = summary?.window
    ? `${summary.window.label} · ${summary.window.timezone}`
    : '';

  const net = summary?.volume?.net ?? 0;

  const oldestColumns = [
    {
      title: 'Ticket',
      key: 'subject',
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: 12.5 }}>{r.subject}</Text>
          <div>
            <Text style={{ fontSize: 11, color: muted(isDark) }}>TCK-{1000 + Number(r.number)}</Text>
            <Tag color={PRIORITY_COLOR[r.priority] || 'default'} style={{ fontSize: 10, marginInlineStart: 6 }}>
              {r.priority}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: 'Waiting',
      dataIndex: 'ageHours',
      key: 'ageHours',
      align: 'right',
      width: 100,
      render: (v) => <span style={monoNumeric}>{mins(Number(v) * 60)}</span>,
    },
    {
      title: 'Last activity',
      dataIndex: 'quietHours',
      key: 'quietHours',
      align: 'right',
      width: 110,
      render: (v) => <span style={{ ...monoNumeric, color: Number(v) > 48 ? STATUS_COLORS.warning[isDark ? 'dark' : 'light'] : undefined }}>{mins(Number(v) * 60)} ago</span>,
    },
    {
      title: 'Replied to',
      dataIndex: 'answered',
      key: 'answered',
      align: 'center',
      width: 95,
      render: (v) => (v
        ? <Tag color="green" style={{ fontSize: 10 }}>Yes</Tag>
        : <Tag color="red" style={{ fontSize: 10 }}>Never</Tag>),
    },
    {
      title: 'SLA',
      key: 'sla',
      align: 'center',
      width: 120,
      /* `null` is its own answer: the ticket predates SLA targets and was
         never promised anything, which is not the same as having passed. */
      render: (_, r) => {
        if (r.responseBreached === null && r.resolutionBreached === null) {
          return <Text type="secondary" style={{ fontSize: 11 }}>No target set</Text>;
        }
        const broken = [
          r.responseBreached ? 'first reply' : null,
          r.resolutionBreached ? 'resolution' : null,
        ].filter(Boolean);
        return broken.length
          ? <Tag color="red" style={{ fontSize: 10 }}>Past {broken.join(' & ')}</Tag>
          : <Tag color="green" style={{ fontSize: 10 }}>Within target</Tag>;
      },
    },
    {
      title: 'Assigned',
      dataIndex: 'assignedTo',
      key: 'assignedTo',
      width: 130,
      render: (v) => (v
        ? <Text style={{ fontSize: 12 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 11.5 }}>Nobody</Text>),
    },
  ];

  const agentColumns = [
    {
      title: 'Agent',
      dataIndex: 'name',
      key: 'name',
      render: (v) => <Text strong style={{ fontSize: 12.5 }}>{v}</Text>,
    },
    {
      title: 'Replies', dataIndex: 'messages', key: 'messages', align: 'right', width: 90,
    },
    {
      title: 'Answered first',
      dataIndex: 'firstResponses',
      key: 'firstResponses',
      align: 'right',
      width: 130,
      render: (v) => (
        <Tooltip title="Tickets where this person sent the very first reply">
          <span style={monoNumeric}>{int(v)}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Closed', dataIndex: 'resolved', key: 'resolved', align: 'right', width: 90,
    },
    {
      title: 'Open on their plate',
      dataIndex: 'openAssigned',
      key: 'openAssigned',
      align: 'right',
      width: 160,
      render: (v) => <span style={{ ...monoNumeric, color: Number(v) > 10 ? STATUS_COLORS.warning[isDark ? 'dark' : 'light'] : undefined }}>{int(v)}</span>,
    },
  ];

  const SUBTITLE = 'How much comes in, how fast it is answered, what is piling up, and whether promises are kept';
  const toolbar = (
    <>
      <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={() => reload({ quiet: true })}>
        Refresh
      </Button>
      <PeriodPicker {...picker} />
      <ExportButton tab="support" params={windowParams} />
    </>
  );

  return (
    <div>
      {embedded ? <TabHeader subtitle={SUBTITLE} extra={toolbar} /> : (
        <PageHeader
          title="Support"
          subtitle={SUBTITLE}
          breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Analytics', path: '/analytics' }, { label: 'Support' }]}
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

      {loading && !summary ? <StatCardsSkeleton count={4} /> : (
        <StatRow>
          <StatCard
            count={4}
            tone="blue"
            icon={<CustomerServiceOutlined />}
            label="Tickets opened"
            value={int(summary?.volume?.opened)}
            delta={summary?.volume?.delta?.opened}
            caption={`${int(summary?.volume?.resolved)} closed in the same period`}
            onClick={() => navigate('/support-tickets')}
          />
          <StatCard
            count={4}
            tone={net > 0 ? 'amber' : 'green'}
            icon={<InboxOutlined />}
            label="Open right now"
            value={int(summary?.backlog?.openNow)}
            caption={net > 0
              ? `The queue grew by ${int(net)} this period`
              : `The queue shrank by ${int(Math.abs(net))} this period`}
            onClick={() => navigate('/support-tickets?status=open')}
          />
          <StatCard
            count={4}
            tone="cyan"
            icon={<ClockCircleOutlined />}
            label="First reply"
            value={mins(summary?.timing?.medianFirstResponseMinutes)}
            delta={summary?.timing?.delta?.firstResponse}
            /* "9 in 10 within under a minute" reads badly, so the p90 drops
               the "within" when the value is already a phrase. */
            caption={summary?.timing?.p90FirstResponseMinutes === null
              || summary?.timing?.p90FirstResponseMinutes === undefined
              ? 'Median first reply'
              : `Median · 9 in 10 answered in ${mins(summary.timing.p90FirstResponseMinutes)}`}
          />
          <StatCard
            count={4}
            tone="purple"
            icon={<SafetyCertificateOutlined />}
            label="Within SLA"
            value={summary?.sla?.responseMetPercent === null || summary?.sla?.responseMetPercent === undefined
              ? '—' : `${summary.sla.responseMetPercent}%`}
            caption={summary?.sla?.responseMetPercent === null
              ? 'No ticket in this period carried a target'
              : `${int(summary?.sla?.responseMet)} of ${int(summary?.sla?.responseMet + summary?.sla?.responseMissed)} first replies in time`}
          />
        </StatRow>
      )}

      {/* The queue is growing. Said in words, because a reader should not have
          to subtract two series to find out. */}
      {net > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 14, borderRadius: 10 }}
          message={`More tickets arrived than were closed — the queue grew by ${int(net)}`}
          description={`${int(summary?.backlog?.awaitingSupport)} are waiting on support, ${int(summary?.backlog?.awaitingCustomer)} on the customer, and ${int(summary?.backlog?.neverAnswered)} have had no reply at all.`}
        />
      )}

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={14}>
          <ChartCard
            title="Arriving and closing"
            subtitle="Opened on the day it arrived; closed on the day it was closed"
            loading={loading && !data.volume}
            error={errors.volume}
            onRetry={() => reload()}
            empty={!(data.volume?.series || []).some((p) => p.opened > 0 || p.resolved > 0)}
            emptyText="No tickets arrived or closed in this period"
            definition={data.volume?.definition}
            window={windowLabel}
            height={250}
          >
            <TimeSeriesChart
              data={data.volume?.series || []}
              series={[
                { field: 'opened', label: 'Opened' },
                { field: 'resolved', label: 'Closed' },
              ]}
              kind="column"
              height={250}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={10}>
          <ChartCard
            title="How long people wait"
            subtitle="Median by the day the ticket arrived"
            loading={loading && !data.timing}
            error={errors.timing}
            onRetry={() => reload()}
            empty={!(data.timing?.series || []).some((p) => p.medianFirstResponseMinutes !== null)}
            emptyText="Nothing was answered in this period"
            definition="A gap in the line means no ticket arrived that day — not that it was answered instantly."
            /* Straight from the server: how much of the resolution line is a
               reconstruction rather than a measurement. Passed as a prop
               because ChartCard swaps its children for the empty state, so a
               caveat written inside them vanishes exactly when the data is
               thinnest and the explanation matters most. */
            caveat={data.timing?.caveat}
            window={windowLabel}
            height={250}
          >
            <TimeSeriesChart
              data={data.timing?.series || []}
              series={[
                { field: 'medianFirstResponseMinutes', label: 'First reply (min)' },
                { field: 'medianResolutionMinutes', label: 'Resolution (min)' },
              ]}
              height={250}
            />
          </ChartCard>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={8}>
          <ChartCard
            title="What is piling up"
            subtitle="Everything still open, by how long it has waited"
            loading={loading && !backlog}
            error={errors.backlog}
            onRetry={() => reload()}
            empty={!(backlog?.buckets || []).some((b) => b.tickets > 0)}
            emptyText="Nothing is open — the queue is clear"
            definition={backlog?.definition}
          >
            <DistributionChart
              rows={backlog?.buckets || []}
              labelField="label"
              valueField="tickets"
              valueFormat={(v) => `${int(v)} ticket${Number(v) === 1 ? '' : 's'}`}
              limit={6}
            />
            <MetricLegend
              definition={`${int(backlog?.total)} open in total.`}
              caveat={summary?.backlog?.neverAnswered
                ? `${int(summary.backlog.neverAnswered)} of them have never had a reply from anyone.`
                : undefined}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <ChartCard
            title="What people write in about"
            loading={loading && !data.volume}
            error={errors.volume}
            onRetry={() => reload()}
            empty={!(data.volume?.byCategory || []).length}
            emptyText="No tickets in this period"
            definition="Still-open counts sit beside each category so a small but stuck topic is visible."
          >
            <DistributionChart
              rows={data.volume?.byCategory || []}
              labelField="category"
              valueField="tickets"
              valueFormat={(v) => int(v)}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <SafetyCertificateOutlined style={{ color: TILE.purple.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>Promises kept, by priority</Text>
              </Space>
            )}
          >
            {loading && !sla ? <TableRowsSkeleton rows={4} /> : (
              <>
                {(sla?.byPriority || []).map((p) => {
                  const graded = p.responseMet + p.responseMissed;
                  return (
                    <div key={p.priority} style={{ marginBottom: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <Space size={6}>
                          <Tag color={PRIORITY_COLOR[p.priority] || 'default'} style={{ fontSize: 10, marginInlineEnd: 0 }}>
                            {p.priority}
                          </Tag>
                          <Text style={{ fontSize: 11, color: muted(isDark) }}>
                            reply within {mins(p.responseTargetMinutes)}
                          </Text>
                        </Space>
                        <span style={{ ...monoNumeric, fontSize: 12 }}>
                          {graded ? `${p.responseMetPercent}%` : '—'}
                          <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 5 }}>
                            {p.responseMet}/{graded}
                          </Text>
                        </span>
                      </div>
                      <Progress
                        percent={graded ? p.responseMetPercent : 0}
                        showInfo={false}
                        size="small"
                        strokeColor={p.responseMetPercent === null || p.responseMetPercent >= 90
                          ? STATUS_COLORS.success[isDark ? 'dark' : 'light']
                          : STATUS_COLORS.warning[isDark ? 'dark' : 'light']}
                      />
                    </div>
                  );
                })}
                {!(sla?.byPriority || []).length && (
                  <Text type="secondary" style={{ fontSize: 12.5 }}>No tickets in this period</Text>
                )}
                <MetricLegend
                  definition="Graded against the target each ticket was given when it opened, not against today's policy."
                  /* Tickets with no target are excluded, not passed. Saying so
                     is the difference between "100%" and "100% of the three we
                     could grade". */
                  caveat={sla?.caveat}
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
            title={(
              <Space size={7}>
                <ClockCircleOutlined style={{ color: STATUS_COLORS.warning[isDark ? 'dark' : 'light'] }} />
                <Text strong style={{ fontSize: 14 }}>Waiting longest</Text>
              </Space>
            )}
            extra={<Button type="link" size="small" onClick={() => navigate('/support-tickets?status=open')}>Open the queue</Button>}
          >
            {loading && !backlog ? <TableRowsSkeleton rows={5} /> : (
              <>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={backlog?.oldest || []}
                  columns={oldestColumns}
                  locale={{ emptyText: 'Nothing is waiting' }}
                  onRow={(record) => ({
                    style: { cursor: 'pointer' },
                    onClick: () => navigate(`/support-tickets/${record.id}`),
                  })}
                />
                <MetricLegend
                  definition="The ten oldest open tickets. An aggregate says the queue is slow; this says who is being left waiting."
                  window={windowLabel}
                />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <TeamOutlined style={{ color: TILE.blue.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>Who is carrying it</Text>
              </Space>
            )}
          >
            {loading && !data.agents ? <TableRowsSkeleton rows={4} /> : (
              <>
                <Table
                  size="small"
                  rowKey="adminId"
                  pagination={false}
                  dataSource={data.agents?.agents || []}
                  columns={agentColumns}
                  locale={{ emptyText: 'Nobody replied to a ticket in this period' }}
                />
                <MetricLegend definition={data.agents?.definition} window={windowLabel} />
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={14}>
          <ChartCard
            title="Work that came back"
            subtitle="Tickets reopened after being marked solved"
            loading={loading && !reopens}
            error={errors.reopens}
            onRetry={() => reload()}
            empty={!(reopens?.series || []).some((p) => p.byCustomer > 0 || p.bySupport > 0)}
            emptyText="Nothing has been reopened since tracking began"
            definition="A reopen is counted once per transition out of solved, by whoever caused it."
            /* A zero before this date means "not recorded", not "never
               happened" — the old schema kept no status history at all. The
               empty state is precisely when that needs saying, so it is a
               prop rather than a child. */
            caveat={reopens?.caveat}
            window={windowLabel}
            height={230}
          >
            <TimeSeriesChart
              data={reopens?.series || []}
              series={[
                { field: 'byCustomer', label: 'Customer came back' },
                { field: 'bySupport', label: 'Support took it back' },
              ]}
              kind="column"
              stack
              height={230}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <UndoOutlined style={{ color: STATUS_COLORS.error[isDark ? 'dark' : 'light'] }} />
                <Text strong style={{ fontSize: 14 }}>Reopened most often</Text>
              </Space>
            )}
          >
            {loading && !reopens ? <TableRowsSkeleton rows={4} /> : (
              <>
                {(reopens?.worst || []).map((t) => (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/support-tickets/${t.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/support-tickets/${t.id}`); }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                      gap: 10, marginBottom: 9, cursor: 'pointer',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <Text style={{ fontSize: 12 }} ellipsis>{t.subject}</Text>
                      <div>
                        <Text style={{ fontSize: 10.5, color: muted(isDark) }}>
                          TCK-{1000 + Number(t.number)} · {t.status}
                        </Text>
                      </div>
                    </div>
                    <Tag color="red" style={{ fontSize: 10, flexShrink: 0 }}>
                      ×{t.reopenedCount}
                    </Tag>
                  </div>
                ))}
                {!(reopens?.worst || []).length && (
                  <Text type="secondary" style={{ fontSize: 12.5 }}>Nothing has been reopened yet</Text>
                )}
                <MetricLegend
                  definition="A ticket that keeps coming back is usually a fix that did not hold, not a difficult customer."
                />
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default SupportPage;
