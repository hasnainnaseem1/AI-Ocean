import { useMemo } from 'react';
import i18n from '../i18n';
import { intlLocaleOf } from '../i18n/languages';
import { useLanguage } from '../context/LanguageContext';

/**
 * Dates, numbers, money and relative times, written the way the active
 * language writes them.
 *
 * ── Why this module exists ──
 *
 * Eight files had each grown their own date helper, every one of them
 * hardcoding `'en-US'`, and no two agreeing on how to render a missing value.
 * Numbers were worse: `toLocaleString()` with no locale argument follows the
 * *browser's* language, so a customer on a German machine already saw `1.234`
 * next to a `toFixed(2)` amount that said `1234.56` — two numbering conventions
 * on the same row, before any of this was about translation at all.
 *
 * So: one module, `Intl` throughout, and the locale comes from the app rather
 * than from the browser or a literal.
 *
 * ── Two ways in ──
 *
 *   useFormat()   inside a component. Returns formatters bound to the current
 *                 language and re-computed when it changes, so the component
 *                 re-renders on a language switch even if it calls no `t()`.
 *   formatDate(…) anywhere else — the shared utils in this folder, mostly.
 *                 Reads the live language off the i18next singleton.
 *
 * Both resolve to the same locale. The hook exists because context is what
 * guarantees a re-render; the bare functions exist because a util module
 * cannot call a hook.
 */

/** The BCP 47 tag for whatever language is active right now. */
const currentLocale = () => intlLocaleOf(i18n.language || 'en');

/*
 * `Intl.DateTimeFormat` is expensive to construct and these are built on every
 * render of every table row, so they are cached by locale + style. The cache is
 * bounded by the number of languages times the number of styles below — a few
 * dozen entries at most, for the life of the tab.
 */
const dtfCache = new Map();
const nfCache = new Map();

const DATE_STYLES = {
  /** 15 Sep 2026 — lists and tables, where width matters. */
  short: { day: '2-digit', month: 'short', year: 'numeric' },
  /** 15 September 2026 — invoices and anything a customer might print. */
  long: { day: '2-digit', month: 'long', year: 'numeric' },
  /** September 2026 — a billing period, a "member since". */
  monthYear: { month: 'long', year: 'numeric' },
  /** 15 Sep — an axis label or a chart tooltip, where the year is implied. */
  monthDay: { month: 'short', day: 'numeric' },
  /**
   * 15 Sep, forced to UTC — a *billing* day.
   *
   * Usage is bucketed by UTC day on the server, so a customer in Karachi
   * rendering `2026-09-15T00:00:00Z` in local time would see "14 Sep" against a
   * row the invoice calls the 15th. The day is a label on a server-side bucket,
   * not a moment in this customer's life, so it is read in the timezone the
   * bucket was cut in.
   */
  billingDay: { month: 'short', day: 'numeric', timeZone: 'UTC' },
  /** 15 Sep 2026, 13:04 — a ledger entry, where the time is part of the fact. */
  dateTime: { dateStyle: 'medium', timeStyle: 'short' },
  /** 13:04 — a watermark, where the date is already on screen. */
  time: { hour: '2-digit', minute: '2-digit' },
  /** Tue 13:04 — a support thread, where the day of the week reads better. */
  weekdayTime: { weekday: 'short', hour: 'numeric', minute: '2-digit' },
};

const dtf = (locale, style) => {
  const key = `${locale}|${style}`;
  if (!dtfCache.has(key)) {
    dtfCache.set(key, new Intl.DateTimeFormat(locale, DATE_STYLES[style] || DATE_STYLES.short));
  }
  return dtfCache.get(key);
};

const nf = (locale, opts) => {
  const key = `${locale}|${JSON.stringify(opts)}`;
  if (!nfCache.has(key)) nfCache.set(key, new Intl.NumberFormat(locale, opts));
  return nfCache.get(key);
};

/**
 * The em dash every one of the old helpers used for "no value", now decided
 * once. It is deliberately not a translated string: it is punctuation, and it
 * reads the same in every language this product ships.
 */
export const EMPTY = '—';

/**
 * A date or a datetime.
 *
 * @param {string|number|Date} value
 * @param {keyof DATE_STYLES} [style='short']
 */
export const formatDate = (value, style = 'short', locale = currentLocale()) => {
  if (value === null || value === undefined || value === '') return EMPTY;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return dtf(locale, style).format(d);
};

/**
 * A plain number — token counts, unit counts, limits.
 *
 * Replaces the bare `toLocaleString()` calls, which followed the browser rather
 * than the app. Arabic and Urdu keep Latin digits here, because their locale
 * tags carry `-u-nu-latn` — see the note in `src/i18n/languages.js`.
 */
export const formatNumber = (value, opts = {}, locale = currentLocale()) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  return nf(locale, opts).format(n);
};

/**
 * Money.
 *
 * `kind` is the distinction this platform actually needs:
 *
 *   amount — a sum that was or will be moved. Two decimals, because that is
 *            what a currency has.
 *   rate   — a price per hour. Three, because hourly prices here genuinely
 *            carry them: a stopped A100 costs 0.123/hr and printed as "0.12"
 *            understates the charge someone is deciding about by more than 2%.
 *
 * Unlike the `{currency} {formatAmount(x)}` concatenation this replaces, the
 * symbol lands where the locale puts it — Spanish writes `10,00 US$` after the
 * number, which no amount of string joining can produce.
 */
export const formatMoney = (value, { currency = 'USD', kind = 'amount' } = {}, locale = currentLocale()) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  const digits = kind === 'rate' ? 3 : 2;
  return nf(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
};

const RELATIVE_STEPS = [
  [60, 'second'],
  [3600, 'minute'],
  [86400, 'hour'],
  [2592000, 'day'],
];

/**
 * "5 minutes ago", "3 hours ago" — and a real date once it stops being useful.
 *
 * `Intl.RelativeTimeFormat` replaces the hand-built `'just now' / '5m ago'`
 * ladder, which was English by construction. Past a month it falls back to an
 * absolute date, because "2 months ago" is less useful than the day itself.
 */
export const formatRelativeTime = (value, locale = currentLocale()) => {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs >= 2592000) return formatDate(value, 'short', locale);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const [divisor, unit] = RELATIVE_STEPS.find(([limit]) => abs < limit) || RELATIVE_STEPS[3];
  const scale = divisor === 60 ? 1 : (divisor === 3600 ? 60 : (divisor === 86400 ? 3600 : 86400));
  return rtf.format(Math.round(seconds / scale), unit);
};

/**
 * The same formatters, bound to the language and memoized.
 *
 * Use this inside components. Depending on `language` is what makes a component
 * that renders only dates or only money re-render when the language changes —
 * a component that never calls `t()` has nothing else to subscribe to.
 */
export const useFormat = () => {
  const { language } = useLanguage();
  return useMemo(() => {
    const locale = intlLocaleOf(language);
    return {
      locale,
      formatDate: (v, style) => formatDate(v, style, locale),
      formatNumber: (v, opts) => formatNumber(v, opts, locale),
      formatMoney: (v, opts) => formatMoney(v, opts, locale),
      formatRelativeTime: (v) => formatRelativeTime(v, locale),
    };
  }, [language]);
};
