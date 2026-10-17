/**
 * The traffic collector: turning a beacon into a page view.
 *
 * ── The rules this endpoint lives under ──
 *
 * It is the only unauthenticated write endpoint on the platform, so every
 * decision here is defensive:
 *
 *  • **It never reports an error.** Every outcome — accepted, dropped as a
 *    bot, refused because tracking is off, malformed — returns 204. A
 *    collector that answers differently is a collector that tells an attacker
 *    which inputs are interesting, and it is also one whose failures turn into
 *    console errors on a customer's marketing site.
 *  • **It does the stripping, not the client.** Query-key removal, IP
 *    anonymisation and bot filtering all happen here. The tracker script is
 *    something anyone can read and edit; only the server's version counts.
 *  • **It trusts nothing in the payload except the path and the referrer.**
 *    Device, browser, source and medium are derived server-side from headers.
 *
 * ── Who a visitor is ──
 *
 * `sha256(daily salt + anonymised IP + user agent)`. The salt is derived from
 * the date and the app's own secret, so it rotates every midnight and the same
 * person is two unrelated hashes on two days. Nothing is written to the
 * visitor's device — no cookie, no localStorage. The cost is that returning
 * visitors cannot be counted, which is a trade this takes deliberately.
 */
const crypto = require('crypto');
// Required explicitly rather than taken from the global: the lint config here
// targets an older Node environment that does not declare them as globals, and
// a bare reference is an error there even though the runtime has them.
const { URL, URLSearchParams } = require('url');
const prisma = require('../../lib/prismaClient');

const SITES = ['marketing', 'customer', 'admin'];
const MINUTE_MS = 60000;

/* ── Identity ─────────────────────────────────────────────────────────── */

/**
 * Keep the network, drop the host.
 *
 * IPv4 → /24, IPv6 → /64. Enough to tell two networks apart for abuse
 * purposes, not enough to identify a household.
 */
const anonymiseIp = (ip) => {
  const value = String(ip || '').replace(/^::ffff:/, '');
  if (value.includes(':')) return `${value.split(':').slice(0, 4).join(':')}::`;
  const parts = value.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  return value || 'unknown';
};

/** The salt for a given day. Rotating it is what makes the hash unlinkable. */
const dailySalt = (now = new Date()) => {
  const day = now.toISOString().slice(0, 10);
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'aiocean-traffic';
  return crypto.createHash('sha256').update(`${day}|${secret}`).digest('hex');
};

const visitorHashFor = (ip, userAgent, now = new Date()) => crypto
  .createHash('sha256')
  .update(`${dailySalt(now)}|${ip}|${userAgent || ''}`)
  .digest('hex');

/* ── Classification ───────────────────────────────────────────────────── */

const isBot = (userAgent, policy) => {
  const ua = String(userAgent || '').toLowerCase();
  // An empty user agent is not a browser. Real ones always send something,
  // and a blank is the cheapest script there is.
  if (!ua) return true;
  const patterns = policy?.traffic?.botUserAgentPatterns || [];
  return patterns.some((p) => ua.includes(String(p).toLowerCase()));
};

/**
 * Device, browser and OS from the user agent.
 *
 * Hand-rolled rather than a parsing dependency: this needs four buckets for a
 * breakdown chart, not an exhaustive database, and a user-agent library is a
 * dependency that has to be updated forever to stay accurate. Order matters —
 * Edge claims to be Chrome, Chrome claims to be Safari.
 */
const classifyAgent = (userAgent) => {
  const ua = String(userAgent || '');
  const lower = ua.toLowerCase();

  let deviceType = 'desktop';
  if (/ipad|tablet|playbook|silk/.test(lower)) deviceType = 'tablet';
  else if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(lower)) deviceType = 'mobile';

  let browser = 'Other';
  if (/edg\//.test(lower)) browser = 'Edge';
  else if (/opr\/|opera/.test(lower)) browser = 'Opera';
  else if (/chrome|crios/.test(lower)) browser = 'Chrome';
  else if (/firefox|fxios/.test(lower)) browser = 'Firefox';
  else if (/safari/.test(lower)) browser = 'Safari';

  let os = 'Other';
  if (/windows/.test(lower)) os = 'Windows';
  else if (/iphone|ipad|ipod|ios/.test(lower)) os = 'iOS';
  else if (/mac os x|macintosh/.test(lower)) os = 'macOS';
  else if (/android/.test(lower)) os = 'Android';
  else if (/linux/.test(lower)) os = 'Linux';

  return { deviceType, browser, os };
};

/** Known search engines, so organic traffic is not filed as a referral. */
const SEARCH_ENGINES = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'yandex.', 'baidu.', 'ecosia.', 'brave.'];

/**
 * Where this visit came from.
 *
 * UTM parameters win over the referrer, because a campaign link is an explicit
 * statement and a referrer is an inference. A referrer from our own host is
 * internal navigation, not a referral — treating it as one is how "direct"
 * traffic quietly becomes "self-referral".
 */
const classifySource = (referrerHost, query, selfHosts) => {
  const utmSource = String(query.utm_source || '').trim().toLowerCase();
  const utmMedium = String(query.utm_medium || '').trim().toLowerCase();
  const campaign = String(query.utm_campaign || '').trim().slice(0, 120);

  if (utmSource) {
    return { source: utmSource.slice(0, 120), medium: (utmMedium || 'campaign').slice(0, 60), campaign };
  }

  const host = String(referrerHost || '').toLowerCase();
  if (!host) return { source: 'direct', medium: 'direct', campaign };
  if (selfHosts.includes(host)) return { source: 'direct', medium: 'internal', campaign };
  if (SEARCH_ENGINES.some((e) => host.includes(e))) {
    return { source: host.replace(/^www\./, ''), medium: 'organic', campaign };
  }
  return { source: host.replace(/^www\./, ''), medium: 'referral', campaign };
};

/* ── URL handling ─────────────────────────────────────────────────────── */

/**
 * Remove the operator's strip-list keys from a path's query string.
 *
 * Server-side, and this is the enforcement point. The customer center's links
 * carry invitation tokens, password-reset tokens and email addresses, and a
 * page-view table is the one place a leaked URL would sit for ninety days.
 */
const cleanPath = (rawPath, settings) => {
  const raw = String(rawPath || '/').slice(0, 2000);
  const [pathname, queryString = ''] = raw.split('#')[0].split('?');
  const safePath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (!queryString) return { path: safePath, query: {} };

  const stripped = (settings?.strippedQueryKeys || []).map((k) => String(k).toLowerCase());
  const params = new URLSearchParams(queryString);
  const query = {};
  const kept = new URLSearchParams();
  for (const [key, value] of params) {
    const lower = key.toLowerCase();
    query[lower] = value;
    // A key on the strip list goes entirely: not blanked, not hashed, gone.
    if (stripped.some((s) => lower.includes(s))) continue;
    kept.append(key, value);
  }
  const rest = kept.toString();
  return { path: rest ? `${safePath}?${rest}` : safePath, query };
};

/** Collapse high-cardinality paths through the policy's rules. */
const patternFor = (path, policy) => {
  const pathname = path.split('?')[0];
  for (const rule of policy?.traffic?.pathPatternRules || []) {
    try {
      if (new RegExp(rule.match).test(pathname)) return rule.pattern;
    } catch {
      // A bad regex in an operator's policy must not take the collector down.
      continue;
    }
  }
  return pathname.slice(0, 300);
};

const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase().slice(0, 200);
  } catch {
    return '';
  }
};

/* ── Ingest ───────────────────────────────────────────────────────────── */

/**
 * Accept a beacon.
 *
 * Returns a short reason string for the caller's own logging; the HTTP layer
 * turns every one of them into 204 regardless. Never throws — a collector
 * that can fail is a collector that can 500 on somebody's marketing page.
 */
const ingest = async (payload, context, settings, policy) => {
  if (!settings?.enableTracking) return 'tracking-disabled';

  const site = SITES.includes(payload?.site) ? payload.site : null;
  if (!site) return 'unknown-site';
  if (settings?.trackedSites && settings.trackedSites[site] === false) return 'site-not-tracked';

  // Do Not Track is honoured when the operator says so. Checked before
  // anything is derived, so a DNT visitor is never classified at all.
  if (settings?.respectDoNotTrack && String(context.dnt) === '1') return 'do-not-track';

  if (isBot(context.userAgent, policy)) return 'bot';

  const maxEvents = Number(policy?.traffic?.rateLimit?.maxEventsPerRequest) || 20;
  const events = Array.isArray(payload?.events) ? payload.events.slice(0, maxEvents) : [];
  if (!events.length) return 'no-events';

  const now = new Date();
  const ip = settings?.anonymiseIp === false
    ? String(context.ip || '')
    : anonymiseIp(context.ip);
  const visitorHash = visitorHashFor(ip, context.userAgent, now);

  /*
   * Sampling is decided per VISITOR, not per event. Sampling events would
   * dismember sessions — half a visit recorded is worse than none, because a
   * two-page session sampled down to one page reads as a bounce.
   */
  const sampleRate = Number(settings?.sampleRate);
  if (Number.isFinite(sampleRate) && sampleRate > 0 && sampleRate < 1) {
    const bucket = parseInt(visitorHash.slice(0, 8), 16) / 0xffffffff;
    if (bucket > sampleRate) return 'sampled-out';
  }

  const agent = classifyAgent(context.userAgent);
  const idleMs = (Number(policy?.traffic?.sessionIdleMinutes) || 30) * MINUTE_MS;

  let accepted = 0;
  for (const event of events) {
    const { path, query } = cleanPath(event?.p, settings);
    const referrerHost = hostOf(event?.r);
    const attribution = classifySource(referrerHost, query, context.selfHosts || []);
    const pathPattern = patternFor(path, policy);
    const durationMs = Number.isFinite(Number(event?.d))
      ? Math.max(0, Math.min(3600000, Math.round(Number(event.d))))
      : null;

    /*
     * Session stitching, server-side. The visitor's most recent OPEN session
     * on this site continues if it has been seen within the idle gap;
     * otherwise this beacon starts a new one. Nothing is kept in the browser,
     * so a session cannot be forged or carried between devices.
     */
    const open = await prisma.trafficSession.findFirst({
      where: {
        visitorHash,
        site,
        endedAt: null,
        lastSeenAt: { gte: new Date(now.getTime() - idleMs) },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true },
    });

    let sessionId = open?.id;
    if (!sessionId) {
      const created = await prisma.trafficSession.create({
        data: {
          site,
          visitorHash,
          entryPath: pathPattern,
          referrerHost,
          ...attribution,
          ...agent,
          views: 0,
          startedAt: now,
          lastSeenAt: now,
        },
        select: { id: true },
      });
      sessionId = created.id;
    }

    await prisma.$transaction([
      prisma.pageViewEvent.create({
        data: {
          site,
          sessionId,
          path,
          pathPattern,
          referrerHost,
          ...attribution,
          ...agent,
          durationMs,
          at: now,
        },
      }),
      prisma.trafficSession.update({
        where: { id: sessionId },
        data: { views: { increment: 1 }, lastSeenAt: now },
      }),
    ]);
    accepted += 1;
  }

  return `accepted:${accepted}`;
};

/* ── Housekeeping, run by the nightly job ─────────────────────────────── */

/**
 * Close sessions that have gone quiet, and judge whether each bounced.
 *
 * Bounce is decided here rather than at read time because it depends on a
 * duration the last page view may never have reported — a tab closed mid-read
 * sends no beacon, and that is a common outcome rather than an edge case.
 */
const closeIdleSessions = async (policy, { now = new Date() } = {}) => {
  const idleMs = (Number(policy?.traffic?.sessionIdleMinutes) || 30) * MINUTE_MS;
  const bounceMaxSeconds = Number(policy?.traffic?.bounceMaxSeconds) || 10;
  const cutoff = new Date(now.getTime() - idleMs);

  const stale = await prisma.trafficSession.findMany({
    where: { endedAt: null, lastSeenAt: { lt: cutoff } },
    select: { id: true, startedAt: true, lastSeenAt: true, views: true },
    take: 5000,
  });

  for (const session of stale) {
    const durationSec = Math.max(
      0,
      Math.round((session.lastSeenAt.getTime() - session.startedAt.getTime()) / 1000),
    );
    await prisma.trafficSession.update({
      where: { id: session.id },
      data: {
        endedAt: session.lastSeenAt,
        durationSec,
        // One page AND a short stay. One page over four minutes is somebody
        // who read the thing — calling that a bounce is the most common way a
        // bounce rate becomes meaningless.
        bounced: session.views <= 1 && durationSec <= bounceMaxSeconds,
      },
    });
  }

  return stale.length;
};

/**
 * Which session properties become a rollup dimension.
 *
 * A closed map, and the column names are the only thing interpolated. Adding a
 * dimension later is one entry here plus nothing else — the rollup table is
 * key/value, so no migration and no new read path.
 */
const ROLLUP_DIMENSIONS = {
  source: '"source"',
  medium: '"medium"',
  campaign: '"campaign"',
  referrer: '"referrer_host"',
  device: '"device_type"',
  browser: '"browser"',
  os: '"os"',
};

/**
 * Build one day's permanent rollups from that day's raw events.
 *
 * ── The day is REPLACED, not merged into ──
 *
 * An earlier version upserted each row, which is idempotent for data that only
 * grows and quietly wrong for data that shrinks: a row written for a path or a
 * referrer that no longer has any events survives forever, so the day's
 * breakdown stops adding up to the day's total. That was visible on the first
 * screenshot of the traffic page — a headline of four page views above a table
 * listing sixteen.
 *
 * So the day's rows are deleted and rewritten inside one transaction. A reader
 * never sees the gap, and the rollup is a function of the raw data rather than
 * an accumulation of every version of it.
 *
 * The job re-rolls YESTERDAY as well as today, because a session that started
 * at 23:50 only closes — and only then knows whether it bounced — after
 * midnight.
 *
 * Sessions are attributed to the day they STARTED. A visit that crosses
 * midnight belongs to the day the person arrived, which is the day the
 * referrer that sent them was active.
 */
const rollupDay = async (day, { now = new Date() } = {}) => {
  const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000 - 1);
  const written = { totals: 0, dimensions: 0, paths: 0 };
  const rollupRows = [];
  const pathRows = [];

  // ── Totals, per site ──
  const totals = await prisma.$queryRawUnsafe(
    `SELECT s."site",
            COALESCE(SUM(s."views"), 0)::int        AS views,
            COUNT(*)::int                            AS sessions,
            COUNT(DISTINCT s."visitor_hash")::int    AS visitors,
            COUNT(*) FILTER (WHERE s."bounced")::int AS bounces,
            COALESCE(SUM(s."duration_sec"), 0)::int  AS total_seconds
     FROM "traffic_sessions" s
     WHERE s."started_at" >= $1 AND s."started_at" <= $2
     GROUP BY 1`,
    dayStart, dayEnd,
  );

  for (const row of totals) {
    rollupRows.push({
      day: dayStart,
      site: row.site,
      dimension: 'total',
      value: 'all',
      views: row.views,
      sessions: row.sessions,
      visitors: row.visitors,
      bounces: row.bounces,
      totalSeconds: row.total_seconds,
    });
    written.totals += 1;
  }

  // ── Each breakdown ──
  for (const [dimension, column] of Object.entries(ROLLUP_DIMENSIONS)) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s."site",
              COALESCE(NULLIF(s.${column}, ''), 'unknown') AS value,
              COALESCE(SUM(s."views"), 0)::int        AS views,
              COUNT(*)::int                            AS sessions,
              COUNT(DISTINCT s."visitor_hash")::int    AS visitors,
              COUNT(*) FILTER (WHERE s."bounced")::int AS bounces,
              COALESCE(SUM(s."duration_sec"), 0)::int  AS total_seconds
       FROM "traffic_sessions" s
       WHERE s."started_at" >= $1 AND s."started_at" <= $2
       GROUP BY 1, 2`,
      dayStart, dayEnd,
    );

    for (const row of rows) {
      rollupRows.push({
        day: dayStart,
        site: row.site,
        dimension,
        value: String(row.value).slice(0, 200),
        views: row.views,
        sessions: row.sessions,
        visitors: row.visitors,
        bounces: row.bounces,
        totalSeconds: row.total_seconds,
      });
      written.dimensions += 1;
    }
  }

  // ── Pages, from the views themselves rather than from sessions ──
  const paths = await prisma.$queryRawUnsafe(
    `SELECT v."site", v."path_pattern",
            COUNT(*)::int                           AS views,
            COUNT(DISTINCT v."session_id")::int     AS sessions,
            COUNT(*) FILTER (WHERE s."entry_path" = v."path_pattern")::int AS entries,
            COALESCE(SUM(v."duration_ms"), 0)::bigint / 1000 AS total_seconds
     FROM "page_view_events" v
     JOIN "traffic_sessions" s ON s.id = v."session_id"
     WHERE v."at" >= $1 AND v."at" <= $2
     GROUP BY 1, 2`,
    dayStart, dayEnd,
  );

  for (const row of paths) {
    pathRows.push({
      day: dayStart,
      site: row.site,
      pathPattern: String(row.path_pattern).slice(0, 300),
      views: row.views,
      sessions: row.sessions,
      entries: row.entries,
      totalSeconds: Number(row.total_seconds) || 0,
    });
    written.paths += 1;
  }

  /*
   * Replace the day wholesale, in one transaction. `createMany` rather than N
   * upserts is also what makes this affordable — a busy day has one row per
   * path, and a site with a thousand pages would otherwise be a thousand
   * round trips.
   */
  await prisma.$transaction([
    prisma.trafficDailyRollup.deleteMany({ where: { day: dayStart } }),
    prisma.trafficPathDaily.deleteMany({ where: { day: dayStart } }),
    ...(rollupRows.length ? [prisma.trafficDailyRollup.createMany({ data: rollupRows })] : []),
    ...(pathRows.length ? [prisma.trafficPathDaily.createMany({ data: pathRows })] : []),
  ]);

  written.day = dayStart.toISOString().slice(0, 10);
  written.ranAt = now.toISOString();
  return written;
};

/**
 * Delete raw events past the operator's retention.
 *
 * Deleting whole SESSIONS, not loose events: the page views cascade with
 * them, and an orphaned session with no views is a row that would be counted
 * as a visit with nothing in it. A retention under one day is treated as
 * unset — it is far more likely to be an empty field than a decision to keep
 * nothing.
 */
const pruneRawEvents = async (settings) => {
  const requested = Number(settings?.dataRetentionDays);
  const days = Number.isFinite(requested) && requested >= 1 ? requested : 90;
  const cutoff = new Date(Date.now() - days * 86400000);
  const { count } = await prisma.trafficSession.deleteMany({
    where: { startedAt: { lt: cutoff } },
  });
  return count;
};

module.exports = {
  ingest,
  closeIdleSessions,
  rollupDay,
  pruneRawEvents,
  // Exported for tests: these are the decisions worth asserting on directly.
  anonymiseIp,
  visitorHashFor,
  isBot,
  classifyAgent,
  classifySource,
  cleanPath,
  patternFor,
  SITES,
};
