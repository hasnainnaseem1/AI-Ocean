/**
 * A short-lived read-through cache in front of the analytics aggregates.
 *
 * Shaped after `services/recommendation/catalogCache.js` — a Map, a timestamp,
 * no Redis and no invalidation hooks. The difference is what it protects: the
 * recommendation cache saves round trips on small catalogue reads, this one
 * stands in front of `date_trunc` aggregates over the usage and ledger tables,
 * which is the expensive end of the platform. Eight admins with a dashboard
 * open and a 30-second refresh would otherwise re-scan those tables ~1,000
 * times an hour to produce a number that changes when the hourly billing job
 * runs.
 *
 * ── Two rules that are not negotiable ──
 *
 * 1. **Nothing scoped to one admin is ever cached.** Every key must describe a
 *    question about the platform, never about the person asking. An "assigned
 *    to me" or permission-filtered payload in a shared Map is how one operator
 *    ends up served another's view.
 * 2. **The key must round the window down to its bucket.** `resolveWindow`
 *    already does this in `window.cacheKey`; use it. A key built from a raw
 *    `now` is unique on every request, so the cache would only ever add a Map
 *    write and never return a hit.
 *
 * Staleness is bounded and visible: `stats()` is surfaced on the dashboard's
 * health endpoint, so an operator can see they are reading a cached number
 * rather than guessing.
 */

/** Matches the policy default; the resolver overwrites it on first load. */
let ttlMs = 120 * 1000;

let hits = 0;
let misses = 0;

const store = new Map();

/** Called by `analyticsPolicyResolver` once it knows what the admin configured. */
const setTtlSeconds = (seconds) => {
  const n = Number(seconds);
  if (Number.isFinite(n) && n >= 0) ttlMs = n * 1000;
};

/**
 * Build a stable key.
 *
 * `parts` is sorted so `{status, tier}` and `{tier, status}` cannot produce
 * two entries for one question. Undefined and empty values are dropped so an
 * absent filter and an explicitly-empty one agree.
 */
const cacheKey = (domain, parts = {}) => {
  const flat = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`)
    .sort();
  return [domain, ...flat].join(':');
};

/**
 * Read through the cache.
 *
 * `ttlMs: 0` disables caching for that call — used by anything an operator
 * just clicked "refresh" on, where serving a stale number would look broken.
 */
const cached = async (key, loader, opts = {}) => {
  const ttl = opts.ttlMs === undefined ? ttlMs : Number(opts.ttlMs);
  if (!ttl) return loader();

  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    hits += 1;
    return hit.value;
  }

  misses += 1;
  const value = await loader();
  store.set(key, { value, at: Date.now() });
  return value;
};

/**
 * Drop every entry whose key starts with `prefix`.
 *
 * Used after a write that an operator will immediately look for the effect of
 * — recomputing churn risk, editing the policy — so the next read is not the
 * pre-change number.
 */
const invalidate = (prefix) => {
  if (!prefix) return clear();
  let dropped = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) { store.delete(key); dropped += 1; }
  }
  return dropped;
};

const clear = () => {
  const n = store.size;
  store.clear();
  return n;
};

/** Surfaced on `/admin/dashboard/health` so staleness is visible, not implied. */
const stats = () => ({
  entries: store.size,
  hits,
  misses,
  hitRate: hits + misses ? Math.round((hits / (hits + misses)) * 100) : 0,
  ttlSeconds: Math.round(ttlMs / 1000),
});

module.exports = {
  cached, cacheKey, invalidate, clear, stats, setTtlSeconds,
};
