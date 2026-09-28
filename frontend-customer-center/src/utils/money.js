import { formatNumber } from './format';

/**
 * How money is written on the customer's screens.
 *
 * Two different jobs, and they need different precision:
 *
 *   amount — a sum that was, or will be, moved. Two decimals, because that is
 *            what a currency has.
 *   rate   — a price per hour. Three decimals, because hourly prices on this
 *            platform genuinely carry them, and rounding one to two decimals
 *            misstates the price the customer is being quoted: a stopped
 *            A100 costs 0.123/hr and printed as "0.12", a CPU tier costs
 *            0.034/hr and printed as "0.03" — a 12% understatement of the
 *            charge someone is deciding about. It also broke the arithmetic on
 *            the billing page, where hours × rate is shown next to the charge
 *            it produced and has to agree with it.
 *
 * Kept here rather than repeated as `.toFixed(2)` at each call site so the two
 * rules stay one decision, and the billing page, the deployment pages and the
 * deploy wizard cannot drift apart on what a price looks like.
 *
 * ── These two are a migration step, not the destination ──
 *
 * They return **digits only, no currency symbol**, because that is what the
 * ~77 existing call sites expect — every one of them reads
 * `{currency} {formatAmount(x)}`. Reimplementing them on `Intl` means all of
 * those got correct grouping and correct decimal separators immediately, with
 * no edit: a Spanish customer now sees `1.234,56` where they used to see
 * `1234.56`.
 *
 * What they still cannot do is put the symbol where the locale wants it —
 * Spanish writes `10,00 US$` *after* the number, and a string join can never
 * produce that. `formatMoney()` in `./format` does, and each call site moves to
 * it as its own file is opened for string extraction. Prefer `formatMoney` in
 * anything new.
 */
export const RATE_DECIMALS = 3;

/** A price per hour, digits only — "0.034", "15.492". */
export const formatRate = (value) => formatNumber(Number(value) || 0, {
  minimumFractionDigits: RATE_DECIMALS,
  maximumFractionDigits: RATE_DECIMALS,
});

/** A sum of money, digits only — "9.23", "10.91". */
export const formatAmount = (value) => formatNumber(Number(value) || 0, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
