/**
 * Pagination bounds.
 *
 * Every list endpoint used to compute `skip` as
 *   (Number(page) - 1) * Number(limit)
 * with no validation. `page=0` and `page=-5` produce a negative skip and
 * `limit=abc` produces NaN — Prisma rejects both, so a trivially malformed
 * query string returned HTTP 500 from every paginated endpoint in the app
 * (40 of 66 probes across ten endpoints). `limit` also had no ceiling, so a
 * caller could ask for every row of a table that grows without bound.
 *
 * Clamping rather than rejecting is deliberate: `page=0` is an ordinary thing
 * for a 0-indexed client to send, and returning the first page is friendlier
 * than a 400 — while still never reaching the database with nonsense.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

/** A positive integer, or the fallback when the input is missing/nonsense. */
const toInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};

/**
 * @param {object} query            usually req.query
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit]
 * @param {number} [opts.maxLimit]
 * @returns {{ page: number, limit: number, skip: number, take: number }}
 */
const paginate = ({ page, limit } = {}, opts = {}) => {
  const defaultLimit = opts.defaultLimit || DEFAULT_LIMIT;
  const maxLimit = opts.maxLimit || MAX_LIMIT;

  const safePage = Math.max(1, toInt(page, 1));
  const safeLimit = Math.min(maxLimit, Math.max(1, toInt(limit, defaultLimit)));

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    take: safeLimit,
  };
};

/**
 * The `pagination` block sent back to the client.
 *
 * Clamping the *query* is only half the job: several endpoints echoed the
 * caller's raw `page`/`limit` back in the response while querying the clamped
 * ones, so `?page=0&limit=abc` returned the correct first page of rows next to
 * `{ page: 0, limit: null, pages: null }`, and `?page=abc&limit=-1` returned
 * `{ page: null, limit: -1, pages: -7 }`. No 500 — which is why the Phase 3
 * sweep, which counted 500s, walked straight past it — but the frontend pager
 * reads this block, so it rendered a broken control over correct data.
 *
 * Deriving the block from the same `paginate()` result is what keeps the two
 * halves from drifting again.
 *
 * @param {object} query   usually req.query
 * @param {number} total   total matching rows
 * @param {object} [opts]  same options as paginate()
 * @returns {{ page: number, limit: number, total: number, pages: number }}
 */
const meta = (query, total, opts = {}) => {
  const { page, limit } = paginate(query, opts);
  const count = Number.isFinite(Number(total)) ? Number(total) : 0;
  return { page, limit, total: count, pages: Math.ceil(count / limit) };
};

module.exports = { paginate, meta, DEFAULT_LIMIT, MAX_LIMIT };
