import { t } from '../i18n';
import { formatDate, formatNumber } from './format';

/**
 * Rendering a number of hours so the customer can actually check the maths.
 *
 * Every hour figure on this platform is stored to four decimals, because that
 * is the precision the hourly billing job charges at — a tick is rarely a
 * whole hour (0.1449h here, 0.2248h there). Printing those at one decimal was
 * quietly turning the billing page into nonsense in two separate ways:
 *
 *   1. The arithmetic stopped being checkable. "0.2h at USD 15.492/hr = USD
 *      3.48" is three numbers that do not agree with each other — 0.2 × 15.492
 *      is 3.10. The customer sees a line that claims to explain a charge and
 *      does not.
 *   2. Different real durations collapsed onto the same label, so two
 *      deployments could not be compared. 0.1449h and 0.1501h both printed as
 *      "0.1h"; 0.1449h and 0.2248h printed as "0.1h" and "0.2h", which reads
 *      as a suspiciously round 2× when it is really 1.55×.
 *
 * So precision scales with magnitude: enough decimals that hours × rate still
 * lands on the right cent for small values, and no clutter on large ones where
 * it could not matter. Trailing zeros are trimmed, so a clean hour reads "1h"
 * rather than "1.000h".
 *
 * ── On calling `t()` from a util ──
 *
 * These functions cannot use `useTranslation`, so they use the i18next
 * singleton. That is safe here for a specific reason: every one of them runs
 * during the render of a component that also subscribes to the language, so a
 * language change re-renders the caller and the string is never stale. It would
 * not be safe in, say, a module-level constant evaluated once at import.
 */
const trim = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

/** Decimals for a magnitude — see the note above for why these differ. */
const hourDigits = (h) => (h >= 100 ? 1 : (h >= 10 ? 2 : 3));

export const formatHours = (hours) => {
  const h = Number(hours) || 0;
  const unit = t('common:units.hourShort');
  if (h === 0) return `0${unit}`;

  // Two decimals from ten hours up, not one. On a statement line the customer
  // multiplies these hours by the rate beside them: "20.9h at USD 15.492/hr"
  // comes to USD 323.78 against a printed total of USD 324.22, which reads as
  // an error. At 20.93h the same check lands within a few cents.
  const digits = hourDigits(h);
  /*
   * Trimmed on the plain decimal form, then formatted — doing it the other way
   * round would strip a locale's grouping separator along with the zeros, so
   * "1.234,000" in Spanish would come back as "1" rather than "1.234".
   */
  const trimmed = trim(h.toFixed(digits));
  const decimals = (trimmed.split('.')[1] || '').length;
  return `${formatNumber(Number(trimmed), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${unit}`;
};

/**
 * The same duration said the way a person would say it — "13 min", "2h 18m".
 * Used alongside `formatHours` where there is room for it, because "0.225h" is
 * exact but nobody thinks in decimal hours.
 */
export const humanDuration = (hours) => {
  const totalMinutes = Math.round((Number(hours) || 0) * 60);
  if (totalMinutes < 1) return t('common:duration.underAMinute');
  if (totalMinutes < 60) return t('common:duration.minutes', { count: totalMinutes });

  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0
    ? t('common:duration.hoursOnly', { hours: h })
    : t('common:duration.hoursMinutes', { hours: h, minutes: m });
};

/** "13:04" — the watermark a set of billed figures is current as of. */
export const formatClock = (value) => formatDate(value, 'time');
