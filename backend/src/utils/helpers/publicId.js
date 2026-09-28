/**
 * Resolving "the id a client gave us" to a Prisma `where` clause.
 *
 * There is now exactly one kind of id in this system: the row's UUID primary
 * key, which is what the API returns as `id` and what every route accepts. The
 * 24-hex public-id column, and the `_id` key built from it, are gone
 * (see CLEANUP_PLAN.md, Phase F).
 *
 * This file still exists because the *shape check* is load-bearing. Handing
 * Postgres a non-UUID string where a `uuid` column is expected is not a miss,
 * it is a type error — the caller gets a 500 carrying a database exception
 * instead of a clean 404. So a value that is not a UUID is turned into a clause
 * that matches nothing, and the route's own "not found" branch handles it. That
 * covers path-traversal strings, a stale 24-hex id from a bookmarked URL, and a
 * seven-day-old JWT minted before the change.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A UUID that cannot exist as a real row, used to express "match nothing"
 * without an empty `where` — an empty clause matches *everything*, which on a
 * `deleteMany` is the difference between removing one customer and emptying a
 * table.
 */
const MATCHES_NOTHING = '00000000-0000-0000-0000-000000000000';

/** Is this a well-formed id? */
const isPublicId = (value) => UUID.test(String(value ?? ''));

/** A `where` clause matching one row, or nothing if the id is malformed. */
const byPublicId = (value) => ({ id: isPublicId(value) ? String(value) : MATCHES_NOTHING });

/** A `where` clause matching many rows; malformed entries simply don't match. */
const byPublicIds = (values) => {
  const list = (Array.isArray(values) ? values : [values])
    .filter((v) => v != null)
    .map(String)
    .filter(isPublicId);
  return { id: { in: list } };
};

/**
 * Index rows by id — used where a set of rows is fetched and then looked up
 * again by the id a caller supplied (resolving a tier's component picks, say).
 */
const mapByPublicId = (rows = []) => {
  const map = new Map();
  for (const row of rows) {
    if (row?.id) map.set(String(row.id), row);
  }
  return map;
};

/**
 * "Is this row the one that id refers to?" — for ownership checks, which are
 * what stop one customer reading another's deployment.
 */
const isSameRow = (row, value) => !!row && value != null && String(row.id) === String(value);

module.exports = {
  isPublicId, byPublicId, byPublicIds, mapByPublicId, isSameRow, MATCHES_NOTHING,
};
