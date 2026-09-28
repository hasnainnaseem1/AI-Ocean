/**
 * A tiny in-memory, stale-while-revalidate cache shared across route changes.
 *
 * Without this, every click on a nav link re-fetched that page's blocks from
 * scratch — plus a second fetch per live-data block (models, tiers, use
 * cases) inside it — and showed a blank/spinner state until each one
 * resolved. On a small, admin-managed site (a handful of pages, revisited
 * constantly while browsing) that turned every internal link into a visible
 * stall, which is what read as the site "getting stuck".
 *
 * Data older than TTL is served immediately, then silently re-fetched in the
 * background so admin edits still show up within a minute or two — there is
 * no separate "preview" surface that needs sub-second freshness, and a fresh
 * tab always starts with an empty cache.
 */
const TTL_MS = 90 * 1000;

const store = new Map();

export const getCached = (key) => {
  const entry = store.get(key);
  return entry ? entry.data : undefined;
};

export const isStale = (key) => {
  const entry = store.get(key);
  return !entry || Date.now() - entry.timestamp > TTL_MS;
};

export const setCached = (key, data) => {
  store.set(key, { data, timestamp: Date.now() });
};
