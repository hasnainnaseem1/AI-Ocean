/**
 * The traffic collector's endpoint.
 *
 * ── Three things about this route are load-bearing ──
 *
 * 1. **It must be mounted ABOVE `router.use('/', marketingRoutes)`** in the
 *    public index. That mount is a catch-all on `/`, and anything registered
 *    after it never sees a request.
 *
 * 2. **The body arrives as `text/plain`.** `navigator.sendBeacon` with a JSON
 *    blob makes the request non-simple, which triggers a CORS preflight — and
 *    a preflight fired during `pagehide` is routinely cancelled by the browser,
 *    so the last view of every visit would be lost. `text/plain` is a simple
 *    content type, needs no preflight, and survives unload. The app's global
 *    `express.json()` ignores it, so this route parses its own body.
 *
 * 3. **It always answers 204.** Bot, malformed, tracking switched off,
 *    rate-limited beyond the window, a database that is down — the visitor's
 *    browser is told "fine" and nothing else. Any other answer turns into a
 *    console error on somebody's marketing site, and a collector that
 *    distinguishes its failures is one that can be probed.
 */
const express = require('express');
const path = require('path');
const { rateLimit } = require('../../../middleware/security/rateLimit');
const { getSettings } = require('../../../services/admin/adminSettingsService');
const { resolvePolicy } = require('../../../services/analytics/analyticsPolicyResolver');
const trafficCollector = require('../../../services/analytics/trafficCollector');

const router = express.Router();

/** The hosts that are us, so a referrer from our own site is not a referral. */
const selfHosts = () => [
  process.env.MARKETING_FRONTEND_URL,
  process.env.CUSTOMER_FRONTEND_URL,
  process.env.ADMIN_FRONTEND_URL,
  process.env.FRONTEND_URL,
]
  .filter(Boolean)
  .map((u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } })
  .filter(Boolean);

/**
 * The limiter's numbers come from the analytics policy, read per request, so
 * an operator can tighten them without a restart. A policy that cannot be
 * read falls back to the shipped defaults rather than to no limit.
 */
const limiter = rateLimit(async () => {
  try {
    const policy = await resolvePolicy();
    const cfg = policy?.traffic?.rateLimit || {};
    return {
      name: 'track',
      windowSeconds: cfg.windowSeconds,
      max: cfg.maxRequestsPerIp,
    };
  } catch {
    return { name: 'track' };
  }
});

/**
 * Body size is capped here as well as by the limiter: one oversized beacon is
 * cheaper to refuse than 120 small ones, and this is the only unauthenticated
 * body the platform parses.
 */
const textBody = express.text({ type: '*/*', limit: '16kb' });

// @route   POST /api/v1/public/track
// @desc    One beacon from a tracked surface. Always 204.
router.post('/', limiter, textBody, async (req, res) => {
  // Answer first, work after. The browser is often unloading the page, and
  // holding its request open while we write to the database is how the last
  // view of a visit gets cancelled.
  res.status(204).end();

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!payload || typeof payload !== 'object') return;

    const settings = await getSettings();
    const policy = await resolvePolicy();

    await trafficCollector.ingest(payload, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      dnt: req.get('dnt') || req.get('DNT'),
      selfHosts: selfHosts(),
    }, settings?.analyticsSettings, policy);
  } catch (error) {
    // Logged, never surfaced. The response has already gone.
    if (process.env.NODE_ENV === 'development') {
      console.error('[Track] beacon dropped:', error.message);
    }
  }
});

/**
 * @route   GET /api/v1/public/track/config
 * @desc    What the tracker script needs to know before it sends anything.
 *
 * Fetched rather than compiled into each frontend: whether tracking is on at
 * all, and which surfaces report, are admin settings. A build-time copy would
 * mean switching tracking off takes a deploy.
 */
router.get('/config', async (req, res) => {
  try {
    const settings = await getSettings();
    const a = settings?.analyticsSettings || {};
    res.json({
      success: true,
      enabled: !!a.enableTracking,
      sites: a.trackedSites || {},
      respectDoNotTrack: a.respectDoNotTrack !== false,
    });
  } catch {
    // Fail closed: if the setting cannot be read, nothing is tracked.
    res.json({ success: true, enabled: false, sites: {}, respectDoNotTrack: true });
  }
});

/**
 * @route   GET /api/v1/public/track/tracker.js
 * @desc    The tracker itself.
 *
 * Served from the backend so there is ONE copy. The marketing site and the
 * customer center both need it; two copies in two React apps would be two
 * files that drift, and changing the tracker would mean rebuilding and
 * redeploying both. From here it reaches every surface the moment it changes.
 *
 * Cached for an hour — long enough that it is not re-fetched on every page,
 * short enough that switching tracking off is not held up by a stale script
 * (and the config call it makes is never cached, so the switch is immediate
 * regardless).
 */
const TRACKER_PATH = path.join(__dirname, '..', '..', '..', '..', 'public', 'tracker.js');

router.get('/tracker.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(TRACKER_PATH, (err) => {
    // A missing tracker must not be a 500 on somebody's marketing page.
    if (err && !res.headersSent) res.status(204).end();
  });
});

module.exports = router;
