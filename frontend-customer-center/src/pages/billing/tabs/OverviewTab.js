import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Row, Col, Typography, Button, Table, Alert, Tooltip, Progress, Empty,
  Select, Segmented, DatePicker,
} from 'antd';
import {
  ThunderboltOutlined, RiseOutlined, CalendarOutlined, FileTextOutlined,
  WalletOutlined, ArrowRightOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { StatRow, StatCard } from '../../../components/StatRow';
import EmptyBalanceAlert from '../../../components/EmptyBalanceAlert';
import { KindIcon, kindColor } from '../../../components/ChargeKind';
import { StatementBox, SectionHeading, StatementLine } from '../../../components/Statement';
import { StatCardsSkeleton, TableRowsSkeleton } from '../../../components/Skeletons';
import walletApi from '../../../api/walletApi';
import deploymentsApi from '../../../api/deploymentsApi';
import billingApi from '../../../api/billingApi';
import { useTheme } from '../../../context/ThemeContext';
import { useBilling } from '../../../context/SiteContext';
import {
  cardStyle as surfaceStyle, getBrand, monoNumeric, GRADIENT, SURFACE, STATUS_COLORS,
} from '../../../theme/colors';
import { formatHours, humanDuration, formatClock } from '../../../utils/duration';
import { formatRate, formatAmount } from '../../../utils/money';
import { formatDate, EMPTY } from '../../../utils/format';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const MONTH = (d) => formatDate(d, 'monthYear');

/**
 * Money, at the precision it is displayed at.
 *
 * Every figure on this page is shown to two decimals, so every figure that
 * a reader can add up has to BE two decimals before it is added. Summing
 * the raw values and rounding once at the end is the obvious way to do it
 * and it is wrong on screen: three lines of 3,878.896 / 0 / 3.1259 print as
 * 3,878.90 + 0.00 + 3.13, which a customer adds to 3,882.03 while the
 * total prints 3,882.02. A column that does not add up is exactly the kind
 * of thing that makes a bill look untrustworthy, so the rounding happens
 * per line and the totals are built from the rounded lines.
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A period's totals, rolled up from the same per-deployment figures the
 * table prints one to a row.
 *
 * Deliberately NOT read from the server's own `total` field, even though
 * that field is correct: it is the raw sum, and the rows on screen are each
 * rounded to the cent before the reader ever sees them. Rolling up the
 * rounded rows is what makes the headline figure equal to what someone gets
 * by adding the table with their own eyes.
 */
const rollUp = (usage, includeUnbilled) => {
  let compute = 0;
  let storage = 0;
  let unbilled = 0;
  let unbilledHours = 0;
  (usage?.deployments || []).forEach((d) => {
    compute += round2(d.running?.cost || 0);
    storage += round2(d.storage?.cost || 0);
    if (includeUnbilled && d.unbilled?.cost > 0) {
      unbilled += round2(d.unbilled.cost);
      unbilledHours += d.unbilled.hours || 0;
    }
  });
  const billed = round2(round2(compute) + round2(storage));
  return {
    compute: round2(compute),
    storage: round2(storage),
    unbilled: round2(unbilled),
    unbilledHours,
    billed,
    accrued: round2(billed + round2(unbilled)),
  };
};

const hasCharge = (part) => (part?.cost || part?.amount || 0) > 0 || (part?.hours || 0) > 0;

/**
 * Round a list of amounts to cents so that they add up to `target` exactly.
 *
 * Rounding each day on its own let eleven days of one deployment add up to
 * USD 3,711.70 under a row that read USD 3,711.68. Each day is floored to
 * the cent and the cents left over go to the days that lost the most to the
 * floor (largest remainder), so every day is still within a cent of its true
 * value and the column sums to the figure printed above it.
 */
const apportion = (values, target) => {
  const cents = values.map((v) => v * 100);
  const out = cents.map((c) => Math.floor(c + 1e-9));
  let left = Math.round(target * 100) - out.reduce((a, b) => a + b, 0);
  const order = cents.map((c, i) => [c - out[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) out[order[k][1]] += 1;
  for (let k = order.length - 1; left < 0 && k >= 0; k -= 1, left += 1) out[order[k][1]] -= 1;
  return out.map((c) => c / 100);
};

/**
 * One deployment's charges day by day, compute and disk in columns of their
 * own. The old breakdown put both into one sentence per day, which is exactly
 * where a disk charge on a paused day disappeared into the compute next to it.
 */
const DeploymentDays = ({
  daily, currency, isDark, showCompute, showDisk, computeTarget, diskTarget,
}) => {
  const { t } = useTranslation(['billing', 'common']);
  const border = isDark ? SURFACE.borderDark : SURFACE.borderLight;
  const days = (daily || []).filter((d) => (showCompute && hasCharge(d.running)) || (showDisk && hasCharge(d.storage)));
  if (!days.length) return <Text type="secondary" style={{ fontSize: 12.5 }}>{EMPTY}</Text>;

  // Each column's days, apportioned to the total the row shows for it.
  const spread = (key, target) => {
    const idx = days.map((d, i) => [i, d[key]?.cost || 0]).filter(([, v]) => v > 0);
    const parts = apportion(idx.map(([, v]) => v), target);
    const res = days.map(() => 0);
    idx.forEach(([i], k) => { res[i] = parts[k]; });
    return res;
  };
  const computeCents = spread('running', computeTarget);
  const diskCents = spread('storage', diskTarget);

  const cols = ['110px', showCompute && '1fr', showDisk && '1fr', '130px'].filter(Boolean).join(' ');
  const head = { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' };
  const row = { display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '6px 0', borderBottom: `1px solid ${border}` };
  const part = (p, amount) => (hasCharge(p) ? (
    <span>
      <span style={{ fontSize: 12.5, ...monoNumeric }}>{currency} {formatAmount(amount)}</span>
      <Text type="secondary" style={{ fontSize: 11.5, marginInlineStart: 6, ...monoNumeric }}>{formatHours(p.hours)}</Text>
    </span>
  ) : <Text type="secondary">{EMPTY}</Text>);

  return (
    <div style={{ paddingBlock: 4, paddingInline: '8px 16px' }}>
      <div style={row}>
        <Text type="secondary" style={head}>{t('billing:credits.date')}</Text>
        {showCompute && (
          <Text type="secondary" style={head}>
            <KindIcon kind="compute" isDark={isDark} style={{ marginInlineEnd: 5 }} />{t('billing:overview.compute')}
          </Text>
        )}
        {showDisk && (
          <Text type="secondary" style={head}>
            <KindIcon kind="disk" isDark={isDark} style={{ marginInlineEnd: 5 }} />{t('billing:overview.diskStorage')}
          </Text>
        )}
        <Text type="secondary" style={{ ...head, textAlign: 'end' }}>{t('billing:overview.dayTotal')}</Text>
      </div>
      {days.map((d, i) => {
        const total = round2((showCompute ? computeCents[i] : 0) + (showDisk ? diskCents[i] : 0));
        return (
          <div key={d.date} style={row}>
            <Text style={{ fontSize: 12.5, ...monoNumeric }}>{formatDate(`${d.date}T00:00:00Z`, 'billingDay')}</Text>
            {showCompute && part(d.running, computeCents[i])}
            {showDisk && part(d.storage, diskCents[i])}
            <Text strong style={{ fontSize: 12.5, textAlign: 'end', ...monoNumeric }}>{currency} {formatAmount(total)}</Text>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Spend over the selected period, one bar per day (a month) or per month (a
 * year), each bar split into compute and disk. A paused day reads as an amber
 * bar instead of a blue one that is merely shorter.
 */
const UsageBars = ({ bars, todayIndex, currency, isDark }) => {
  const { t } = useTranslation('billing');
  const max = Math.max(...bars.map((b) => b.compute + b.disk), 0.01);
  const future = isDark ? 'rgba(255,255,255,0.06)' : '#EEF1FA';
  const computeColor = kindColor('compute', isDark);
  const diskColor = kindColor('disk', isDark);

  return (
    <div
      /*
       * `direction: 'ltr'` is load-bearing: under `dir="rtl"` a flex row
       * reverses, putting day 1 on the right and highlighting the wrong end.
       * RTL mirrors interface chrome, not a time axis. Tooltips portal out of
       * this container, so they still read right-to-left.
       */
      // A fixed height, not a min-height: the bars are sized in percent, and a
      // percentage of a height that is only a minimum resolves to nothing —
      // every bar collapsed to its 3px floor.
      style={{
        display: 'flex', alignItems: 'flex-end', gap: bars.length > 16 ? 3 : 10, height: 160, direction: 'ltr',
      }}
    >
      {bars.map((b, i) => {
        const isFuture = i > todayIndex;
        const total = b.compute + b.disk;
        const pct = isFuture || total <= 0 ? 2 : Math.max((total / max) * 100, 4);
        return (
          <Tooltip
            key={b.key}
            title={isFuture ? `${b.label} · ${t('overview.upcoming')}` : (
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{b.label}</div>
                <div>{t('overview.compute')}: {currency} {formatAmount(b.compute)}</div>
                <div>{t('overview.diskStorage')}: {currency} {formatAmount(b.disk)}</div>
              </div>
            )}
          >
            <div
              style={{
                flex: 1, minWidth: 0, height: `${pct}%`, minHeight: 3,
                borderRadius: '4px 4px 0 0', overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                background: future,
                opacity: isFuture || i === todayIndex ? 1 : 0.8,
              }}
            >
              {!isFuture && total > 0 && (
                <>
                  {b.disk > 0 && <div style={{ flex: `${b.disk} 0 0`, minHeight: 3, background: diskColor }} />}
                  {b.compute > 0 && <div style={{ flex: `${b.compute} 0 0`, background: computeColor }} />}
                </>
              )}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
};

/**
 * The cost dashboard — what a pay-as-you-go account actually needs to see:
 * how much this month has cost so far, how fast that number is climbing, what
 * it will land at, and which deployments are responsible. Prepaid credit is a
 * secondary funding source and lives on its own tab.
 */
const OverviewTab = ({ onGoToTab }) => {
  const { t } = useTranslation(['billing', 'common']);
  const { isDark } = useTheme();
  const { currency, creditsEnabled } = useBilling();
  const card = surfaceStyle(isDark);
  const BRAND = getBrand(isDark);
  const borderColor = isDark ? SURFACE.borderDark : SURFACE.borderLight;

  const [wallet, setWallet] = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [usage, setUsage] = useState(null);
  const [lastMonthUsage, setLastMonthUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /*
   * ONE period for everything below the live cards — the chart, the bill
   * summary and the spend table all follow it. Day, month or year, picked
   * with a calendar.
   *
   * The stat cards above it are deliberately NOT tied to it: "month-to-date",
   * "forecast" and "run rate" describe the present, and a closed period has
   * none of those.
   *
   * Dates are billing days, which are UTC — the same days the server buckets
   * usage into — so "today" is taken in UTC rather than the browser's zone.
   */
  const todayUtc = new Date().toISOString().slice(0, 10);
  const [periodUnit, setPeriodUnit] = useState('month');
  const [periodAnchor, setPeriodAnchor] = useState(() => dayjs(todayUtc));
  const [viewedUsage, setViewedUsage] = useState(null);
  const [viewedLoading, setViewedLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [deploymentFilter, setDeploymentFilter] = useState([]);

  const periodFrom = periodAnchor.startOf(periodUnit).format('YYYY-MM-DD');
  const periodTo = periodAnchor.endOf(periodUnit).format('YYYY-MM-DD');
  const isCurrentPeriod = periodFrom <= todayUtc && todayUtc <= periodTo;
  const isThisMonth = periodUnit === 'month' && isCurrentPeriod;

  const load = useCallback(() => {
    setLoading(true);
    /*
     * Both months come from the usage endpoint rather than from the credit
     * ledger. The ledger looks like the obvious source and is the wrong one:
     * pay-as-you-go charges that the wallet could not cover are written as
     * `debt_accrual`, not `charge`, so filtering the ledger for charges
     * reported a pay-as-you-go customer's spend as zero while the table below
     * — which reads the usage rows — showed the real figure on the same
     * screen. The usage rows are what the billing job actually wrote, for
     * every billing method, so there is one answer to "what did this cost me".
     */
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevMonth = prev.toISOString().slice(0, 7);

    Promise.all([
      creditsEnabled ? walletApi.get() : Promise.resolve({ wallet: null }),
      deploymentsApi.list({ limit: 100 }),
      billingApi.getUsage().catch(() => null),
      billingApi.getUsage(prevMonth).catch(() => null),
    ])
      .then(([w, d, u, prevU]) => {
        // One outstanding figure for the whole page. The usage response reads
        // the balance in the same request it builds the bill summary from, so
        // taking it from there keeps the alert, the stat tile and every box
        // of the summary on the same number — two separate requests could
        // straddle a billing run and disagree.
        setWallet(w.wallet && u?.outstanding !== undefined
          ? { ...w.wallet, outstandingBalance: u.outstanding }
          : w.wallet);
        setDeployments(d.deployments || []);
        setUsage(u);
        setLastMonthUsage(prevU);
        setError(null);
      })
      .catch((err) => setError(err.response?.data?.message || t('billing:overview.loadFailed')))
      .finally(() => setLoading(false));
    // `t` changes identity with the language, so a switch refreshes rather
    // than leaving a message stranded in the previous one.
  }, [creditsEnabled, t]);

  useEffect(load, [load]);

  useEffect(() => {
    // The current month is already loaded for the cards above — reuse it.
    if (isThisMonth) { setViewedUsage(usage); return undefined; }
    let cancelled = false;
    setViewedLoading(true);
    billingApi.getUsage({ from: periodFrom, to: periodTo })
      .then((u) => { if (!cancelled) setViewedUsage(u); })
      .catch(() => { if (!cancelled) setViewedUsage(null); })
      .finally(() => { if (!cancelled) setViewedLoading(false); });
    // A quick second pick must not let the first, slower answer land last.
    return () => { cancelled = true; };
  }, [isThisMonth, periodFrom, periodTo, usage]);

  if (loading) {
    return (
      <>
        <StatCardsSkeleton count={4} />
        <TableRowsSkeleton rows={5} />
      </>
    );
  }

  if (error) {
    return <Alert type="error" showIcon message={error} action={<Button onClick={load}>{t('common:action.retry')}</Button>} />;
  }

  /* ── Period maths ─────────────────────────────────────────────────────── */
  const now = new Date();
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysRemaining = daysInMonth - dayOfMonth;

  // Rolled up from the rounded per-deployment rows rather than taken from
  // the raw server total, so the headline agrees to the cent with the table
  // further down the page. See rollUp().
  const currentRoll = rollUp(usage, true);
  const billedSpend = currentRoll.billed;
  // Time already on the clock that the billing job has not charged for yet.
  // Real money the customer has committed, so it belongs in what this month
  // has cost — just labelled as the estimate it is wherever it is shown.
  const accruedUnbilled = currentRoll.unbilled;
  const mtdSpend = currentRoll.accrued;
  const lastMonthSpend = round2(lastMonthUsage?.total ?? 0);

  const burnPerHour = wallet?.burnRatePerHour ?? 0;
  const burnPerDay = wallet?.burnRatePerDay ?? burnPerHour * 24;

  /* ── Forecast ─────────────────────────────────────────────────────────────
   *
   * "Today's run rate × the days left" on its own is arithmetic, not a
   * forecast, and on a prepaid account it is arithmetic about something that
   * cannot happen: a machine burning USD 16.96/hr against a USD 49 balance is
   * stopped in three hours, so projecting USD 7,750 over the rest of the month
   * describes a world in which the customer's own balance does not exist. The
   * number was alarming, unreachable, and told nobody anything.
   *
   * The two billing methods have to be projected differently, because they end
   * differently when the money runs out:
   *
   *   prepaid — billing stops the deployment at the grace balance, so this
   *             half can never cost more than the spendable credit on hand.
   *             Capped at exactly that.
   *   payg    — never stopped for balance; the shortfall becomes debt. This
   *             half genuinely does run to the end of the month, so it is
   *             projected in full and not capped by anything.
   *
   * Both halves are floored at zero and the cap is only ever applied to the
   * prepaid share, so a mixed account gets the right answer rather than one
   * method's rule imposed on the other.
   */
  const prepaidPerHour = wallet?.burnRateByMethod?.prepaid ?? burnPerHour;
  const paygPerHour = wallet?.burnRateByMethod?.payg ?? 0;
  const hoursRemaining = daysRemaining * 24;

  /*
   * How long the wallet lasts is measured against the TOTAL burn, not the
   * prepaid share alone. Pay-as-you-go draws the wallet down first as well and
   * only turns the shortfall into debt, so it empties the same balance at the
   * same time. Dividing by the prepaid share instead said "your credit covers
   * 1.4 days" directly beneath a low-balance banner reading "about 0.1 days
   * left" — two numbers from the same wallet, contradicting each other.
   */
  const spendableCredit = Math.max(0, (wallet?.balance ?? 0) - (wallet?.stopAtBalance ?? 0));
  const creditHours = creditsEnabled && burnPerHour > 0
    ? spendableCredit / burnPerHour
    : Infinity;

  const prepaidHours = Math.min(hoursRemaining, creditHours);
  const projectedPrepaid = prepaidPerHour * prepaidHours;
  const projectedPayg = paygPerHour * hoursRemaining;
  const forecast = mtdSpend + projectedPrepaid + projectedPayg;

  // True when the balance, not the calendar, is what ends the month — the
  // caption has to say so, or a capped number looks like a broken one. Only
  // meaningful when something prepaid is actually running: pay-as-you-go is
  // never stopped for balance, so an empty wallet does not bound it.
  const creditRunsOut = prepaidPerHour > 0 && creditHours < hoursRemaining;

  const vsLastMonth = lastMonthSpend > 0
    ? Math.round(((forecast - lastMonthSpend) / lastMonthSpend) * 100)
    : null;

  const storageOnly = (usage?.storage?.cost || 0) > 0 && (usage?.running?.cost || 0) === 0;
  /*
   * What disks are costing per day right now. Counts PAUSED deployments as
   * well as stopped ones — both keep their disk and both are charged for it
   * (STORAGE_BILLABLE_STATUSES on the server). Counting only "stopped" is how
   * this read "USD 0.00 a day" while the table listed disk charges.
   */
  const diskPerDay = deployments
    .filter((d) => ['paused', 'stopped'].includes(d.status))
    .reduce((sum, d) => sum + (d.stoppedPricePerHour || 0) * 24, 0);

  const runningCount = deployments.filter((d) => d.status === 'running').length;
  const balance = wallet?.balance ?? 0;
  const outstanding = Number(wallet?.outstandingBalance) || 0;

  /* ── The selected period ───────────────────────────────────────────────── */
  const viewedRoll = rollUp(viewedUsage, isCurrentPeriod);
  const computeTotal = viewedRoll.compute;
  const storageTotal = viewedRoll.storage;
  const unbilledTotal = viewedRoll.unbilled;
  const billedTotal = viewedRoll.billed;
  const accruedTotal = viewedRoll.accrued;
  const viewedUnbilled = unbilledTotal;
  const usageDeployments = viewedUsage?.deployments || [];

  // Noon, so no timezone can move the date a day either way when formatting.
  const periodDate = (ymd) => new Date(`${ymd}T12:00:00Z`);
  let periodLabel = MONTH(periodDate(periodFrom));
  if (periodUnit === 'day') periodLabel = formatDate(periodDate(periodFrom), 'medium');
  if (periodUnit === 'year') periodLabel = periodFrom.slice(0, 4);

  /*
   * The chart's bars: a day each for a month, a month each for a year. Built
   * from the server's per-day split, so the bars add up to the table below.
   * No chart for a single day — one bar says nothing the table does not.
   */
  let bars = [];
  let todayIndex = -1;
  if (periodUnit === 'month') {
    const days = periodAnchor.daysInMonth();
    bars = Array.from({ length: days }, (_, i) => {
      const ymd = `${periodFrom.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
      return { key: ymd, label: formatDate(periodDate(ymd), 'medium'), compute: 0, disk: 0 };
    });
    todayIndex = isCurrentPeriod ? Number(todayUtc.slice(8, 10)) - 1 : days - 1;
  } else if (periodUnit === 'year') {
    const year = Number(periodFrom.slice(0, 4));
    bars = Array.from({ length: 12 }, (_, i) => ({
      key: `${year}-${i}`, label: MONTH(new Date(Date.UTC(year, i, 15))), compute: 0, disk: 0,
    }));
    todayIndex = isCurrentPeriod ? Number(todayUtc.slice(5, 7)) - 1 : 11;
  }
  if (bars.length) {
    usageDeployments.forEach((d) => {
      (d.daily || []).forEach((day) => {
        const i = periodUnit === 'month' ? Number(day.date.slice(8, 10)) - 1 : Number(day.date.slice(5, 7)) - 1;
        if (!bars[i]) return;
        bars[i].compute += day.running?.cost || 0;
        bars[i].disk += day.storage?.cost || 0;
      });
      // The un-billed tail lands on today's bar, by what it is accruing for.
      if (isCurrentPeriod && d.unbilled?.cost > 0 && bars[todayIndex]) {
        bars[todayIndex][d.unbilled.kind === 'storage' ? 'disk' : 'compute'] += d.unbilled.cost;
      }
    });
  }
  const todayBarTotal = bars[todayIndex] ? bars[todayIndex].compute + bars[todayIndex].disk : 0;

  /* ── Spend by deployment ──────────────────────────────────────────────────
   *
   * One row per deployment, with compute and disk in columns of their own —
   * the question this table has to answer at a glance is "is this machine
   * costing me for running, or only for the disk it is holding?". It used to
   * be one row per deployment per charge type, which listed the same machine
   * two or three times and made that question a matter of reading labels.
   *
   * Every figure is rounded to the cent before it is summed, so a row adds up
   * across and the footer adds up down — and with no filters on, the footer
   * is exactly the "Usage this period" box above it.
   */
  const showCompute = typeFilter !== 'disk';
  const showDisk = typeFilter !== 'compute';
  const tailVisible = (row) => !!row.unbilled && (row.unbilled.kind === 'compute' ? showCompute : showDisk);

  const depRows = usageDeployments
    .filter((d) => !deploymentFilter.length || deploymentFilter.includes(d.deploymentId))
    .map((d) => ({
      key: d.deploymentId,
      name: d.name,
      detail: [d.model, d.tier].filter(Boolean).join(' · '),
      status: d.status,
      compute: { hours: d.running.hours, rate: d.running.rate, amount: round2(d.running.cost) },
      disk: { hours: d.storage.hours, rate: d.storage.rate, amount: round2(d.storage.cost) },
      unbilled: isCurrentPeriod && d.unbilled?.cost > 0 ? {
        kind: d.unbilled.kind === 'storage' ? 'disk' : 'compute',
        hours: d.unbilled.hours,
        since: d.unbilled.since,
        amount: round2(d.unbilled.cost),
      } : null,
      daily: d.daily || [],
    }))
    .filter((r) => (showCompute && (hasCharge(r.compute) || r.unbilled?.kind === 'compute'))
      || (showDisk && (hasCharge(r.disk) || r.unbilled?.kind === 'disk')))
    .map((r) => ({
      ...r,
      total: round2((showCompute ? r.compute.amount : 0) + (showDisk ? r.disk.amount : 0)
        + (tailVisible(r) ? r.unbilled.amount : 0)),
    }));

  const tableTotals = {
    compute: round2(depRows.reduce((sum, r) => sum + r.compute.amount, 0)),
    disk: round2(depRows.reduce((sum, r) => sum + r.disk.amount, 0)),
    unbilled: round2(depRows.reduce((sum, r) => sum + (tailVisible(r) ? r.unbilled.amount : 0), 0)),
    total: round2(depRows.reduce((sum, r) => sum + r.total, 0)),
  };
  depRows.forEach((r) => { r.share = tableTotals.total ? r.total / tableTotals.total : 0; });

  /* ── How the period was funded ────────────────────────────────────────────
   *
   * Both figures come from the usage rows the billing job wrote, so they sum
   * to the billed total exactly — the wallet paid what it could and the rest
   * went onto the outstanding balance. Showing them is the difference
   * between a statement that reconciles and one that lists a charge and
   * leaves the customer to guess whether they have already paid it.
   */
  /*
   * The outstanding balance's movement over the period, rounded the same way
   * everything else on this page is: each printed line first, then the
   * closing figure from exactly those lines — so "opening + charges −
   * payments" adds up to the number underneath it when a reader checks it by
   * hand. `settled` is taken as the sum of the payment rows shown rather
   * than the server's own total, so the indented events and the line above
   * them can never disagree either.
   */
  const rawMovement = viewedUsage?.debtMovement;
  const settlements = (rawMovement?.settlements || []).map((s) => ({ ...s, amount: round2(s.amount) }));
  const movement = {
    opening: round2(rawMovement?.opening ?? 0),
    settled: round2(settlements.reduce((sum, s) => sum + s.amount, 0)),
    settlements,
    /*
     * For the month in progress the closing figure IS the live balance, so
     * it is taken from the wallet payload that the alert, the stat tile and
     * the Account box all read. They are separate requests and this account
     * accrues by the second, so deriving it here instead put "USD 789.76" a
     * cent away from "USD 789.75" three inches above it.
     */
    closing: isCurrentPeriod ? round2(outstanding) : round2(rawMovement?.closing ?? 0),
  };
  // Charges are then the balancing line, so the column still adds up exactly
  // as printed. It moves by at most the cent the other figures' rounding did.
  movement.accrued = round2(movement.closing + movement.settled - movement.opening);

  /*
   * How much of this period's bill is paid — counting BOTH ways a charge gets
   * paid: by the balance at the moment it was written, and by a top-up that
   * later paid off the debt it created. This box used to show only the first
   * and call it "Paid from wallet", which told a customer who had topped up
   * USD 2,766 to clear September that they had paid USD 343 of it.
   *
   * From the server (statementService), the same figures the Invoices tab
   * shows for this statement. Still-unpaid is read as-is; "paid" is then the
   * rest of the bill printed above it, so the column adds up by eye.
   */
  const settlement = viewedUsage?.settlement;
  const stillUnpaid = round2(settlement?.stillOwed ?? 0);
  const paidTotal = round2(billedTotal - stillUnpaid);
  const paidAtCharge = round2(Math.min(settlement?.paidAtCharge ?? 0, paidTotal));
  const paidLater = round2(paidTotal - paidAtCharge);

  /*
   * The breakdown under "Charges your balance couldn't cover" is only shown
   * when it adds up to that line exactly. It always does when all of the
   * period's debt came from this period's bill; when older debt is in the
   * picture the two can legitimately differ, and printing a sum that does
   * not match the line above it would be worse than printing none.
   */
  const showDebtOrigin = movement.accrued > 0
    && round2(billedTotal - paidAtCharge) === movement.accrued;

  const chargeCell = (part) => (hasCharge(part) ? (
    <div>
      <Text strong style={{ fontSize: 13, ...monoNumeric }}>{currency} {formatAmount(part.amount)}</Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 11.5, ...monoNumeric }}>
        {formatHours(part.hours)} × {currency} {formatRate(part.rate)}{t('common:units.perHour')}
      </Text>
    </div>
  ) : <Text type="secondary">{EMPTY}</Text>);

  const kindTitle = (kind, labelKey) => (
    <span style={{ whiteSpace: 'nowrap' }}>
      <KindIcon kind={kind} isDark={isDark} style={{ marginInlineEnd: 6 }} />{t(labelKey)}
    </span>
  );

  const columns = [
    {
      title: t('billing:invoice.deployment'),
      key: 'deployment',
      render: (_, row) => (
        <div>
          <Text strong style={{ display: 'block', fontSize: 13.5 }}>{row.name}</Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{row.detail}</Text>
          {row.status && (
            <Text type="secondary" style={{ display: 'block', fontSize: 11.5 }}>
              {t(`common:status.${row.status}`, row.status)}
            </Text>
          )}
        </div>
      ),
    },
    showCompute && {
      title: kindTitle('compute', 'billing:overview.compute'),
      key: 'compute',
      align: 'right',
      width: 200,
      render: (_, row) => chargeCell(row.compute),
    },
    showDisk && {
      title: kindTitle('disk', 'billing:overview.diskStorage'),
      key: 'disk',
      align: 'right',
      width: 200,
      render: (_, row) => chargeCell(row.disk),
    },
    isCurrentPeriod && {
      title: t('billing:overview.inProgress'),
      key: 'unbilled',
      align: 'right',
      width: 150,
      render: (_, row) => (tailVisible(row) ? (
        <Tooltip title={t('billing:overview.chargedNextRun', { duration: humanDuration(row.unbilled.hours) })}>
          <div>
            <Text style={{ fontSize: 13, color: BRAND, ...monoNumeric }}>
              <KindIcon kind={row.unbilled.kind} isDark={isDark} style={{ marginInlineEnd: 5 }} />
              ≈ {currency} {formatAmount(row.unbilled.amount)}
            </Text>
            <Text type="secondary" style={{ display: 'block', fontSize: 11.5 }}>
              {t('billing:overview.since').trim()} {formatClock(row.unbilled.since)}
            </Text>
          </div>
        </Tooltip>
      ) : <Text type="secondary">{EMPTY}</Text>),
    },
    {
      title: t('billing:overview.share'),
      key: 'share',
      width: 140,
      render: (_, row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Progress
            percent={Math.round(row.share * 100)}
            showInfo={false}
            size="small"
            strokeColor={BRAND}
            style={{ flex: 1, marginBottom: 0 }}
          />
          <Text type="secondary" style={{ fontSize: 12, width: 34, textAlign: 'end', ...monoNumeric }}>
            {Math.round(row.share * 100)}%
          </Text>
        </div>
      ),
    },
    {
      title: t('common:label.total'),
      key: 'total',
      align: 'right',
      width: 140,
      render: (_, row) => <Text strong style={{ fontSize: 13.5, ...monoNumeric }}>{currency} {formatAmount(row.total)}</Text>,
    },
  ].filter(Boolean);

  const footerCell = (key) => {
    if (key === 'deployment') return <Text strong>{t('common:label.total')}</Text>;
    if (key === 'compute') return <Text strong style={monoNumeric}>{currency} {formatAmount(tableTotals.compute)}</Text>;
    if (key === 'disk') return <Text strong style={monoNumeric}>{currency} {formatAmount(tableTotals.disk)}</Text>;
    if (key === 'unbilled') {
      return tableTotals.unbilled > 0
        ? <Text strong style={{ color: BRAND, ...monoNumeric }}>≈ {currency} {formatAmount(tableTotals.unbilled)}</Text>
        : null;
    }
    if (key === 'total') return <Text strong style={{ fontSize: 14, ...monoNumeric }}>{currency} {formatAmount(tableTotals.total)}</Text>;
    return null;
  };

  return (
    <>
      <EmptyBalanceAlert
        wallet={wallet}
        deployments={deployments}
        currency={currency}
        creditsEnabled={creditsEnabled}
        onAddCredit={() => onGoToTab?.('credits')}
        onAddCard={() => onGoToTab?.('cards')}
      />

      {creditsEnabled && wallet?.isLow && balance > 0 && (
        <Alert
          type="warning" showIcon
          message={t('billing:overview.lowBalance')}
          description={
            wallet.runwayDays !== null
              ? t('billing:overview.runwayDays', { count: wallet.runwayDays, amount: `${currency} ${formatAmount(burnPerDay)}` })
              : t('billing:overview.lowBalanceBody')
          }
          action={<Button size="small" onClick={() => onGoToTab?.('credits')}>{t('common:action.addCredit')}</Button>}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />
      )}

      {/* ── Headline numbers ── */}
      <StatRow>
        {/* The month-to-date figure is what this whole tab exists to answer. */}
        <StatCard lg={8} style={{ background: GRADIENT, border: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 13, flexShrink: 0,
              background: 'rgba(255,255,255,0.22)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>
              <FileTextOutlined />
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
              textTransform: 'uppercase', lineHeight: 1.35, color: 'rgba(255,255,255,0.85)',
            }}>
              {t('billing:overview.monthToDateCharges')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', color: '#fff', ...monoNumeric }}>
              {formatAmount(mtdSpend)}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{currency}</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'rgba(255,255,255,0.8)' }}>
            {burnPerHour > 0
              ? t('billing:overview.growingBy', { amount: `${currency} ${formatAmount(burnPerHour)}`, suffix: storageOnly ? t('billing:overview.allStorage') : '' })
              : t('billing:overview.monthNothingRunning', { month: MONTH(now) })}
          </div>
          {/* Says outright that part of this figure is an estimate, and how
              much — otherwise the headline quietly disagrees with the credit
              ledger by whatever has not been charged yet. */}
          {accruedUnbilled > 0 && (
            <div style={{ marginTop: 4, fontSize: 11.5, color: 'rgba(255,255,255,0.72)' }}>
              {t('billing:overview.billedSoFar', {
                billed: `${currency} ${formatAmount(billedSpend)}`,
                unbilled: `${currency} ${formatAmount(accruedUnbilled)}`,
              })}
            </div>
          )}
        </StatCard>

        <StatCard
          lg={8}
          icon={<RiseOutlined />} tone="pink"
          label={t('billing:overview.forecastThisMonth')}
          value={formatAmount(forecast)}
          suffix={currency}
          caption={
            daysRemaining === 0
              ? t('billing:overview.finalDayOfPeriod')
              : creditRunsOut
                // Says what actually limits the number, so a forecast that is
                // lower than rate × days doesn't read as a miscalculation.
                ? `Your credit covers about ${creditHours < 24
                  ? humanDuration(creditHours)
                  : `${(creditHours / 24).toFixed(1)} days`} more — prepaid deployments pause at that point unless you top up`
                : t('billing:overview.atTodaysRate', { count: daysRemaining })
          }
        />

        <StatCard
          lg={8}
          icon={<ThunderboltOutlined />} tone="cyan"
          label={t('billing:overview.currentRunRate')}
          value={formatAmount(burnPerHour)}
          suffix={`${currency}${t('common:units.perHour')}`}
          caption={
            runningCount > 0
              ? t('billing:overview.deploymentsPerDay', { count: runningCount, amount: `${currency} ${formatAmount(burnPerDay)}` })
              : burnPerHour > 0
                // Nothing running but still accruing means stopped deployments
                // are being charged for the storage they hold. Saying only
                // "nothing is running" next to a live hourly rate reads as a
                // contradiction, and leaves the customer with no idea why the
                // number is going up.
                ? t('billing:overview.storageOnlyPerDay', { amount: `${currency} ${formatAmount(burnPerDay)}` })
                : t('billing:credits.nothingRunning')
          }
        />

        <StatCard
          lg={8}
          icon={<CalendarOutlined />} tone="purple"
          label={t('billing:overview.lastMonth')}
          value={formatAmount(lastMonthSpend)}
          suffix={currency}
          delta={vsLastMonth}
          caption={
            vsLastMonth === null
              ? t('billing:overview.noChargesLastMonth')
              // Two keys rather than splicing "higher"/"lower" into one
              // sentence: an adjective lands in a different place — and takes
              // a different form — in most of the languages this ships in.
              : t(vsLastMonth >= 0 ? 'billing:overview.forecastHigher' : 'billing:overview.forecastLower',
                { percent: Math.abs(vsLastMonth) })
          }
        />

        {creditsEnabled && (
          <StatCard
            lg={8}
            icon={<WalletOutlined />}
            tone={outstanding > 0 ? 'amber' : 'green'}
            label={t('billing:overview.outstandingBalance')}
            value={formatAmount(outstanding)}
            suffix={currency}
            caption={
              outstanding > 0 && wallet?.debtCreditLimit > 0
                ? t('billing:overview.ofLimit', { limit: `${currency} ${formatAmount(wallet.debtCreditLimit)}` })
                : t('billing:overview.fullyPaid')
            }
          />
        )}
      </StatRow>

      {/* ── The period everything below follows ── */}
      <div
        style={{
          ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
          padding: '12px 16px', marginBottom: 20,
        }}
      >
        <CalendarOutlined style={{ color: BRAND, fontSize: 16 }} />
        <Text strong style={{ fontSize: 13.5 }}>{t('billing:overview.periodHeading')}</Text>
        <Segmented
          size="small"
          value={periodUnit}
          onChange={setPeriodUnit}
          options={[
            { label: t('billing:overview.periodDay'), value: 'day' },
            { label: t('billing:overview.periodMonth'), value: 'month' },
            { label: t('billing:overview.periodYear'), value: 'year' },
          ]}
        />
        <DatePicker
          size="small"
          picker={periodUnit === 'day' ? 'date' : periodUnit}
          value={periodAnchor}
          allowClear={false}
          onChange={(v) => v && setPeriodAnchor(v)}
          disabledDate={(d) => d.startOf(periodUnit).format('YYYY-MM-DD') > todayUtc}
          style={{ width: 170 }}
        />
        <Text type="secondary" style={{ fontSize: 12.5, marginInlineStart: 'auto' }}>{periodLabel}</Text>
      </div>

      {bars.length > 0 && (
        <Card
          style={{ ...card, marginBottom: 24 }}
          styles={{ body: { padding: '20px 24px', display: 'flex', flexDirection: 'column' } }}
          title={periodUnit === 'year'
            ? t('billing:overview.monthlyUsage', { year: periodLabel })
            : t('billing:overview.dailyUsage', { month: periodLabel })}
          extra={(
            <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
              {['compute', 'disk'].map((kind) => (
                <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: kindColor(kind, isDark) }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t(kind === 'disk' ? 'billing:overview.diskStorage' : 'billing:overview.compute')}
                  </Text>
                </span>
              ))}
            </div>
          )}
        >
          <UsageBars bars={bars} todayIndex={todayIndex} currency={currency} isDark={isDark} />
          {/* Pinned ltr for the same reason UsageBars is: it labels the ends of
              the chart's time axis, which must not mirror under RTL. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, direction: 'ltr' }}>
            <Text type="secondary" style={{ fontSize: 11.5 }}>{periodUnit === 'month' ? '1' : bars[0].label}</Text>
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              {isThisMonth
                ? t('billing:overview.todayTotal', { amount: `${currency} ${formatAmount(todayBarTotal)}` })
                : t('billing:overview.monthTotal', { amount: `${currency} ${formatAmount(accruedTotal)}` })}
              {isCurrentPeriod && viewedUnbilled > 0
                && t('billing:overview.todayUnbilled', { amount: `${currency} ${formatAmount(viewedUnbilled)}` })}
            </Text>
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              {periodUnit === 'month' ? String(bars.length) : bars[bars.length - 1].label}
            </Text>
          </div>
        </Card>
      )}

      {/* ── Bill summary ───────────────────────────────────────────────────
        *
        * Three ledgers that used to be one undifferentiated list of rows,
        * which is what made the page unreadable: "Used, not billed yet
        * USD 0.63" sat directly above "Outstanding balance USD 753.31" with
        * nothing to say they answer different questions, so the two looked
        * like they should relate to each other and obviously did not.
        *
        * They are separate boxes now, each with its own heading and its own
        * ruled total, and each one adds up on its own:
        *
        *   usage    compute + storage + un-billed tail = total accrued
        *   funding  paid from wallet + added to debt   = total billed
        *   account  the standing position, all time, not this period
        *
        * The funding split is the line the customer was missing entirely —
        * without it a charge is shown with no way to tell whether it has
        * already been paid.
        */}
      <Card
        style={{ ...card, marginBottom: 24 }}
        styles={{ body: { padding: '20px 24px' } }}
        title={t('billing:overview.billSummary')}
        extra={<Text type="secondary" style={{ fontSize: 12.5 }}>{periodLabel}</Text>}
      >
        <Row gutter={[16, 16]}>
          {/* ── What it cost ── */}
          <Col xs={24} lg={8}>
            <StatementBox border={borderColor}>
              <SectionHeading>{t('billing:overview.sectionUsage')}</SectionHeading>
              <StatementLine
                label={<><KindIcon kind="compute" isDark={isDark} style={{ marginInlineEnd: 6 }} />{t('billing:overview.compute')}</>}
                sub={formatHours(viewedUsage?.running?.hours || 0)}
                value={`${currency} ${formatAmount(computeTotal)}`}
              />
              <StatementLine
                label={<><KindIcon kind="disk" isDark={isDark} style={{ marginInlineEnd: 6 }} />{t('billing:overview.diskStorage')}</>}
                sub={formatHours(viewedUsage?.storage?.hours || 0)}
                value={`${currency} ${formatAmount(storageTotal)}`}
              />
              {/* Deliberately NOT called "not billed yet". That wording put
                  the word "billed" next to a money figure on a page that
                  also shows an outstanding balance, and a customer reading
                  quickly took it to mean "money I still owe" — when it is
                  the opposite: minutes the meter has run since the last
                  charge, which nobody could have paid yet. Naming it for
                  the clock instead of the invoice removes the collision. */}
              {viewedUnbilled > 0 && (
                <StatementLine
                  label={<><ClockCircleOutlined style={{ marginInlineEnd: 6 }} />{t('billing:overview.inProgress')}</>}
                  sub={formatHours(viewedRoll.unbilledHours)}
                  value={`≈ ${currency} ${formatAmount(unbilledTotal)}`}
                  color={BRAND}
                />
              )}
              <StatementLine
                total
                border={borderColor}
                label={t('billing:overview.totalAccrued')}
                value={`${currency} ${formatAmount(accruedTotal)}`}
              />
              {isThisMonth && (
                <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 8 }}>
                  {t('billing:overview.periodEnds')}
                  {' '}
                  {formatDate(nextMonthStart, 'monthDay')}
                </Text>
              )}
            </StatementBox>
          </Col>

          {/* ── How it was paid ── */}
          <Col xs={24} lg={8}>
            <StatementBox border={borderColor}>
              <SectionHeading>{t('billing:overview.sectionFunding')}</SectionHeading>
              {/* The billed figure leads, and the two ways it was covered sit
                  indented underneath it. Written the other way round — two
                  lines adding up to a total at the bottom — it read as
                  "money you paid PLUS money you owe", and the user's
                  reaction was exactly that: "total q krhe". It is one amount
                  split two ways, not two amounts summed. */}
              <StatementLine
                lead
                border={borderColor}
                label={t('billing:overview.totalBilled')}
                value={`${currency} ${formatAmount(billedTotal)}`}
              />
              <StatementLine
                indent
                label={t('billing:overview.paid')}
                value={`${currency} ${formatAmount(paidTotal)}`}
                color={paidTotal > 0 ? STATUS_COLORS.success.light : undefined}
              />
              {/* The two ways it got paid, one level further in. The second is
                  the one this box used to leave out entirely. */}
              <div style={{ paddingInlineStart: 12 }}>
                <StatementLine
                  indent
                  label={<Text type="secondary" style={{ fontSize: 12 }}>{t('billing:overview.paidAtCharge')}</Text>}
                  value={<Text type="secondary" style={{ fontSize: 12.5, ...monoNumeric }}>{`${currency} ${formatAmount(paidAtCharge)}`}</Text>}
                />
                <StatementLine
                  indent
                  label={<Text type="secondary" style={{ fontSize: 12 }}>{t('billing:overview.paidLater')}</Text>}
                  value={<Text type="secondary" style={{ fontSize: 12.5, ...monoNumeric }}>{`${currency} ${formatAmount(paidLater)}`}</Text>}
                />
              </div>
              <StatementLine
                indent
                label={t('billing:overview.stillUnpaid')}
                value={`${currency} ${formatAmount(stillUnpaid)}`}
                color={stillUnpaid > 0 ? STATUS_COLORS.error.light : undefined}
              />
              {viewedUnbilled > 0 && (
                <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 8 }}>
                  {t('billing:overview.unbilledNotFunded')}
                </Text>
              )}
            </StatementBox>
          </Col>

          {/* ── Where the account stands ── */}
          <Col xs={24} lg={8}>
            <StatementBox border={borderColor}>
              <SectionHeading>{t('billing:overview.sectionAccount')}</SectionHeading>
              <StatementLine
                label={<><WalletOutlined style={{ marginInlineEnd: 6 }} />{t('billing:overview.creditBalance')}</>}
                value={`${currency} ${formatAmount(balance)}`}
                color={balance <= 0 ? STATUS_COLORS.error.light : undefined}
              />
              <StatementLine
                label={t('billing:overview.outstandingBalance')}
                value={`${currency} ${formatAmount(outstanding)}`}
                color={outstanding > 0 ? STATUS_COLORS.error.light : undefined}
              />
              {/* The limit belongs under the bar it describes, not spliced in
                  beside the label — inline it wrapped onto its own line and
                  left the word "limit" stranded under a figure. */}
              {wallet?.debtCreditLimit > 0 && (
                <>
                  <Progress
                    percent={Math.min(100, Math.round((outstanding / wallet.debtCreditLimit) * 100))}
                    size="small"
                    showInfo={false}
                    strokeColor={outstanding > 0 ? STATUS_COLORS.error.light : STATUS_COLORS.success.light}
                    style={{ marginBottom: 0, marginTop: 2 }}
                  />
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                    {t('billing:overview.ofLimit', { limit: `${currency} ${formatAmount(wallet.debtCreditLimit)}` })}
                  </Text>
                </>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                {creditsEnabled && (
                  <Button type="primary" block onClick={() => onGoToTab?.('credits')}>
                    {t('common:action.addCredit')}
                  </Button>
                )}
                <Button block icon={<ArrowRightOutlined />} onClick={() => onGoToTab?.('invoices')}>
                  {t('billing:tabs.invoices')}
                </Button>
              </div>
            </StatementBox>
          </Col>
        </Row>

        {/* ── Where the outstanding balance actually went ──────────────────
          *
          * The three boxes above can still leave one question open, and it
          * is the one the user asked out loud: the period put USD 3,552 onto
          * the outstanding balance, the balance reads USD 786, "3500 ka bill
          * kese pay kab hua kch nhi pta". A single caption saying how much
          * had been settled was not enough — the dates and amounts of the
          * actual payments are the answer.
          *
          * Opening is read off the ledger row before the period rather than
          * inferred, and the closing figure is the sum of exactly the lines
          * printed above it, so this column can be added up by eye.
          */}
        {(movement.accrued > 0 || movement.settled > 0 || movement.opening > 0) && (
          <div style={{ marginTop: 16 }}>
            <StatementBox border={borderColor}>
              <SectionHeading>{t('billing:overview.movementHeading')}</SectionHeading>
              <StatementLine
                label={t('billing:overview.openingBalance', {
                  date: formatDate(periodDate(periodFrom), 'monthDay'),
                })}
                value={`${currency} ${formatAmount(movement.opening)}`}
              />
              <StatementLine
                label={t('billing:overview.chargesAdded')}
                value={`+ ${currency} ${formatAmount(movement.accrued)}`}
                color={movement.accrued > 0 ? STATUS_COLORS.error.light : undefined}
              />
              {/* Where that figure comes from: the period's bill, less the part
                  the balance paid on the spot — the same two numbers the "How
                  it was paid" box shows, so the two sections visibly connect. */}
              {showDebtOrigin && (
                <div style={{ paddingInlineStart: 12 }}>
                  <StatementLine
                    indent
                    label={<Text type="secondary" style={{ fontSize: 12 }}>{t('billing:overview.totalBilled')}</Text>}
                    value={<Text type="secondary" style={{ fontSize: 12.5, ...monoNumeric }}>{`${currency} ${formatAmount(billedTotal)}`}</Text>}
                  />
                  <StatementLine
                    indent
                    label={<Text type="secondary" style={{ fontSize: 12 }}>{t('billing:overview.paidAtCharge')}</Text>}
                    value={<Text type="secondary" style={{ fontSize: 12.5, ...monoNumeric }}>{`− ${currency} ${formatAmount(paidAtCharge)}`}</Text>}
                  />
                </div>
              )}
              <StatementLine
                label={t('billing:overview.paymentsApplied')}
                value={`− ${currency} ${formatAmount(movement.settled)}`}
                color={movement.settled > 0 ? STATUS_COLORS.success.light : undefined}
              />
              {/* The "when" — each payment that actually came off the balance. */}
              {movement.settlements.map((s) => (
                <StatementLine
                  key={s.at}
                  indent
                  label={(
                    <Tooltip title={s.description}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDate(s.at, 'dateTime')}
                      </Text>
                    </Tooltip>
                  )}
                  value={`− ${currency} ${formatAmount(s.amount)}`}
                />
              ))}
              <StatementLine
                total
                border={borderColor}
                // "now" is only true for the month in progress; on a closed
                // month this is where that month ended, not today's balance.
                label={isCurrentPeriod
                  ? t('billing:overview.closingNow')
                  : t('billing:overview.closingBalance')}
                value={`${currency} ${formatAmount(movement.closing)}`}
                color={movement.closing > 0 ? STATUS_COLORS.error.light : undefined}
              />
            </StatementBox>
          </div>
        )}

        <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 16, lineHeight: 1.6 }}>
          {t('billing:overview.creditDrawnNote')}
        </Text>
      </Card>

      {/* ── Where the money went ── */}
      <Card
        style={card}
        styles={{ body: { padding: 0 } }}
        title={t('billing:overview.spendByDeployment')}
        extra={<Text type="secondary" style={{ fontSize: 12.5 }}>{periodLabel}</Text>}
      >
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
          padding: '14px 24px',
        }}>
          <Segmented
            size="small"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { label: t('billing:overview.filterAll'), value: 'all' },
              { label: kindTitle('compute', 'billing:overview.compute'), value: 'compute' },
              { label: kindTitle('disk', 'billing:overview.diskStorage'), value: 'disk' },
            ]}
          />
          <Select
            mode="multiple"
            allowClear
            size="small"
            placeholder={t('billing:overview.filterDeployments')}
            style={{ minWidth: 220, flex: 1, maxWidth: 420 }}
            value={deploymentFilter}
            onChange={setDeploymentFilter}
            options={usageDeployments.map((d) => ({ value: d.deploymentId, label: d.name }))}
            maxTagCount="responsive"
          />
          {/* One line, not a banner: what the disks are costing right now,
              only while one is actually being charged. */}
          {isCurrentPeriod && diskPerDay > 0 && (
            <Text type="secondary" style={{ fontSize: 12, flexBasis: '100%' }}>
              <KindIcon kind="disk" isDark={isDark} style={{ marginInlineEnd: 6 }} />
              {t('billing:overview.diskHint', { amount: `${currency} ${formatAmount(diskPerDay)}` })}
            </Text>
          )}
        </div>
        <Table
          className="ledger-table"
          columns={columns}
          dataSource={depRows}
          loading={viewedLoading}
          rowKey="key"
          rowClassName="row-hover"
          pagination={depRows.length > 20 ? { pageSize: 20 } : false}
          scroll={{ x: 960 }}
          /*
           * Day by day, on demand — "which day did this happen on" is the
           * first question when a bill looks wrong, and it should be
           * answerable without contacting support.
           */
          expandable={{
            rowExpandable: (row) => row.daily.some((d) => (showCompute && hasCharge(d.running)) || (showDisk && hasCharge(d.storage))),
            expandedRowRender: (row) => (
              <DeploymentDays
                daily={row.daily}
                currency={currency}
                isDark={isDark}
                showCompute={showCompute}
                showDisk={showDisk}
                computeTarget={row.compute.amount}
                diskTarget={row.disk.amount}
              />
            ),
          }}
          locale={{
            emptyText: (
              <Empty description={t('billing:overview.noChargesYetIn', { month: periodLabel })} style={{ padding: 40 }} />
            ),
          }}
          summary={() => (depRows.length > 0 ? (
            <Table.Summary.Row>
              {/* The expand toggle has a column of its own. */}
              <Table.Summary.Cell index={0} />
              {columns.map((c, i) => (
                <Table.Summary.Cell key={c.key} index={i + 1} align={c.align}>
                  {footerCell(c.key)}
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          ) : null)}
        />
      </Card>
    </>
  );
};

export default OverviewTab;
