import React, { useEffect, useState } from 'react';
import { Card, Typography, Button, Table, Result, Spin, Tooltip, message } from 'antd';
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import { KindIcon, kindColor } from '../../components/ChargeKind';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useSite, useBilling } from '../../context/SiteContext';
import { cardStyle as surfaceStyle, monoNumeric, SURFACE, STATUS_COLORS } from '../../theme/colors';
import { invoiceTotals, lineTotal } from '../../utils/invoiceMath';
import { formatHours, humanDuration } from '../../utils/duration';
import { formatRate, formatAmount } from '../../utils/money';
import { getBillingInfo } from '../../utils/billingMock';
import billingApi from '../../api/billingApi';
import { INVOICE_STATUS_META } from './tabs/InvoicesTab';
import { formatDate } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

/** A labelled block in the From / To header strip. */
const Party = ({ label, lines, align = 'left' }) => (
  <div style={{ textAlign: align }}>
    <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {label}
    </Text>
    <div style={{ marginTop: 6 }}>
      {lines.filter(Boolean).map((line, i) => (
        <Text
          key={i}
          strong={i === 0}
          style={{ display: 'block', fontSize: i === 0 ? 14 : 12.5 }}
          type={i === 0 ? undefined : 'secondary'}
        >
          {line}
        </Text>
      ))}
    </div>
  </div>
);

const InvoiceDetailPage = () => {
  const { t } = useTranslation(['billing', 'common']);
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const { siteConfig } = useSite();
  const { currency } = useBilling();
  const card = surfaceStyle(isDark);
  const borderColor = isDark ? SURFACE.borderDark : SURFACE.borderLight;

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    billingApi.getInvoices()
      .then((data) => setInvoice((data.invoices || []).find((i) => i.id === id) || null))
      .catch(() => message.error(t('billing:invoice.loadFailed')))
      .finally(() => setLoading(false));
    // `t` changes identity with the language, so a switch refreshes rather
    // than leaving a message stranded in the previous one.
  }, [id, t]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  if (!invoice) {
    return (
      <Result
        status="404"
        title={t('billing:invoice.notFound')}
        subTitle={t('billing:invoice.removed')}
        extra={<Button type="primary" onClick={() => navigate('/billing?tab=invoices')}>{t('billing:invoice.back')}</Button>}
      />
    );
  }

  const { subtotal, tax, total } = invoiceTotals(invoice);
  const statusMeta = INVOICE_STATUS_META[invoice.status] || INVOICE_STATUS_META.unpaid;
  const isUsage = invoice.type === 'usage';
  const billingInfo = getBillingInfo();

  const trimmedName = user?.name?.trim();
  const hasDistinctName = !!trimmedName && trimmedName.toLowerCase() !== user?.email?.toLowerCase();
  const billedTo = billingInfo.name || (hasDistinctName ? trimmedName : user?.email?.split('@')[0]) || 'Customer';

  const columns = [
    {
      title: t('billing:invoice.serialNo'),
      key: 'index',
      width: 70,
      render: (_, __, i) => <Text type="secondary" style={monoNumeric}>{i + 1}</Text>,
    },
    {
      title: isUsage ? t('billing:invoice.deployment') : t('billing:invoice.description'),
      key: 'description',
      render: (_, row) => (
        <div>
          <Text strong style={{ display: 'block', fontSize: 13.5 }}>{row.description}</Text>
          {row.sublabel && <Text type="secondary" style={{ fontSize: 12 }}>{row.sublabel}</Text>}
        </div>
      ),
    },
    // Which of the two things the line charges for, in the same icon and
    // colour as the billing Overview — so a deployment's compute line and its
    // disk line read as two different charges, not a duplicated row.
    ...(isUsage ? [{
      title: t('billing:credits.type'),
      dataIndex: 'kind',
      key: 'kind',
      width: 150,
      render: (kind) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <KindIcon kind={kind} isDark={isDark} />
          <Text style={{ fontSize: 12.5, color: kindColor(kind, isDark) }}>
            {kind === 'disk' ? t('billing:overview.diskStorage') : t('billing:overview.compute')}
          </Text>
        </span>
      ),
    }] : []),
    {
      title: isUsage ? t('billing:invoice.hours') : t('billing:invoice.qty'),
      dataIndex: 'quantity',
      width: 110,
      align: 'right',
      render: (q, row) => (isUsage ? (
        // Hours at the precision they were billed at, so hours × rate lands on
        // the charge shown in the last column. Rounded to one decimal, a
        // 0.2248h line read "0.2 hrs × 15.49 = 3.48" — an invoice that
        // contradicts its own arithmetic.
        <Tooltip title={humanDuration(q)}>
          <Text style={monoNumeric}>{formatHours(q)}</Text>
        </Tooltip>
      ) : (
        <Text style={monoNumeric}>{q}{row.unit ? ` ${row.unit}` : ''}</Text>
      )),
    },
    {
      title: isUsage ? t('billing:invoice.ratePerHour') : t('billing:invoice.unitCost'),
      dataIndex: 'unitCost',
      width: 130,
      align: 'right',
      // Usage is priced to three decimals — rounding an hourly rate of 1.469 to
      // 1.47 on a statement leaves the line's own multiplication visibly off.
      render: (c) => <Text style={monoNumeric}>{currency} {isUsage ? formatRate(c) : formatAmount(c)}</Text>,
    },
    {
      title: t('common:label.total'),
      key: 'total',
      width: 130,
      align: 'right',
      render: (_, row) => <Text strong style={monoNumeric}>{currency} {formatAmount(lineTotal(row))}</Text>,
    },
  ];

  const summaryRow = (label, value, strong, color) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 40,
      padding: '7px 0', minWidth: 260,
    }}>
      <Text type={strong ? undefined : 'secondary'} strong={strong} style={{ fontSize: strong ? 15 : 13 }}>
        {label}
      </Text>
      <Text strong={strong} style={{ fontSize: strong ? 15 : 13, ...monoNumeric, color }}>
        {currency} {formatAmount(value)}
      </Text>
    </div>
  );

  /*
   * How much of a usage statement is paid, under its total — the part every
   * real invoice has and this one did not: a total and an "Unpaid" badge left
   * the customer to work out what they had already paid and what was left.
   *
   * Figures from the server (statementService), the same ones the list and the
   * Overview show. Rounded before they are combined, so Paid + Balance due is
   * the total printed above them.
   */
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const showSettlement = isUsage && invoice.amountPaid !== undefined;
  const balanceDue = r2(invoice.amountDue);
  const paidTotal = r2(r2(total) - balanceDue);
  const paidAtCharge = r2(Math.min(r2(invoice.paidAtCharge), paidTotal));
  const paidLater = r2(paidTotal - paidAtCharge);

  // Compute vs disk under the subtotal, so the two kinds of charge add up to
  // it in plain sight. Disk is the remainder, so the pair always sums exactly.
  const lineSum = (kind) => r2((invoice.lines || [])
    .filter((l) => l.kind === kind).reduce((acc, l) => acc + lineTotal(l), 0));
  const hasKinds = isUsage && (invoice.lines || []).some((l) => l.kind);
  const computeSum = hasKinds ? Math.min(lineSum('compute'), r2(subtotal)) : 0;
  const diskSum = r2(r2(subtotal) - computeSum);

  // Where a top-up's money went: first to anything owed, the rest into the
  // wallet. Same figures as the receipts table on the Invoices tab.
  const isReceipt = invoice.type === 'receipt' && invoice.settledDebt !== undefined;
  const receiptSettled = r2(Math.min(r2(invoice.settledDebt), r2(total)));
  const receiptAdded = r2(r2(total) - receiptSettled);

  return (
    <>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/billing?tab=invoices')} style={{ paddingInlineStart: 0 }}>
          {t('billing:invoice.back')}
        </Button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Print is also how a customer saves a PDF (the browser's own
              "Save as PDF"). The separate Download button only ever showed a
              "not wired up yet" message, so it is gone until it is real. */}
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>{t('billing:invoice.print')}</Button>
        </div>
      </div>

      <Card style={card} styles={{ body: { padding: 0 } }}>
        {/* ── Document header ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 16, padding: '24px 28px', borderBottom: `1px solid ${borderColor}`, flexWrap: 'wrap',
        }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {isUsage ? t('billing:invoice.usageStatement') : t('billing:invoice.paymentReceipt')}
            </Title>
            {isUsage && invoice.period && (
              <Text type="secondary" style={{ fontSize: 13 }}>{invoice.period}</Text>
            )}
          </div>
          <div style={{ textAlign: 'end' }}>
            <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>ID : #{invoice.id}</Text>
            <div style={{ marginTop: 6 }}>
              <StatusBadge tone={statusMeta.tone} label={t(statusMeta.labelKey)} />
            </div>
          </div>
        </div>

        {/* ── From / To ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 32,
          padding: '24px 28px', borderBottom: `1px solid ${borderColor}`, flexWrap: 'wrap',
        }}>
          <Party
            label={t('billing:invoice.from')}
            lines={[
              siteConfig?.siteName || t('billing:invoice.defaultCompany'),
              siteConfig?.supportEmail,
              t('billing:invoice.defaultCompanyTagline'),
            ]}
          />
          <Party
            label={t('billing:invoice.billedTo')}
            align="right"
            lines={[
              billedTo,
              billingInfo.company,
              user?.email,
              billingInfo.street,
              [billingInfo.city, billingInfo.postalCode].filter(Boolean).join(', '),
              billingInfo.country,
              billingInfo.vatId ? `VAT ${billingInfo.vatId}` : null,
            ]}
          />
        </div>

        {/* ── Dates ── */}
        <div style={{
          display: 'flex', gap: 48, padding: '18px 28px',
          borderBottom: `1px solid ${borderColor}`, flexWrap: 'wrap',
        }}>
          <div>
            <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>
              {t('billing:invoice.issuedOn')}
            </Text>
            <Text style={{ fontSize: 13.5 }}>{formatDate(invoice.issuedAt, 'long')}</Text>
          </div>
          {invoice.dueAt && (
            <div>
              <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>
                {t('billing:invoice.dueOn')}
              </Text>
              <Text style={{ fontSize: 13.5 }}>{formatDate(invoice.dueAt, 'long')}</Text>
            </div>
          )}
        </div>

        {/* ── Line items ── */}
        <div style={{ padding: '20px 28px' }}>
          <Table
            className="ledger-table"
            columns={columns}
            dataSource={invoice.lines}
            rowKey={(_, i) => i}
            pagination={false}
            scroll={{ x: 640 }}
          />

          {/* ── Summary ── */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                {t('billing:invoice.summary')}
              </Text>
              {hasKinds && (
                <>
                  {summaryRow(t('billing:overview.compute'), computeSum)}
                  {summaryRow(t('billing:overview.diskStorage'), diskSum)}
                </>
              )}
              {summaryRow(t('billing:invoice.subtotal'), subtotal)}
              {invoice.taxRate > 0 && summaryRow(`VAT (${Math.round(invoice.taxRate * 100)}%)`, tax)}
              <div style={{ borderTop: `1px solid ${borderColor}`, marginTop: 6, paddingTop: 4 }}>
                {summaryRow(t('common:label.total'), total, true)}
              </div>
              {showSettlement && (
                <div style={{ borderTop: `1px solid ${borderColor}`, marginTop: 6, paddingTop: 4 }}>
                  {summaryRow(t('billing:overview.paid'), paidTotal, false, STATUS_COLORS.success.light)}
                  <div style={{ paddingInlineStart: 14 }}>
                    {summaryRow(t('billing:overview.paidAtCharge'), paidAtCharge)}
                    {summaryRow(t('billing:overview.paidLater'), paidLater)}
                  </div>
                  {summaryRow(
                    t('billing:invoice.balanceDue'), balanceDue, true,
                    balanceDue > 0 ? STATUS_COLORS.error.light : undefined,
                  )}
                </div>
              )}
              {isReceipt && (
                <div style={{ borderTop: `1px solid ${borderColor}`, marginTop: 6, paddingTop: 4 }}>
                  {summaryRow(t('billing:invoices.colPaidOffDebt'), receiptSettled, false,
                    receiptSettled > 0 ? STATUS_COLORS.success.light : undefined)}
                  {summaryRow(t('billing:invoices.colAddedToBalance'), receiptAdded)}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </>
  );
};

export default InvoiceDetailPage;
