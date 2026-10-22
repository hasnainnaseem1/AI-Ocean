/**
 * How money is written on the admin screens.
 *
 * Mirrors the customer app's `utils/money.js`, deliberately, so an operator
 * and a customer looking at the same deployment read the same numbers.
 *
 * Two different jobs, and they need different precision:
 *
 *   amount — a sum that was, or will be, moved. Two decimals.
 *   rate   — a price per hour. Three decimals, because hourly prices on this
 *            platform genuinely carry them.
 *
 * ── Why this exists ──
 *
 * The admin screens printed hourly rates with `precision={2}` and
 * `.toFixed(2)` — and those two round DIFFERENTLY. antd's `Statistic`
 * truncates; `toFixed` rounds to nearest. On one deployment charging
 * $0.0472 an hour, the header read "0.04" while the billing table directly
 * beneath it read "0.05" for the same rate. Neither is the price: the
 * customer was being charged 0.047.
 *
 * It is not cosmetic on this screen. An operator checking whether a machine
 * is profitable reads these numbers, and rounding a 4.7-cent hourly rate to
 * 4 or 5 cents is a 6–7% error in whichever direction the digit happens to
 * fall — larger than the margin some tiers are priced to earn.
 *
 * Kept in one place so the two rules stay one decision.
 */
export const RATE_DECIMALS = 3;

const format = (value, decimals) => new Intl.NumberFormat(undefined, {
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals,
}).format(Number(value) || 0);

/** A price per hour, digits only — "0.047", "15.492". */
export const formatRate = (value) => format(value, RATE_DECIMALS);

/** A sum of money, digits only — "9.23", "10.91". */
export const formatAmount = (value) => format(value, 2);
