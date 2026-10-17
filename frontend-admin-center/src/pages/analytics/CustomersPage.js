import React, { useState } from 'react';
import {
  Row, Col, Card, Table, Tag, Segmented, Space, Typography, Button, Alert, Progress, Tooltip,
} from 'antd';
import {
  ReloadOutlined, TeamOutlined, ApartmentOutlined, UserAddOutlined,
  RocketOutlined, MailOutlined, ThunderboltOutlined, CreditCardOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import TabHeader from '../../components/analytics/TabHeader';
import ChartCard from '../../components/charts/ChartCard';
import TimeSeriesChart from '../../components/charts/TimeSeriesChart';
import DistributionChart from '../../components/charts/DistributionChart';
import FunnelChart from '../../components/charts/FunnelChart';
import MetricLegend from '../../components/charts/MetricLegend';
import { StatRow, StatCard } from '../../components/StatRow';
import { StatCardsSkeleton, TableRowsSkeleton } from '../../components/Skeletons';
import customersAnalyticsApi from '../../api/customersAnalyticsApi';
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

/** Hours → the roughest unit that still reads honestly. */
const duration = (h) => {
  if (h === null || h === undefined) return '—';
  const hours = Number(h);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
};

/**
 * Customers and organizations.
 *
 * The page is built around one distinction the rest of the admin center keeps
 * blurring: a **user** is a person, an **account** is a Team that owns money.
 * So it is laid out in two halves —
 *
 *   People:   who signed up, did they verify, did they ever deploy
 *   Accounts: personal vs organization, seats, who gets in and who leaves
 *
 * — and every card says which of the two it is counting. The old Analytics
 * page had a single "Users" number that was neither.
 *
 * The activation funnel carries its own honesty block. A funnel over the last
 * 30 days includes somebody who signed up this morning, and reporting their
 * absence from the "deployed" stage as drop-off sends an operator to fix a
 * conversion rate that was never broken. The server returns how many of the
 * cohort are too young to have finished, and that sentence is printed under
 * the funnel rather than left for the reader to think of.
 */
const CustomersPage = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { hasPermission } = usePermission();
  const canSeeRevenue = hasPermission(PERMISSIONS.ANALYTICS_REVENUE);

  const { params: windowParams, key: windowKey, picker } = useAnalyticsWindow();
  const [accountSort, setAccountSort] = useState('members');

  const {
    data, errors, loading, failedCount, reload,
  } = useAnalyticsQuery({
    summary: () => customersAnalyticsApi.getSummary(windowParams),
    signups: () => customersAnalyticsApi.getSignups(windowParams),
    activation: () => customersAnalyticsApi.getActivation(windowParams),
    mix: () => customersAnalyticsApi.getMix(windowParams),
    organizations: () => customersAnalyticsApi.getOrganizations(windowParams),
    invitations: () => customersAnalyticsApi.getInvitations(windowParams),
    memberFlow: () => customersAnalyticsApi.getMemberFlow(windowParams),
    engagement: () => customersAnalyticsApi.getEngagement(windowParams),
    payg: () => customersAnalyticsApi.getPayg(windowParams),
  }, [windowKey]);

  const accountsQuery = useAnalyticsQuery({
    accounts: () => customersAnalyticsApi.getAccounts({ ...windowParams, sort: accountSort, limit: 10 }),
  }, [windowKey, accountSort]);

  const summary = data.summary;
  const activation = data.activation;
  const orgs = data.organizations;
  const invites = data.invitations;
  const engagement = data.engagement;
  const payg = data.payg;
  const windowLabel = summary?.window
    ? `${summary.window.label} · ${summary.window.timezone}`
    : '';

  const mixColumns = [
    {
      title: 'Kind',
      dataIndex: 'label',
      key: 'label',
      render: (label, r) => (
        <Space size={7}>
          {r.kind === 'team' ? <ApartmentOutlined style={{ color: TILE.purple.fg(isDark) }} />
            : <TeamOutlined style={{ color: TILE.blue.fg(isDark) }} />}
          <Text strong style={{ fontSize: 12.5 }}>{label}</Text>
        </Space>
      ),
    },
    {
      title: 'Accounts',
      dataIndex: 'accounts',
      key: 'accounts',
      align: 'right',
      width: 90,
      render: (v, r) => (
        <Tooltip title={`${r.newAccounts} created in this period`}>
          <span style={monoNumeric}>{int(v)}</span>
        </Tooltip>
      ),
    },
    {
      title: 'People',
      key: 'members',
      align: 'right',
      width: 110,
      render: (_, r) => (
        <span style={monoNumeric}>
          {int(r.members)}
          <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 5 }}>
            avg {r.averageMembers}
          </Text>
        </span>
      ),
    },
    {
      title: 'Has a card',
      key: 'card',
      align: 'right',
      width: 110,
      render: (_, r) => (
        <Text style={{ fontSize: 12, color: r.cardPercent < 50 ? STATUS_COLORS.warning[isDark ? 'dark' : 'light'] : undefined }}>
          {r.withCard}/{r.accounts} ({r.cardPercent}%)
        </Text>
      ),
    },
    {
      title: 'Machine hours',
      dataIndex: 'hours',
      key: 'hours',
      align: 'right',
      width: 110,
      render: (v) => <span style={monoNumeric}>{int(v)}h</span>,
    },
    // Absent, not zeroed, when the server stripped it.
    ...(canSeeRevenue ? [{
      title: 'Earned',
      key: 'amount',
      align: 'right',
      width: 140,
      render: (_, r) => (
        <span style={{ ...monoNumeric, whiteSpace: 'nowrap' }}>
          {money(r.amount)}
          <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 5 }}>
            {money(r.revenuePerAccount)}/acct
          </Text>
        </span>
      ),
    }] : []),
  ];

  const accountColumns = [
    {
      title: 'Account',
      dataIndex: 'name',
      key: 'name',
      render: (name, r) => (
        <div>
          <Text strong style={{ fontSize: 12.5 }}>{name}</Text>
          <div>
            <Tag color={r.kind === 'team' ? 'purple' : 'blue'} style={{ fontSize: 10, marginInlineEnd: 0 }}>
              {r.kind === 'team' ? 'Organization' : 'Personal'}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: 'People', dataIndex: 'members', key: 'members', align: 'right', width: 80,
    },
    {
      title: 'Deployments',
      key: 'deployments',
      align: 'right',
      width: 120,
      render: (_, r) => (
        <span style={monoNumeric}>
          {int(r.deployments)}
          {r.running > 0 && (
            <Text style={{ fontSize: 10.5, color: STATUS_COLORS.success[isDark ? 'dark' : 'light'], marginInlineStart: 5 }}>
              {r.running} up
            </Text>
          )}
        </span>
      ),
    },
    {
      title: 'Hours', dataIndex: 'hours', key: 'hours', align: 'right', width: 90, render: (v) => <span style={monoNumeric}>{int(v)}h</span>,
    },
    {
      title: 'Last seen',
      key: 'lastSeen',
      align: 'right',
      width: 110,
      render: (_, r) => (r.daysSinceSeen === null
        ? <Text type="secondary" style={{ fontSize: 11.5 }}>Never</Text>
        : (
          <Text style={{ fontSize: 12, color: r.daysSinceSeen > 30 ? STATUS_COLORS.warning[isDark ? 'dark' : 'light'] : undefined }}>
            {r.daysSinceSeen === 0 ? 'Today' : `${r.daysSinceSeen}d ago`}
          </Text>
        )),
    },
  ];

  const SUBTITLE = 'Who signs up, who becomes a real customer, and what organizations do once they exist';
  const toolbar = (
    <>
      <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={() => reload({ quiet: true })}>
        Refresh
      </Button>
      <PeriodPicker {...picker} />
      {/* The account list is sorted on screen; the file comes out the same way
          round, so the top of the CSV is the top of the table. */}
      <ExportButton tab="customers" params={{ ...windowParams, sort: accountSort }} />
    </>
  );
  const header = embedded ? <TabHeader subtitle={SUBTITLE} extra={toolbar} /> : (
    <PageHeader
      title="Customers & Organizations"
      subtitle={SUBTITLE}
      breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Analytics', path: '/analytics' }, { label: 'Customers' }]}
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

      {/* ── PEOPLE ── */}
      {loading && !summary ? <StatCardsSkeleton count={4} /> : (
        <StatRow>
          <StatCard
            count={4}
            tone="blue"
            icon={<UserAddOutlined />}
            label="New signups"
            value={int(summary?.signups?.count)}
            delta={summary?.signups?.delta}
            caption={`${summary?.signups?.verifiedPercent ?? 0}% verified their email`}
          />
          <StatCard
            count={4}
            tone="purple"
            icon={<ApartmentOutlined />}
            label="New organizations"
            value={int(summary?.accounts?.newOrganizations)}
            delta={summary?.accounts?.newOrganizationsDelta}
            caption={`${summary?.accounts?.organizations ?? 0} in total, ${summary?.accounts?.organizationSharePercent ?? 0}% of all accounts`}
            onClick={() => navigate('/teams')}
          />
          <StatCard
            count={4}
            tone="green"
            icon={<ThunderboltOutlined />}
            label="Active accounts (30d)"
            value={int(engagement?.rolling?.mau)}
            caption={`${engagement?.rolling?.dau ?? 0} today · ${engagement?.rolling?.stickinessPercent ?? 0}% come back daily`}
          />
          <StatCard
            count={4}
            tone="amber"
            icon={<TeamOutlined />}
            label="Average org size"
            value={summary?.organizations?.averageSize ?? 0}
            caption={`${int(summary?.organizations?.memberships)} memberships across ${int(summary?.accounts?.organizations)} organizations`}
          />
        </StatRow>
      )}

      {/* The leak nobody was looking at: people who chose "my company" at
          signup and never finished creating it. They are not undecided, they
          are stuck on a screen. */}
      {summary?.signups?.onboardingUnfinished > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 14, borderRadius: 10 }}
          message={`${summary.signups.onboardingUnfinished} of this period's signups chose "my company" and never finished creating it`}
          description="They are sitting on the organization-setup step. Until it is finished they have a personal account only."
        />
      )}

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        {/* ── Activation funnel ── */}
        <Col xs={24} lg={10}>
          <ChartCard
            title="From signup to a paying machine"
            subtitle="This period's signups, followed through"
            loading={loading && !activation}
            error={errors.activation}
            onRetry={() => reload()}
            empty={!(activation?.stages || []).length || !activation?.stages?.[0]?.count}
            emptyText="Nobody signed up in this period"
            definition="Each stage is a subset of the one above it. Counted by person, not by account."
            window={windowLabel}
          >
            <FunnelChart stages={activation?.stages || []} dropLabel="did not get this far" />
            <MetricLegend
              definition={activation?.timings?.medianHoursToRunning !== null && activation?.timings?.medianHoursToRunning !== undefined
                ? `Median ${duration(activation.timings.medianHoursToRunning)} from signing up to a running machine (p90 ${duration(activation?.timings?.p90HoursToRunning)}).`
                : 'Nobody in this cohort has reached a running machine yet.'}
              /* The censoring warning, straight from the server. */
              caveat={activation?.maturity?.note || activation?.sampleNote || undefined}
            />
            {activation?.fundedWallet !== undefined && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${TILE.blue.bg(isDark)}` }}>
                <Text style={{ fontSize: 12 }}>
                  {int(activation.fundedWallet)} of them put money in a wallet
                  <Text style={{ fontSize: 11, color: muted(isDark), marginInlineStart: 6 }}>
                    ({activation.fundedPercent}%, median {duration(activation?.timings?.medianHoursToFunding)} after signing up)
                  </Text>
                </Text>
                <div>
                  <Text style={{ fontSize: 11, color: muted(isDark) }}>
                    Not a funnel stage — a pay-as-you-go account can run a machine without topping up first.
                  </Text>
                </div>
              </div>
            )}
          </ChartCard>
        </Col>

        {/* ── Signups over time ── */}
        <Col xs={24} lg={14}>
          <ChartCard
            title="Signups over time"
            subtitle="By how they signed up"
            loading={loading && !data.signups}
            error={errors.signups}
            onRetry={() => reload()}
            empty={!(data.signups?.signups || []).some((p) => p.signups > 0)}
            emptyText="No signups in this period"
            definition="Customer accounts only — admin users are excluded."
            /* A prop, not a child: ChartCard replaces its children with the
               empty state, so a caveat written inside them disappears exactly
               when there is least data and most to explain. */
            caveat={data.signups?.caveat}
            window={windowLabel}
            height={250}
          >
            <TimeSeriesChart
              data={data.signups?.signups || []}
              series={[
                { field: 'viaPassword', label: 'Email & password' },
                { field: 'viaGoogle', label: 'Google' },
              ]}
              kind="column"
              stack
              height={250}
            />
          </ChartCard>
        </Col>
      </Row>

      {/* ── ACCOUNTS: personal vs organization ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <ApartmentOutlined style={{ color: TILE.purple.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>What a personal account is worth against an organization</Text>
              </Space>
            )}
          >
            {loading && !data.mix ? <TableRowsSkeleton rows={2} /> : (
              <>
                <Table
                  size="small"
                  rowKey="kind"
                  pagination={false}
                  dataSource={data.mix?.mix || []}
                  columns={mixColumns}
                />
                <MetricLegend
                  definition="Accounts and people are totals as they stand now; deployments, hours and earnings are this period only."
                  window={windowLabel}
                  caveat={!canSeeRevenue ? 'Earnings are hidden — they need the Revenue Analytics permission.' : undefined}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        {/* ── Org size + role mix ── */}
        <Col xs={24} lg={8}>
          <ChartCard
            title="How big our organizations are"
            loading={loading && !orgs}
            error={errors.organizations}
            onRetry={() => reload()}
            empty={!(orgs?.sizeDistribution || []).some((b) => b.organizations > 0)}
            emptyText="No organizations yet"
            definition="Counting every member including the owner. Bands are editable in the analytics policy."
          >
            <DistributionChart
              rows={orgs?.sizeDistribution || []}
              labelField="label"
              valueField="organizations"
              valueFormat={(v) => `${int(v)} org${Number(v) === 1 ? '' : 's'}`}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={8}>
          <ChartCard
            title="Who is in them"
            subtitle="Members by role, across all organizations"
            loading={loading && !orgs}
            error={errors.organizations}
            onRetry={() => reload()}
            empty={!(orgs?.roleMix || []).length}
            emptyText="No organization members yet"
            definition="A person in two organizations is counted once per membership."
          >
            <DistributionChart
              rows={orgs?.roleMix || []}
              labelField="role"
              valueField="people"
              valueFormat={(v) => `${int(v)}`}
            />
          </ChartCard>
        </Col>

        {/* ── Seats over time ── */}
        <Col xs={24} lg={8}>
          <ChartCard
            title="Seats being charged for"
            subtitle="From the daily seat snapshot"
            loading={loading && !orgs}
            error={errors.organizations}
            onRetry={() => reload()}
            empty={(orgs?.seats || []).filter((p) => p.seats > 0).length < 2}
            emptyText="Not enough seat history yet — the seat-fee job writes one snapshot a day"
            definition="Billable seats are total seats minus the free allowance each organization gets."
            // The snapshot caveat has to survive the empty state — that is the
            // state it exists to explain.
            caveat={orgs?.seatsCaveat}
            window={windowLabel}
          >
            <TimeSeriesChart
              data={orgs?.seats || []}
              series={[
                { field: 'seats', label: 'Seats' },
                { field: 'billableSeats', label: 'Billable' },
              ]}
              height={220}
            />
          </ChartCard>
        </Col>
      </Row>

      {/* ── Getting in and leaving ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={8}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <MailOutlined style={{ color: TILE.cyan.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>Invitations</Text>
              </Space>
            )}
          >
            {loading && !invites ? <TableRowsSkeleton rows={4} /> : (
              <>
                {/* With nothing sent there is no rate, and "0%" would read as
                    "nobody accepted" rather than "nobody was asked". The
                    denominator being zero is itself the answer. */}
                <Row gutter={10} style={{ marginBottom: 12 }}>
                  <Col span={12}>
                    <Text style={{ fontSize: 11, color: muted(isDark), display: 'block' }}>Accepted</Text>
                    <Text strong style={{ ...monoNumeric, fontSize: 19 }}>
                      {invites?.sent ? `${invites.acceptanceRate}%` : '—'}
                    </Text>
                  </Col>
                  <Col span={12}>
                    <Text style={{ fontSize: 11, color: muted(isDark), display: 'block' }}>Expired unanswered</Text>
                    <Text
                      strong
                      style={{
                        ...monoNumeric,
                        fontSize: 19,
                        color: invites?.sent && invites.expiryRate > 25
                          ? STATUS_COLORS.warning[isDark ? 'dark' : 'light'] : undefined,
                      }}
                    >
                      {invites?.sent ? `${invites.expiryRate}%` : '—'}
                    </Text>
                  </Col>
                </Row>

                <DistributionChart
                  rows={invites?.outcomes || []}
                  labelField="label"
                  valueField="count"
                  valueFormat={(v) => int(v)}
                  emptyText="No invitations sent in this period"
                />

                <MetricLegend
                  definition={invites?.medianHoursToAccept !== null && invites?.medianHoursToAccept !== undefined
                    ? `${int(invites.sent)} sent. Accepted after a median of ${duration(invites.medianHoursToAccept)} (p90 ${duration(invites.p90HoursToAccept)}).`
                    : `${int(invites?.sent)} sent${invites?.sent ? ', none accepted yet' : ' in this period'}.`}
                  /* An expired invitation is a different problem from a
                     declined one: nobody said no, the email was never opened.
                     Worth saying out loud rather than leaving in a bar. */
                  caveat={invites?.sent && invites.expiryRate > 25
                    ? 'A quarter or more expired without an answer — that usually means delivery, not disinterest.'
                    : (invites?.sent ? invites.sampleNote : undefined) || undefined}
                />

                {(invites?.joinLinks?.issued > 0 || invites?.joinRequests?.requested > 0) && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${TILE.blue.bg(isDark)}` }}>
                    <Text style={{ fontSize: 11.5, color: muted(isDark) }}>
                      Other ways in: {int(invites?.joinLinks?.issued)} join links
                      ({int(invites?.joinLinks?.uses)} uses) · {int(invites?.joinRequests?.requested)} requests
                      ({int(invites?.joinRequests?.approved)} approved, {int(invites?.joinRequests?.waiting)} waiting)
                    </Text>
                  </div>
                )}
              </>
            )}
          </Card>
        </Col>

        {/* ── Member flow ── */}
        <Col xs={24} lg={16}>
          <ChartCard
            title="People joining and leaving organizations"
            subtitle="From each organization's own history"
            loading={loading && !data.memberFlow}
            error={errors.memberFlow}
            onRetry={() => reload()}
            empty={!(data.memberFlow?.series || []).some((p) => p.joined > 0 || p.departed > 0)}
            emptyText="Nobody joined or left an organization in this period"
            definition="Which actions count as joining or leaving is set in the analytics policy."
            window={windowLabel}
            height={240}
          >
            <TimeSeriesChart
              data={data.memberFlow?.series || []}
              series={[
                { field: 'joined', label: 'Joined' },
                { field: 'departed', label: 'Left' },
              ]}
              kind="column"
              height={240}
            />
            <MetricLegend
              definition={`${int(data.memberFlow?.totals?.joined)} joined, ${int(data.memberFlow?.totals?.departed)} left — net ${data.memberFlow?.totals?.net >= 0 ? '+' : ''}${int(data.memberFlow?.totals?.net)}.`}
              /* Departures over AVERAGE headcount, not current: dividing by
                 today's number flatters a shrinking platform. */
              source={data.memberFlow?.totals?.departureRatePercent !== null && data.memberFlow?.totals?.departureRatePercent !== undefined
                ? `${data.memberFlow.totals.departureRatePercent}% of average headcount (${data.memberFlow.totals.averageHeadcount} seats) left in this window`
                : undefined}
            />
          </ChartCard>
        </Col>
      </Row>

      {/* ── Engagement ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={14}>
          <ChartCard
            title="Accounts and people, side by side"
            subtitle="An account can be busy without anyone signing in"
            loading={loading && !engagement}
            error={errors.engagement}
            onRetry={() => reload()}
            empty={!(engagement?.series || []).some((p) => p.accounts > 0)}
            emptyText="No activity recorded in this period"
            definition="Accounts are Teams with activity; people are customer users with a logged action."
            // What "active" means has to be readable even on a quiet period.
            caveat={engagement?.caveat}
            window={windowLabel}
            height={250}
          >
            <TimeSeriesChart
              data={(engagement?.series || []).map((p, i) => ({
                ...p,
                people: engagement?.users?.[i]?.people ?? 0,
                signedIn: engagement?.users?.[i]?.signedIn ?? 0,
              }))}
              series={[
                { field: 'accounts', label: 'Active accounts' },
                { field: 'people', label: 'Active people' },
                { field: 'signedIn', label: 'Signed in' },
              ]}
              height={250}
            />
          </ChartCard>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <ThunderboltOutlined style={{ color: TILE.green.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>How long since each account did anything</Text>
              </Space>
            )}
          >
            {loading && !engagement ? <TableRowsSkeleton rows={5} /> : (
              <>
                <DistributionChart
                  rows={engagement?.dormancy || []}
                  labelField="label"
                  valueField="accounts"
                  valueFormat={(v) => `${int(v)} account${Number(v) === 1 ? '' : 's'}`}
                  limit={6}
                  emptyText="No accounts yet"
                />
                <MetricLegend
                  definition="Bands come from the analytics policy, measured from the most recent of every signal it counts."
                  /* "Never did anything" is a different answer from "dormant
                     for 200 days" and must not be folded into the last band. */
                  caveat={engagement?.neverActive > 0
                    ? `${engagement.neverActive} account${engagement.neverActive === 1 ? ' has' : 's have'} never done anything at all — they are not in the bands above.`
                    : undefined}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>

      {/* ── PAYG ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <CreditCardOutlined style={{ color: TILE.amber.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>Who may run a tab</Text>
              </Space>
            )}
          >
            {loading && !payg ? <TableRowsSkeleton rows={3} /> : (
              <>
                {(payg?.access || []).map((a) => (
                  <div key={a.access} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Text style={{ fontSize: 12 }}>
                        {{
                          allowed: 'Explicitly allowed',
                          blocked: 'Explicitly blocked',
                          default: 'Follows the platform switch',
                        }[a.access] || a.access}
                      </Text>
                      <span style={{ ...monoNumeric, fontSize: 12 }}>
                        {int(a.accounts)}
                        <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 5 }}>
                          {a.withCard} with a card
                        </Text>
                      </span>
                    </div>
                    <Progress
                      percent={a.share}
                      showInfo={false}
                      size="small"
                      strokeColor={a.access === 'blocked'
                        ? STATUS_COLORS.error[isDark ? 'dark' : 'light']
                        : TILE.amber.fg(isDark)}
                    />
                  </div>
                ))}
                <MetricLegend
                  definition="A team set to 'default' follows the platform-wide pay-as-you-go switch in Billing settings. Every other pay-as-you-go rule still applies on top."
                  /* The number that makes the debt on the Revenue page make
                     sense: an account with no card cannot be charged. */
                  caveat="An account with no card on file cannot be charged automatically, so its usage becomes debt."
                />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <ChartCard
            title="Prepaid or pay-as-you-go"
            subtitle="How new deployments chose to be billed"
            loading={loading && !payg}
            error={errors.payg}
            onRetry={() => reload()}
            empty={!(payg?.trend || []).some((p) => p.prepaid > 0 || p.payg > 0)}
            emptyText="No deployments created in this period"
            definition="Counted on the deployment's billing method at the moment it was created."
            window={windowLabel}
            height={240}
          >
            <TimeSeriesChart
              data={payg?.trend || []}
              series={[
                { field: 'prepaid', label: 'Prepaid' },
                { field: 'payg', label: 'Pay as you go' },
              ]}
              kind="column"
              stack
              height={240}
            />
            {canSeeRevenue && (payg?.funding || []).length > 0 && (
              <MetricLegend
                definition={(payg.funding || [])
                  .map((f) => `${f.method}: ${f.debtSharePercent}% of ${money(f.amount)} went onto debt`)
                  .join(' · ')}
                /* A prepaid deployment with debt is not a contradiction — it
                   is a wallet that ran dry part-way through an hour. */
                caveat="A prepaid deployment showing debt means its wallet emptied mid-hour. The time was still billed in full."
              />
            )}
          </ChartCard>
        </Col>
      </Row>

      {/* ── Accounts list ── */}
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24}>
          <Card
            size="small"
            title={(
              <Space size={7}>
                <RocketOutlined style={{ color: TILE.blue.fg(isDark) }} />
                <Text strong style={{ fontSize: 14 }}>Accounts, ranked by use rather than by money</Text>
              </Space>
            )}
            extra={(
              <Segmented
                size="small"
                value={accountSort}
                onChange={setAccountSort}
                options={[
                  { label: 'Most people', value: 'members' },
                  { label: 'Most deployments', value: 'deployments' },
                  { label: 'Most hours', value: 'hours' },
                  { label: 'Quietest', value: 'dormant' },
                  { label: 'Newest', value: 'newest' },
                ]}
              />
            )}
          >
            {accountsQuery.loading && !accountsQuery.data.accounts ? <TableRowsSkeleton rows={5} /> : (
              <>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={accountsQuery.data.accounts?.accounts || []}
                  columns={accountColumns}
                  onRow={(record) => ({
                    style: { cursor: 'pointer' },
                    onClick: () => navigate(record.kind === 'team' ? `/teams/${record.id}` : '/customers'),
                  })}
                />
                <MetricLegend
                  definition="Deployments and people are lifetime totals; hours are this period. Ranked without any money in it, so this list is readable without the Revenue Analytics permission."
                  window={windowLabel}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default CustomersPage;
