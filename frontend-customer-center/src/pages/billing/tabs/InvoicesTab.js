import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Typography, Button, Segmented, Empty, Select, Row, Col, Tag, message,
} from 'antd';
import {
  FileTextOutlined, ArrowUpOutlined, CheckCircleOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import StatusBadge from '../../../components/StatusBadge';
import { StatRow, StatCard } from '../../../components/StatRow';
import { KindIcon } from '../../../components/ChargeKind';
import { StatementBox, SectionHeading, StatementLine } from '../../../components/Statement';
import { useTheme } from '../../../context/ThemeContext';
import { useBilling } from '../../../context/SiteContext';
import {
  cardStyle as surfaceStyle, monoNumeric, STATUS_COLORS, SURFACE,
} from '../../../theme/colors';
import { invoiceTotals } from '../../../utils/invoiceMath';
import billingApi from '../../../api/billingApi';
import { formatDate } from '../../../utils/format';
import { formatAmount } from '../../../utils/money';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

/**
 * Holds a translation *key*, not a label: this is a module-level constant, so
 * there is no `t` in scope here, and a string resolved at import time could
 * never follow a later language change. Call sites do `t(m.labelKey)`.
 */
export const INVOICE_STATUS_META = {
  paid: { tone: 'success', labelKey: 'billing:invoices.paid' },
  partial: { tone: 'warning', labelKey: 'billing:invoices.partial' },
  unpaid: { tone: 'error', labelKey: 'billing:invoices.unpaid' },
  overdue: { tone: 'error', labelKey: 'billing:invoices.overdue' },
};

/*
 * Ledger entry types in the order a customer thinks of them. Money in is
 * whatever put credit into the wallet; money out is where that credit went.
 * `adjustment` can be either, so it is placed by the sign of its amount.
 */
const MONEY_IN = [
  { type: 'topup', labelKey: 'billing:credits.topup', counted: true },
  { type: 'signup_credit', labelKey: 'billing:credits.signupCredit' },
  { type: 'bonus', labelKey: 'billing:credits.bonus' },
  { type: 'refund', labelKey: 'billing:credits.refund' },
  { type: 'adjustment', labelKey: 'billing:credits.adjustment', sign: 1 },
];
const MONEY_OUT = [
  { type: 'charge', labelKey: 'billing:invoices.flowCharge' },
  { type: 'debt_settlement', labelKey: 'billing:invoices.flowSettled' },
  { type: 'adjustment', labelKey: 'billing:credits.adjustment', sign: -1 },
];

// Figures never break across lines — "USD" on one line and the amount on the
// next reads as two values.
const num = { ...monoNumeric, whiteSpace: 'nowrap' };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const yearOf = (iso) => new Date(iso).getUTCFullYear();

/**
 * The figures a statement row shows, rounded once per row and then derived
 * from each other, so every row visibly adds up across (compute + disk =
 * total, paid + due = total) and the footer — built from these rounded
 * figures — adds up down.
 */
const statementFigures = (s) => {
  const total = round2(invoiceTotals(s).total);
  const compute = Math.min(round2(s.computeTotal), total);
  const due = Math.min(round2(s.amountDue), total);
  return {
    total, compute, disk: round2(total - compute), due, paid: round2(total - due),
  };
};

const receiptFigures = (r) => {
  const amount = round2(invoiceTotals(r).total);
  const settled = Math.min(round2(r.settledDebt), amount);
  return { amount, settled, added: round2(amount - settled) };
};

/**
 * Invoices & receipts, laid out like the billing Overview: totals first, then
 * a statement showing where every dollar paid in went, then one table per
 * document type — each with its own columns, because a usage statement and a
 * top-up receipt answer different questions, and a single mixed list could
 * only show the column the two have in common.
 */
const InvoicesTab = () => {
  const { t } = useTranslation(['billing', 'common']);
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { currency } = useBilling();
  const card = surfaceStyle(isDark);
  const border = isDark ? SURFACE.borderDark : SURFACE.borderLight;
  const green = isDark ? STATUS_COLORS.success.dark : STATUS_COLORS.success.light;
  const red = isDark ? STATUS_COLORS.error.dark : STATUS_COLORS.error.light;

  const [invoices, setInvoices] = useState([]);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState('all');
  const [statementFilter, setStatementFilter] = useState('all');

  useEffect(() => {
    billingApi.getInvoices()
      .then((data) => {
        setInvoices(data.invoices || []);
        setLedger(data.ledger || null);
      })
      .catch(() => message.error(t('billing:invoices.loadFailed')))
      .finally(() => setLoading(false));
    // `t` changes identity with the language, so a switch refreshes rather
    // than leaving a message stranded in the previous one.
  }, [t]);

  const money = (n) => `${currency} ${formatAmount(n)}`;

  const years = useMemo(() => {
    const set = new Set(invoices.map((i) => yearOf(i.periodStart || i.issuedAt)));
    return [...set].sort((a, b) => b - a);
  }, [invoices]);

  const inYear = (i) => year === 'all' || yearOf(i.periodStart || i.issuedAt) === year;

  const statements = useMemo(
    () => invoices.filter((i) => i.type === 'usage' && inYear(i))
      .map((s) => ({ ...s, fig: statementFigures(s) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, year],
  );
  const receipts = useMemo(
    () => invoices.filter((i) => i.type === 'receipt' && inYear(i))
      .map((r) => ({ ...r, fig: receiptFigures(r) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, year],
  );

  const shownStatements = statementFilter === 'unpaid'
    ? statements.filter((s) => s.fig.due > 0)
    : statements;

  const sum = (rows, pick) => round2(rows.reduce((acc, r) => acc + pick(r.fig), 0));
  const st = {
    count: statements.length,
    total: sum(statements, (f) => f.total),
    paid: sum(statements, (f) => f.paid),
    due: sum(statements, (f) => f.due),
  };
  const shownTotals = {
    total: sum(shownStatements, (f) => f.total),
    compute: sum(shownStatements, (f) => f.compute),
    disk: sum(shownStatements, (f) => f.disk),
    paid: sum(shownStatements, (f) => f.paid),
    due: sum(shownStatements, (f) => f.due),
  };
  const rc = {
    count: receipts.length,
    amount: sum(receipts, (f) => f.amount),
    settled: sum(receipts, (f) => f.settled),
    added: sum(receipts, (f) => f.added),
  };
  const paidPercent = st.total > 0 ? Math.round((st.paid / st.total) * 100) : 100;

  /*
   * Where the money went, all time. Every line is rounded on its own and
   * "left in wallet" is what remains of the rounded money in, so the two
   * columns always end on the same figure — the whole point of the box is
   * that they visibly balance.
   */
  const flow = useMemo(() => {
    if (!ledger) return null;
    const by = ledger.byType || {};
    const pick = (list, direction) => list
      .map((m) => {
        const row = by[m.type];
        if (!row) return null;
        const amount = row.amount || 0;
        if (m.sign && Math.sign(amount) !== m.sign) return null;
        const value = round2(Math.abs(amount));
        return value > 0 ? { ...m, value, count: row.count, direction } : null;
      })
      .filter(Boolean);
    const moneyIn = pick(MONEY_IN, 'in');
    const moneyOut = pick(MONEY_OUT, 'out');
    const totalIn = round2(moneyIn.reduce((a, l) => a + l.value, 0));
    const spent = round2(moneyOut.reduce((a, l) => a + l.value, 0));
    return {
      moneyIn, moneyOut, totalIn, left: round2(totalIn - spent),
    };
  }, [ledger]);

  const statementColumns = [
    {
      title: t('billing:invoices.colStatement'),
      dataIndex: 'id',
      key: 'id',
      width: 180,
      render: (id, row) => (
        <div>
          <Button
            type="link"
            style={{ padding: 0, height: 'auto', fontWeight: 600 }}
            onClick={(e) => { e.stopPropagation(); navigate(`/billing/invoices/${id}`); }}
          >
            {row.period}
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            <Text type="secondary" style={{ fontSize: 11.5, ...num }}>#{id}</Text>
            {row.isCurrent && (
              <Tag color="processing" style={{ fontSize: 10.5, lineHeight: '16px', marginInlineEnd: 0 }}>
                {t('billing:overview.monthToDate')}
              </Tag>
            )}
          </div>
        </div>
      ),
    },
    {
      title: t('billing:invoices.colDeployments'),
      dataIndex: 'deploymentCount',
      key: 'deployments',
      width: 110,
      align: 'right',
      render: (n) => <Text style={num}>{n || 0}</Text>,
    },
    {
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <KindIcon kind="compute" isDark={isDark} />{t('billing:overview.compute')}
        </span>
      ),
      key: 'compute',
      width: 125,
      align: 'right',
      render: (_, row) => <Text style={num}>{money(row.fig.compute)}</Text>,
    },
    {
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <KindIcon kind="disk" isDark={isDark} />{t('billing:overview.diskStorage')}
        </span>
      ),
      key: 'disk',
      width: 125,
      align: 'right',
      render: (_, row) => <Text style={num}>{money(row.fig.disk)}</Text>,
    },
    {
      title: t('common:label.total'),
      key: 'total',
      width: 125,
      align: 'right',
      render: (_, row) => <Text strong style={num}>{money(row.fig.total)}</Text>,
    },
    {
      title: t('billing:overview.paid'),
      key: 'paid',
      width: 125,
      align: 'right',
      render: (_, row) => (
        <Text style={{ ...num, color: row.fig.paid > 0 ? green : undefined }}>
          {money(row.fig.paid)}
        </Text>
      ),
    },
    {
      title: t('billing:invoice.balanceDue'),
      key: 'due',
      width: 125,
      align: 'right',
      render: (_, row) => (
        <Text strong={row.fig.due > 0} style={{ ...num, color: row.fig.due > 0 ? red : undefined }}>
          {money(row.fig.due)}
        </Text>
      ),
    },
    {
      title: t('common:label.status'),
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (s) => {
        const m = INVOICE_STATUS_META[s] || INVOICE_STATUS_META.unpaid;
        return <StatusBadge tone={m.tone} label={t(m.labelKey)} size="small" />;
      },
    },
  ];

  const statementFooter = (key) => {
    switch (key) {
      case 'id': return <Text strong>{t('common:label.total')}</Text>;
      case 'deployments': return null;
      case 'compute': return <Text strong style={num}>{money(shownTotals.compute)}</Text>;
      case 'disk': return <Text strong style={num}>{money(shownTotals.disk)}</Text>;
      case 'total': return <Text strong style={{ fontSize: 14, ...num }}>{money(shownTotals.total)}</Text>;
      case 'paid': return <Text strong style={{ ...num, color: green }}>{money(shownTotals.paid)}</Text>;
      case 'due': return (
        <Text strong style={{ ...num, color: shownTotals.due > 0 ? red : undefined }}>
          {money(shownTotals.due)}
        </Text>
      );
      default: return null;
    }
  };

  const receiptColumns = [
    {
      title: t('billing:invoices.colReceipt'),
      dataIndex: 'id',
      key: 'id',
      width: 160,
      render: (id) => (
        <Button
          type="link"
          style={{ padding: 0, height: 'auto', fontWeight: 600, ...num }}
          onClick={(e) => { e.stopPropagation(); navigate(`/billing/invoices/${id}`); }}
        >
          #{id}
        </Button>
      ),
    },
    {
      title: t('billing:credits.date'),
      dataIndex: 'issuedAt',
      key: 'date',
      width: 130,
      render: (d) => formatDate(d, 'short'),
    },
    {
      title: t('billing:credits.description'),
      key: 'description',
      ellipsis: true,
      render: (_, row) => <Text>{row.lines?.[0]?.description}</Text>,
    },
    {
      title: t('billing:credits.amount'),
      key: 'amount',
      width: 140,
      align: 'right',
      render: (_, row) => <Text strong style={num}>{money(row.fig.amount)}</Text>,
    },
    {
      title: t('billing:invoices.colPaidOffDebt'),
      key: 'settled',
      width: 170,
      align: 'right',
      render: (_, row) => (
        <Text style={{ ...num, color: row.fig.settled > 0 ? green : undefined }}>
          {money(row.fig.settled)}
        </Text>
      ),
    },
    {
      title: t('billing:invoices.colAddedToBalance'),
      key: 'added',
      width: 170,
      align: 'right',
      render: (_, row) => <Text style={num}>{money(row.fig.added)}</Text>,
    },
  ];

  const receiptFooter = (key) => {
    switch (key) {
      case 'id': return <Text strong>{t('common:label.total')}</Text>;
      case 'amount': return <Text strong style={{ fontSize: 14, ...num }}>{money(rc.amount)}</Text>;
      case 'settled': return <Text strong style={{ ...num, color: green }}>{money(rc.settled)}</Text>;
      case 'added': return <Text strong style={num}>{money(rc.added)}</Text>;
      default: return null;
    }
  };

  const footerRow = (columns, cell) => () => (
    <Table.Summary.Row>
      {columns.map((c, i) => (
        <Table.Summary.Cell key={c.key} index={i} align={c.align}>{cell(c.key)}</Table.Summary.Cell>
      ))}
    </Table.Summary.Row>
  );

  const sectionHeader = (icon, title, extra) => (
    <div style={{
      padding: '14px 20px', borderBottom: `1px solid ${border}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <Text strong style={{ fontSize: 14 }}>{title}</Text>
      </div>
      {extra}
    </div>
  );

  return (
    <>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 16, marginBottom: 20, flexWrap: 'wrap',
      }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>{t('billing:invoices.title')}</Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>{t('billing:invoices.subtitle')}</Text>
        </div>
        <Select
          value={year}
          onChange={setYear}
          style={{ minWidth: 140 }}
          options={[
            { value: 'all', label: t('billing:invoices.allYears') },
            ...years.map((y) => ({ value: y, label: String(y) })),
          ]}
        />
      </div>

      <StatRow>
        <StatCard
          icon={<FileTextOutlined />} tone="blue"
          label={t('billing:invoices.billed')}
          value={formatAmount(st.total)}
          suffix={currency}
          caption={t('billing:invoices.statementsCount', { count: st.count })}
        />
        <StatCard
          icon={<CheckCircleOutlined />} tone="green"
          label={t('billing:overview.paid')}
          value={formatAmount(st.paid)}
          suffix={currency}
          caption={t('billing:invoices.paidPercent', { percent: paidPercent })}
        />
        <StatCard
          icon={<WarningOutlined />} tone={st.due > 0 ? 'amber' : 'green'}
          label={t('billing:invoice.balanceDue')}
          value={formatAmount(st.due)}
          suffix={currency}
          caption={st.due > 0
            ? t('billing:invoices.unpaidCount', { count: statements.filter((s) => s.fig.due > 0).length })
            : t('billing:overview.fullyPaid')}
        />
        <StatCard
          icon={<ArrowUpOutlined />} tone="purple"
          label={t('billing:invoices.moneyAdded')}
          value={formatAmount(rc.amount)}
          suffix={currency}
          caption={t('billing:invoices.topUpsCount', { count: rc.count })}
        />
      </StatRow>

      {flow && flow.totalIn > 0 && (
        <Card style={{ ...card, marginBottom: 22 }} styles={{ body: { padding: 0 } }}>
          {sectionHeader(
            null,
            t('billing:invoices.moneyFlowTitle'),
            <Text type="secondary" style={{ fontSize: 12 }}>{t('billing:invoices.moneyFlowAllTime')}</Text>,
          )}
          <div style={{ padding: 20 }}>
            <Row gutter={[18, 18]}>
              <Col xs={24} md={12}>
                <StatementBox border={border}>
                  <SectionHeading>{t('billing:invoices.moneyIn')}</SectionHeading>
                  {flow.moneyIn.map((l) => (
                    <StatementLine
                      key={`in-${l.type}`}
                      border={border}
                      label={t(l.labelKey)}
                      sub={l.counted ? `× ${l.count}` : undefined}
                      value={money(l.value)}
                    />
                  ))}
                  <StatementLine border={border} total label={t('common:label.total')} value={money(flow.totalIn)} />
                </StatementBox>
              </Col>
              <Col xs={24} md={12}>
                <StatementBox border={border}>
                  <SectionHeading>{t('billing:invoices.moneyOut')}</SectionHeading>
                  {flow.moneyOut.map((l) => (
                    <StatementLine
                      key={`out-${l.type}`}
                      border={border}
                      label={t(l.labelKey)}
                      value={money(l.value)}
                    />
                  ))}
                  <StatementLine border={border} label={t('billing:invoices.flowLeft')} value={money(flow.left)} />
                  <StatementLine border={border} total label={t('common:label.total')} value={money(flow.totalIn)} />
                </StatementBox>
              </Col>
            </Row>
          </div>
        </Card>
      )}

      <Card style={{ ...card, marginBottom: 22 }} styles={{ body: { padding: 0 } }}>
        {sectionHeader(
          <FileTextOutlined />,
          t('billing:invoices.usageStatements'),
          <Segmented
            size="small"
            value={statementFilter}
            onChange={setStatementFilter}
            options={[
              { label: t('billing:invoices.all'), value: 'all' },
              { label: t('billing:invoices.unpaid'), value: 'unpaid' },
            ]}
          />,
        )}
        <Table
          className="ledger-table"
          columns={statementColumns}
          dataSource={shownStatements}
          loading={loading}
          rowKey="id"
          rowClassName="row-hover"
          onRow={(row) => ({
            style: { cursor: 'pointer' },
            onClick: () => navigate(`/billing/invoices/${row.id}`),
          })}
          pagination={shownStatements.length > 12 ? { pageSize: 12 } : false}
          scroll={{ x: 1060 }}
          locale={{ emptyText: <Empty description={t('billing:invoices.empty')} style={{ padding: 40 }} /> }}
          summary={shownStatements.length > 0 ? footerRow(statementColumns, statementFooter) : undefined}
        />
      </Card>

      <Card style={card} styles={{ body: { padding: 0 } }}>
        {sectionHeader(<ArrowUpOutlined />, t('billing:invoices.topUpReceipts'))}
        <Table
          className="ledger-table"
          columns={receiptColumns}
          dataSource={receipts}
          loading={loading}
          rowKey="id"
          rowClassName="row-hover"
          onRow={(row) => ({
            style: { cursor: 'pointer' },
            onClick: () => navigate(`/billing/invoices/${row.id}`),
          })}
          pagination={receipts.length > 12 ? { pageSize: 12 } : false}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description={t('billing:invoices.empty')} style={{ padding: 40 }} /> }}
          summary={receipts.length > 0 ? footerRow(receiptColumns, receiptFooter) : undefined}
        />
      </Card>
    </>
  );
};

export default InvoicesTab;
