/**
 * The small numeric conversions every analytics module needs.
 *
 * These existed as two private consts at the top of
 * `services/admin/analyticsService.js` and were about to be copied into a
 * dozen new modules. They are here instead so there is exactly one answer to
 * "what does a null sum mean" and "where do we round".
 *
 * ── Why `num` exists at all ──
 *
 * Prisma returns `Decimal` objects for every money column and `BigInt` for a
 * raw `COUNT(*)` without a cast. Both survive arithmetic badly and `BigInt`
 * makes `JSON.stringify` throw outright, which surfaces as a 500 on an
 * endpoint that "worked yesterday". Everything crossing out of this layer
 * goes through `num` first.
 */

/** Prisma Decimal | BigInt | null | undefined → a plain JS number. */
const num = (d) => (d === null || d === undefined ? 0 : Number(d));

/** Money and percentages, to two places. */
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/** Hours and rates, to four — the precision the database actually stores. */
const round4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;

/**
 * Division that refuses to produce Infinity or NaN.
 *
 * Every rate on an analytics page has a denominator that is legitimately zero
 * on a quiet day — no logins, no tickets, no payments. `0 / 0` rendering as
 * "NaN%" in front of an operator is the most common way a dashboard loses
 * trust, so the fallback is explicit rather than incidental.
 */
const safeDiv = (numerator, denominator, fallback = 0) => {
  const d = num(denominator);
  if (!d) return fallback;
  return num(numerator) / d;
};

/** A percentage 0–100, rounded to two places. `pct(3, 8)` → 37.5 */
const pct = (part, total, fallback = 0) => round2(safeDiv(part, total, fallback) * 100);

/**
 * Period-over-period change, as a percentage.
 *
 * Returns `null` — not 0, and not Infinity — when the previous period was
 * zero. "Up 100%" and "up from nothing" are different statements, and only
 * `null` lets the UI say the second one honestly ("no comparison available")
 * instead of inventing a number.
 */
const deltaPct = (current, previous) => {
  const prev = num(previous);
  if (!prev) return null;
  return round2(((num(current) - prev) / Math.abs(prev)) * 100);
};

/** `[{id, ...}] → Map(id → row)`, for the hydrate-after-groupBy pattern. */
const mapBy = (rows, key = 'id') => new Map((rows || []).map((r) => [r[key], r]));

/**
 * Share of a total, as a percentage, attached to each row.
 * Used by every "by tier / by model / by gateway" breakdown so the share
 * column is computed once rather than in each module.
 */
const withShare = (rows, field = 'amount') => {
  const total = (rows || []).reduce((sum, r) => sum + num(r[field]), 0);
  return (rows || []).map((r) => ({ ...r, share: pct(r[field], total) }));
};

/**
 * Median and p90 from an unsorted array of numbers.
 *
 * Deliberately not `avg`: response and resolution times are long-tailed, and
 * a mean lets one forgotten ticket sat on for three weeks describe a queue
 * that is otherwise answered in an hour. Every duration metric in this layer
 * reports median and p90, never the mean alone.
 */
const percentile = (values, p) => {
  const sorted = (values || []).map(num).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const median = (values) => percentile(values, 50);

module.exports = {
  num, round2, round4, safeDiv, pct, deltaPct, mapBy, withShare, percentile, median,
};
