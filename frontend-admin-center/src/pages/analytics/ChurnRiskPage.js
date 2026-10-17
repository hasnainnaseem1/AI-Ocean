import React, { useState } from 'react';
import {
  Row, Col, Card, Table, Tag, Space, Typography, Button, Alert, Input, Select, Progress, Tooltip,
} from 'antd';
import { ReloadOutlined, AlertOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import TabHeader from '../../components/analytics/TabHeader';
import ExportButton from '../../components/analytics/ExportButton';
import MetricLegend from '../../components/charts/MetricLegend';
import { TableRowsSkeleton } from '../../components/Skeletons';
import retentionApi from '../../api/retentionApi';
import useAnalyticsQuery from '../../hooks/useAnalyticsQuery';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, monoNumeric } from '../../theme/colors';
import { formatNumber } from '../../utils/helpers';

const { Text } = Typography;

const int = (v) => formatNumber(Math.round(Number(v || 0)));

const BAND_COLOR = {
  healthy: 'green', watch: 'blue', at_risk: 'orange', critical: 'red',
};
const BAND_TONE = (isDark) => ({
  healthy: STATUS_COLORS.success[isDark ? 'dark' : 'light'],
  watch: STATUS_COLORS.info[isDark ? 'dark' : 'light'],
  at_risk: STATUS_COLORS.warning[isDark ? 'dark' : 'light'],
  critical: STATUS_COLORS.error[isDark ? 'dark' : 'light'],
});

/**
 * Accounts that look like they are leaving, and the reasons behind each one.
 *
 * ── What this screen deliberately does not have ──
 *
 * There is no "email them", no "apply a discount", no bulk action of any kind.
 * That was decided when the phase was planned and it is the right call: a
 * churn score is a heuristic assembled from quiet weeks and empty wallets, and
 * an automatic action attached to it is how a paying customer gets chased for
 * going on holiday. The screen produces a list, the reasons, and a file. A
 * person decides what happens next.
 *
 * ── Why reasons are sentences, not chips ──
 *
 * "dormancy · debt · payment_failing" tells an operator nothing they can act
 * on. "No sign-in for 92 days (flagged after 30)" tells them what happened,
 * how big it is, and what rule caught it — including the threshold, so they
 * can tell a real problem from a policy that is set too tight. The sentences
 * are rendered server-side from operator-editable templates, so this file
 * contains no wording of its own.
 */
const ChurnRiskPage = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const tones = BAND_TONE(isDark);

  const [band, setBand] = useState(null);
  const [kind, setKind] = useState(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const {
    data, errors, loading, failedCount, reload,
  } = useAnalyticsQuery({
    risk: () => retentionApi.getChurnRisk({
      band: band || undefined,
      kind: kind || undefined,
      search: query || undefined,
      limit: 200,
    }),
  }, [band, kind, query]);

  const risk = data.risk;
  const accounts = risk?.accounts || [];

  const columns = [
    {
      title: 'Account',
      key: 'account',
      /* Fixed, and narrow. With `tableLayout: fixed` the columns that give no
         width split what is left EQUALLY — so a name that needs 180px took as
         much room as the reasons, and the reasons were cut off mid-sentence.
         The one column that should get the slack is "Why". */
      width: 220,
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: 12.5 }}>{r.teamName}</Text>
          <div>
            <Tag color={r.teamKind === 'team' ? 'purple' : 'blue'} style={{ fontSize: 10, marginInlineEnd: 0 }}>
              {r.teamKind === 'team' ? 'Organization' : 'Personal'}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: 'Risk',
      key: 'score',
      /* 160 was a few pixels short of "At risk" or "Critical" beside a
         three-digit score, so the band tag clipped on exactly the rows that
         matter most. `wrap-cell` matters as much as the extra width: with the
         table's default `nowrap` the progress bar sat on the SAME line as the
         score instead of under it, because nothing was allowed to break. */
      width: 180,
      className: 'wrap-cell',
      render: (_, r) => (
        <div>
          <Space size={6} align="baseline" wrap>
            <Text strong style={{ ...monoNumeric, fontSize: 14 }}>{r.score}</Text>
            <Tag color={BAND_COLOR[r.band] || 'default'} style={{ fontSize: 10, marginInlineEnd: 0 }}>{r.bandLabel}</Tag>
          </Space>
          <Progress
            percent={r.score}
            showInfo={false}
            size="small"
            strokeColor={tones[r.band]}
          />
        </div>
      ),
    },
    {
      title: 'Why',
      key: 'reasons',
      /* The column that justifies the whole page. Every sentence carries its
         own figure and the threshold it crossed, so a row can be judged
         without opening anything. */
      /*
       * `wrap-cell` is the escape hatch index.css already provides for exactly
       * this. Admin tables set `white-space: nowrap` on every cell on purpose
       * — one long email should clip rather than turn a 36px row into a 70px
       * one and break the table's rhythm — and this column is the exception
       * that rule anticipates: genuine prose. Without it a gateway error ended
       * mid-word as "...are not enablec", with no sign it had been cut.
       */
      className: 'wrap-cell',
      render: (_, r) => (r.reasons.length ? (
        <div>
          {r.reasons.map((reason) => (
            <div key={reason.key} style={{ marginBottom: 3 }}>
              <Text style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                <span style={{ color: tones[r.band], marginInlineEnd: 5 }}>•</span>
                {reason.sentence}
              </Text>
            </div>
          ))}
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 11.5 }}>Nothing is wrong with this account</Text>
      )),
    },
    {
      title: 'Last seen',
      key: 'lastSeen',
      width: 110,
      align: 'right',
      render: (_, r) => (r.signals.daysSinceLogin === null
        ? <Text type="secondary" style={{ fontSize: 11.5 }}>Never</Text>
        : (
          <Tooltip title={`${r.signals.daysSinceUsage === null ? 'no usage recorded' : `${r.signals.daysSinceUsage}d since usage`}`}>
            <Text style={{ fontSize: 12 }}>{r.signals.daysSinceLogin}d ago</Text>
          </Tooltip>
        )),
    },
    {
      title: 'Running',
      key: 'running',
      width: 90,
      align: 'right',
      render: (_, r) => (
        <Tooltip title={`${r.signals.deployments} deployment(s) all time`}>
          <span style={monoNumeric}>{int(r.signals.running)}</span>
        </Tooltip>
      ),
    },
  ];

  const SUBTITLE = 'Scored from how each account is behaving right now — a prompt to look, not a verdict';
  const toolbar = (
    <>
      <Button icon={<ReloadOutlined />} size="small" loading={loading} onClick={() => reload({ quiet: true })}>
        Refresh
      </Button>
      {/* The filters go with it: the file is the list being looked at, not the
          whole platform. There is no window here — this tab reads the latest
          snapshot, so there is nothing for a date range to narrow. */}
      <ExportButton
        tab="churn-risk"
        params={{ band: band || undefined, kind: kind || undefined, search: query || undefined }}
      />
    </>
  );

  return (
    <div>
      {embedded ? <TabHeader subtitle={SUBTITLE} extra={toolbar} /> : (
        <PageHeader
          title="At-risk accounts"
          subtitle={SUBTITLE}
          breadcrumbs={[
            { label: 'Home', path: '/' },
            { label: 'Analytics', path: '/analytics' },
            { label: 'At risk' },
          ]}
          extra={<Space>{toolbar}</Space>}
        />
      )}

      {failedCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message="Could not build the at-risk list"
          description={Object.values(errors).join(' · ')}
          action={<Button size="small" onClick={() => reload()}>Retry</Button>}
        />
      )}

      {/* Said once, at the top, and meant: nothing on this screen has been
          sent to anybody. */}
      <Alert
        type="info"
        showIcon
        icon={<AlertOutlined />}
        style={{ marginBottom: 14, borderRadius: 10 }}
        message="Nothing here has been sent to anyone"
        description="This list exists so a person can decide what to do. No email, notification or restriction follows from a score."
      />

      <Row gutter={[14, 14]}>
        <Col xs={24}>
          <Card size="small">
            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space wrap size={8}>
                {/* Band chips double as the summary — the counts are the
                    distribution, so a separate chart would be the same data
                    drawn twice. */}
                <Button
                  size="small"
                  type={band === null ? 'primary' : 'default'}
                  onClick={() => setBand(null)}
                >
                  All {risk ? `(${risk.scoredAccounts})` : ''}
                </Button>
                {(risk?.bands || []).map((b) => (
                  <Button
                    key={b.key}
                    size="small"
                    type={band === b.key ? 'primary' : 'default'}
                    onClick={() => setBand(band === b.key ? null : b.key)}
                  >
                    {b.label} ({b.count})
                  </Button>
                ))}
              </Space>
              <Space wrap size={8}>
                <Select
                  size="small"
                  allowClear
                  placeholder="Any kind"
                  style={{ width: 150 }}
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'team', label: 'Organizations' },
                    { value: 'personal', label: 'Personal accounts' },
                  ]}
                />
                <Input
                  size="small"
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="Find an account"
                  style={{ width: 200 }}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onPressEnter={() => setQuery(search)}
                  onBlur={() => setQuery(search)}
                />
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24}>
          <Card size="small">
            {loading && !risk ? <TableRowsSkeleton rows={6} /> : (
              <>
                <Table
                  size="small"
                  rowKey="teamId"
                  /* Fixed layout so the reason column WRAPS. With antd's
                     default auto layout a single long sentence — a gateway
                     error message, say — sizes its column to the full text and
                     pushes the right-hand columns off the card. */
                  tableLayout="fixed"
                  pagination={{ pageSize: 20, size: 'small', showSizeChanger: false }}
                  dataSource={accounts}
                  columns={columns}
                  locale={{ emptyText: 'No accounts match these filters' }}
                  onRow={(record) => ({
                    style: { cursor: 'pointer' },
                    onClick: () => navigate(record.teamKind === 'team' ? `/teams/${record.teamId}` : '/customers'),
                  })}
                />
                <MetricLegend
                  definition={risk?.definition}
                  source={risk ? `${risk.total} of ${risk.scoredAccounts} accounts match the current filters` : undefined}
                  /* Thresholds are policy, so the page says which ones it
                     used rather than implying they are fixed. */
                  caveat={risk?.thresholds
                    ? `Thresholds in use: dormant after ${risk.thresholds.dormantDays}d, no usage after ${risk.thresholds.noUsageDays}d, wallet below $${risk.thresholds.walletBelow}. All editable in the analytics policy.`
                    : undefined}
                />
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ChurnRiskPage;
