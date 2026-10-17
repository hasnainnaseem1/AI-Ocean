/**
 * Reading the traffic the platform collects itself.
 *
 * ── Two sources, one answer ──
 *
 * `page_view_events` is precise and short-lived: it is pruned at the
 * operator's `dataRetentionDays`. The rollups are coarser and permanent. A
 * window inside the retention period is answered from the raw events; one
 * reaching further back is answered from the rollups, and **every response
 * says which it used**. Silently switching between a precise source and an
 * approximate one, without the reader knowing, is how a year-on-year chart
 * ends up comparing two different measurements.
 *
 * ── What this deliberately cannot tell you ──
 *
 *  • **Returning visitors.** The visitor hash is salted per day on purpose, so
 *    the same person is unlinkable across days. That is the privacy design,
 *    not a gap to be filled later.
 *  • **Country.** There is no GeoIP database on this platform and inventing
 *    one from a timezone or a language header would be a guess dressed as a
 *    measurement. The audience view says so rather than leaving a blank chart.
 *  • **Which visitor signed up.** Attribution would need the signup flow to
 *    carry a session id, which it does not. The conversions view reports
 *    visits and signups on the same axis and states plainly that it is a
 *    correlation in time, not a traced path.
 */
const prisma = require('../../lib/prismaClient');
const { bucketExpr, fillSeries, describe } = require('./timeWindow');
const {
  num, round2, pct, safeDiv, withShare,
} = require('./numeric');

const DAY_MS = 86400000;

/**
 * Which source can answer this window.
 *
 * `rawQueryWindowDays` is the policy's view of how far back raw events are
 * worth scanning; `dataRetentionDays` is how far back they exist at all. The
 * stricter of the two wins.
 */
const sourceFor = (window, policy, settings) => {
  const rawDays = Number(policy?.traffic?.rawQueryWindowDays) || 14;
  const retention = Number(settings?.dataRetentionDays) || 90;
  const limit = Math.min(rawDays, retention);
  const ageDays = (Date.now() - window.from.getTime()) / DAY_MS;
  return ageDays <= limit ? 'events' : 'rollups';
};

const sourceNote = (source, policy, settings) => (source === 'events'
  ? 'Counted from individual page views.'
  : `Counted from the nightly rollups — raw page views are kept for ${Number(settings?.dataRetentionDays) || 90} days, and this window reaches further back.`);

/* ── Headline ─────────────────────────────────────────────────────────── */

const totalsFromEvents = async (from, to, site) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS views,
            COUNT(DISTINCT v."session_id")::int AS sessions,
            COUNT(DISTINCT s."visitor_hash")::int AS visitors,
            COUNT(DISTINCT s.id) FILTER (WHERE s."bounced")::int AS bounces,
            COALESCE(SUM(s."duration_sec"), 0)::int AS total_seconds
     FROM "page_view_events" v
     JOIN "traffic_sessions" s ON s.id = v."session_id"
     WHERE v."at" >= $1 AND v."at" <= $2 ${site ? 'AND v."site" = $3' : ''}`,
    ...(site ? [from, to, site] : [from, to]),
  );
  return rows[0] || {};
};

const totalsFromRollups = async (from, to, site) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM("views"), 0)::int AS views,
            COALESCE(SUM("sessions"), 0)::int AS sessions,
            COALESCE(SUM("visitors"), 0)::int AS visitors,
            COALESCE(SUM("bounces"), 0)::int AS bounces,
            COALESCE(SUM("total_seconds"), 0)::int AS total_seconds
     FROM "traffic_daily_rollups"
     WHERE "dimension" = 'total' AND "day" >= $1 AND "day" <= $2 ${site ? 'AND "site" = $3' : ''}`,
    ...(site ? [from, to, site] : [from, to]),
  );
  return rows[0] || {};
};

const getSummary = async (window, policy, { site = null, settings = {} } = {}) => {
  const source = sourceFor(window, policy, settings);
  const read = source === 'events' ? totalsFromEvents : totalsFromRollups;

  const [current, previous, liveNow] = await Promise.all([
    read(window.from, window.to, site),
    read(window.prevFrom, window.prevTo, site),
    // Sessions still open — "people on the site right now".
    prisma.trafficSession.count({
      where: {
        endedAt: null,
        lastSeenAt: { gte: new Date(Date.now() - 5 * 60000) },
        ...(site ? { site } : {}),
      },
    }),
  ]);

  const views = num(current.views);
  const sessions = num(current.sessions);

  return {
    views,
    sessions,
    visitors: num(current.visitors),
    bounceRatePercent: sessions ? pct(current.bounces, sessions) : null,
    // Seconds are summed and divided once, never averaged from per-day
    // averages — which is wrong the moment two days differ in size.
    averageSessionSeconds: sessions ? Math.round(safeDiv(current.total_seconds, sessions)) : null,
    viewsPerSession: sessions ? round2(safeDiv(views, sessions)) : null,
    onlineNow: liveNow,
    previous: {
      views: num(previous.views),
      sessions: num(previous.sessions),
      visitors: num(previous.visitors),
    },
    source,
    sourceNote: sourceNote(source, policy, settings),
    /*
     * Visitors cannot be summed across days — the hash rotates at midnight, so
     * the same person is a different hash tomorrow. Over a multi-day window
     * this figure is "visitor-days", and calling it anything else would be a
     * lie the privacy design makes unavoidable.
     */
    visitorsCaveat: (window.to - window.from) > DAY_MS
      ? 'Visitors are counted per day and added up, so somebody who came on three days counts three times. The visitor identifier is re-salted every midnight by design, so it cannot be traced further.'
      : null,
    window: describe(window),
  };
};

/* ── Over time ────────────────────────────────────────────────────────── */

const getTrend = async (window, policy, { site = null, settings = {} } = {}) => {
  const source = sourceFor(window, policy, settings);

  const rows = source === 'events'
    ? await prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, 'v."at"', window.timezone)} AS bucket,
              COUNT(*)::int AS views,
              COUNT(DISTINCT v."session_id")::int AS sessions,
              COUNT(DISTINCT s."visitor_hash")::int AS visitors
       FROM "page_view_events" v
       JOIN "traffic_sessions" s ON s.id = v."session_id"
       WHERE v."at" >= $1 AND v."at" <= $2 ${site ? 'AND v."site" = $3' : ''}
       GROUP BY 1`,
      ...(site ? [window.from, window.to, site] : [window.from, window.to]),
    )
    : await prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, '"day"', window.timezone)} AS bucket,
              COALESCE(SUM("views"), 0)::int AS views,
              COALESCE(SUM("sessions"), 0)::int AS sessions,
              COALESCE(SUM("visitors"), 0)::int AS visitors
       FROM "traffic_daily_rollups"
       WHERE "dimension" = 'total' AND "day" >= $1 AND "day" <= $2 ${site ? 'AND "site" = $3' : ''}
       GROUP BY 1`,
      ...(site ? [window.from, window.to, site] : [window.from, window.to]),
    );

  return {
    series: fillSeries(rows, window, { fields: { views: 0, sessions: 0, visitors: 0 } }),
    source,
    sourceNote: sourceNote(source, policy, settings),
    window: describe(window),
  };
};

/* ── Pages ────────────────────────────────────────────────────────────── */

const getPages = async (window, policy, { site = null, settings = {}, limit = 20 } = {}) => {
  const source = sourceFor(window, policy, settings);
  const take = Math.min(100, Math.max(1, Number(limit) || 20));

  const rows = source === 'events'
    ? await prisma.$queryRawUnsafe(
      `SELECT v."path_pattern" AS path,
              COUNT(*)::int AS views,
              COUNT(DISTINCT v."session_id")::int AS sessions,
              COUNT(*) FILTER (WHERE s."entry_path" = v."path_pattern")::int AS entries,
              (AVG(v."duration_ms") FILTER (WHERE v."duration_ms" IS NOT NULL) / 1000)::float AS avg_seconds,
              COUNT(*) FILTER (WHERE v."duration_ms" IS NULL)::int AS without_duration
       FROM "page_view_events" v
       JOIN "traffic_sessions" s ON s.id = v."session_id"
       WHERE v."at" >= $1 AND v."at" <= $2 ${site ? 'AND v."site" = $3' : ''}
       GROUP BY 1 ORDER BY 2 DESC LIMIT ${take}`,
      ...(site ? [window.from, window.to, site] : [window.from, window.to]),
    )
    : await prisma.$queryRawUnsafe(
      `SELECT "path_pattern" AS path,
              COALESCE(SUM("views"), 0)::int AS views,
              COALESCE(SUM("sessions"), 0)::int AS sessions,
              COALESCE(SUM("entries"), 0)::int AS entries,
              (COALESCE(SUM("total_seconds"), 0)::float
               / NULLIF(SUM("views"), 0))::float AS avg_seconds,
              0::int AS without_duration
       FROM "traffic_path_daily"
       WHERE "day" >= $1 AND "day" <= $2 ${site ? 'AND "site" = $3' : ''}
       GROUP BY 1 ORDER BY 2 DESC LIMIT ${take}`,
      ...(site ? [window.from, window.to, site] : [window.from, window.to]),
    );

  const pages = rows.map((r) => ({
    path: r.path,
    views: num(r.views),
    sessions: num(r.sessions),
    entries: num(r.entries),
    averageSeconds: r.avg_seconds === null ? null : Math.round(r.avg_seconds),
    withoutDuration: num(r.without_duration),
  }));

  const missing = pages.reduce((s, p) => s + p.withoutDuration, 0);
  return {
    pages: withShare(pages, 'views'),
    source,
    sourceNote: sourceNote(source, policy, settings),
    /*
     * A page view only carries a duration if the browser got to send the
     * closing beacon. A tab closed mid-read sends nothing, so those views are
     * EXCLUDED from the average rather than counted as zero seconds — and the
     * page says how many were excluded.
     */
    caveat: missing
      ? `${missing} view${missing === 1 ? '' : 's'} had no time recorded — the tab closed before the browser could report it — and are left out of the averages rather than counted as zero.`
      : null,
    window: describe(window),
  };
};

/* ── Where people come from ───────────────────────────────────────────── */

const DIMENSIONS = {
  source: { events: 's."source"', rollup: 'source' },
  medium: { events: 's."medium"', rollup: 'medium' },
  campaign: { events: 's."campaign"', rollup: 'campaign' },
  referrer: { events: 's."referrer_host"', rollup: 'referrer' },
  device: { events: 's."device_type"', rollup: 'device' },
  browser: { events: 's."browser"', rollup: 'browser' },
  os: { events: 's."os"', rollup: 'os' },
};

const getBreakdown = async (window, policy, {
  by = 'source', site = null, settings = {}, limit = 15,
} = {}) => {
  const dim = DIMENSIONS[by] || DIMENSIONS.source;
  const source = sourceFor(window, policy, settings);
  const take = Math.min(50, Math.max(1, Number(limit) || 15));

  /*
   * Grouped by SESSION, not by page view. "Where did this visit come from" is
   * a property of the visit; counting it per page view would make a visitor
   * who read ten pages look like ten referrals from the same place.
   */
  const rows = source === 'events'
    ? await prisma.$queryRawUnsafe(
      `SELECT COALESCE(NULLIF(${dim.events}, ''), 'unknown') AS value,
              COUNT(*)::int AS sessions,
              COALESCE(SUM(s."views"), 0)::int AS views,
              COUNT(*) FILTER (WHERE s."bounced")::int AS bounces,
              COALESCE(SUM(s."duration_sec"), 0)::int AS total_seconds
       FROM "traffic_sessions" s
       WHERE s."started_at" >= $1 AND s."started_at" <= $2 ${site ? 'AND s."site" = $3' : ''}
       GROUP BY 1 ORDER BY 2 DESC LIMIT ${take}`,
      ...(site ? [window.from, window.to, site] : [window.from, window.to]),
    )
    : await prisma.$queryRawUnsafe(
      `SELECT "value",
              COALESCE(SUM("sessions"), 0)::int AS sessions,
              COALESCE(SUM("views"), 0)::int AS views,
              COALESCE(SUM("bounces"), 0)::int AS bounces,
              COALESCE(SUM("total_seconds"), 0)::int AS total_seconds
       FROM "traffic_daily_rollups"
       WHERE "dimension" = $1 AND "day" >= $2 AND "day" <= $3 ${site ? 'AND "site" = $4' : ''}
       GROUP BY 1 ORDER BY 2 DESC LIMIT ${take}`,
      ...(site
        ? [dim.rollup, window.from, window.to, site]
        : [dim.rollup, window.from, window.to]),
    );

  const items = rows.map((r) => ({
    value: r.value || 'unknown',
    sessions: num(r.sessions),
    views: num(r.views),
    bounceRatePercent: num(r.sessions) ? pct(r.bounces, r.sessions) : null,
    averageSeconds: num(r.sessions)
      ? Math.round(safeDiv(r.total_seconds, r.sessions)) : null,
  }));

  return {
    by,
    items: withShare(items, 'sessions'),
    source,
    sourceNote: sourceNote(source, policy, settings),
    window: describe(window),
  };
};

/* ── Audience ─────────────────────────────────────────────────────────── */

const getAudience = async (window, policy, opts = {}) => {
  const [device, browser, os] = await Promise.all([
    getBreakdown(window, policy, { ...opts, by: 'device', limit: 5 }),
    getBreakdown(window, policy, { ...opts, by: 'browser', limit: 8 }),
    getBreakdown(window, policy, { ...opts, by: 'os', limit: 8 }),
  ]);

  return {
    device: device.items,
    browser: browser.items,
    os: os.items,
    source: device.source,
    /*
     * Said out loud rather than shown as an empty chart. Country would need a
     * GeoIP database, which this platform does not have; deriving it from a
     * timezone or an Accept-Language header is a guess, and a guess on a map
     * is the most convincing wrong number an analytics page can produce.
     */
    caveat: 'Country is not shown: there is no IP-location database on this platform, and guessing it from a timezone or language header would be an estimate presented as a fact.',
    window: describe(window),
  };
};

/* ── Does any of it turn into customers ───────────────────────────────── */

const getConversions = async (window, policy, { site = null, settings = {} } = {}) => {
  const trend = await getTrend(window, policy, { site, settings });

  const signups = await prisma.$queryRawUnsafe(
    `SELECT ${bucketExpr(window.granularity, '"created_at"', window.timezone)} AS bucket,
            COUNT(*)::int AS signups
     FROM "users"
     WHERE "account_type" = 'customer' AND "created_at" >= $1 AND "created_at" <= $2
     GROUP BY 1`,
    window.from, window.to,
  );

  const filled = fillSeries(signups, window, { fields: { signups: 0 } });
  const series = trend.series.map((p, i) => ({
    ...p,
    signups: filled[i]?.signups ?? 0,
  }));

  const totalSessions = series.reduce((s, p) => s + p.sessions, 0);
  const totalSignups = series.reduce((s, p) => s + p.signups, 0);

  const rate = totalSessions ? pct(totalSignups, totalSessions) : null;
  /*
   * More signups than visits means the two counts are not measuring the same
   * population — people signing up through a surface that is not tracked, or
   * tracking that was switched on after the accounts existed. The ratio is
   * then arithmetic rather than a finding, so it is withheld instead of
   * printed as "300%", which reads as a broken page rather than as a
   * mismatch.
   */
  const ratioUsable = rate !== null && rate <= 100;

  return {
    series,
    totalSessions,
    totalSignups,
    signupRatePercent: ratioUsable ? rate : null,
    rawRatePercent: rate,
    /*
     * The honesty that makes this number usable at all. Nothing links a signup
     * back to the visit that produced it — that would need the signup flow to
     * carry a session id, which it does not. These are two series on one axis,
     * and the rate is a ratio of totals, not a traced path.
     */
    caveat: ratioUsable || rate === null
      ? 'Signups are not attributed to a visit. Nothing links a new account back to the session it came from, so this is two counts on the same axis — useful as a trend, not as attribution.'
      : `There were more signups (${totalSignups}) than tracked visits (${totalSessions}) in this window, so no rate is shown. People are reaching signup through a surface that is not being tracked, or tracking was switched on after these accounts existed.`,
    window: describe(window),
  };
};

module.exports = {
  getSummary, getTrend, getPages, getBreakdown, getAudience, getConversions, DIMENSIONS,
};
