/**
 * A fixed-window per-IP rate limiter.
 *
 * ── Why this is hand-written ──
 *
 * This platform has no rate-limiting dependency at all — not `express-rate-
 * limit`, not anything else — and every endpoint until now has been behind
 * authentication, where an abusive caller is a known account that can be
 * suspended. The traffic collector is the first unauthenticated WRITE
 * endpoint on the platform, so it is the first thing that can be flooded by
 * somebody with no account at all. Adding a dependency for sixty lines, in
 * the same commit as the endpoint it protects, was the larger change.
 *
 * ── What this is NOT ──
 *
 * It is per-process and in-memory. Two Node instances behind a load balancer
 * each allow the full quota, so the effective limit is (instances × quota).
 * That is fine for what this guards — it exists to stop a single script
 * filling a table, not to enforce a billing quota — but anything that must be
 * exact across instances needs a shared store, and should not quietly reuse
 * this.
 *
 * ── Fixed window, deliberately ──
 *
 * A sliding window is more accurate and needs a timestamp list per caller,
 * which is itself a thing an attacker can grow. A fixed window needs two
 * numbers per caller and resets them wholesale, so the memory cost is bounded
 * by the number of distinct IPs in one window rather than by request volume.
 * The known weakness — up to 2× the quota across a window boundary — does not
 * matter here.
 */

/** One bucket per key: how many, and when the window started. */
const buckets = new Map();

/*
 * Swept rather than expired per-key: a `setTimeout` per IP is thousands of
 * timers, and an unbounded Map is the memory leak this is supposed to
 * prevent. One sweep a minute drops everything whose window has passed.
 *
 * `unref()` so a sweep timer never keeps the process alive — without it a
 * script that requires this file would hang on exit forever.
 */
const SWEEP_MS = 60000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt > bucket.windowMs) buckets.delete(key);
  }
}, SWEEP_MS);
if (sweeper.unref) sweeper.unref();

/**
 * The caller's address, as well as it can be known.
 *
 * `req.ip` already honours `trust proxy` when it is set. Where it is not, a
 * proxied deployment reports every visitor as the proxy — which would make
 * this limiter one global bucket. That is a deployment note, not something
 * this file can fix, and it fails CLOSED (too strict) rather than open.
 */
const keyFor = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * `rateLimit({ windowSeconds, max, key })` → middleware.
 *
 * Options are read per request through `resolve`, so a limit held in admin
 * settings or an analytics policy takes effect without a restart.
 */
const rateLimit = (resolve) => async (req, res, next) => {
  let config;
  try {
    config = typeof resolve === 'function' ? await resolve(req) : resolve;
  } catch {
    // A limiter that cannot read its own configuration must not take the
    // endpoint down with it; fall through to a conservative default.
    config = {};
  }

  const windowMs = Math.max(1000, (Number(config?.windowSeconds) || 60) * 1000);
  const max = Math.max(1, Number(config?.max) || 120);
  const key = `${config?.name || 'default'}:${keyFor(req)}`;

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.startedAt > windowMs) {
    buckets.set(key, { count: 1, startedAt: now, windowMs });
    return next();
  }

  bucket.count += 1;
  bucket.windowMs = windowMs;

  if (bucket.count > max) {
    const retryAfter = Math.ceil((bucket.startedAt + windowMs - now) / 1000);
    res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
    /*
     * The caller is told to stop and nothing else. No body, no explanation of
     * the limit — on an unauthenticated endpoint that is just a description
     * of how to stay under it.
     */
    return res.status(429).end();
  }

  return next();
};

/** Test seam: forget every bucket. */
const reset = () => buckets.clear();

module.exports = { rateLimit, reset };
