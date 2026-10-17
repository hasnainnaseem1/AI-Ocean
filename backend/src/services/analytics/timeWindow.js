/**
 * What a reporting window is, and which calendar it is measured on.
 *
 * ── The bug this file exists to end ──
 *
 * The original analytics code measured one response against three different
 * calendars at once: Postgres `date_trunc` truncated in the database session's
 * timezone, `toISOString()` produced UTC day keys in JavaScript, and
 * `setDate()` walked days in the Node process's local timezone. On any server
 * not running in UTC those disagree, so a row written near midnight lands in
 * one bucket in SQL and a different bucket in the gap-filling loop — and the
 * day silently reads as zero. The gap-filling loop itself was copy-pasted four
 * times, so the bug had four homes.
 *
 * Everything here is measured in ONE timezone, taken from
 * `policy.windows.timezone` (default UTC). The SQL expression, the bucket keys
 * and the boundary arithmetic all come from this module, so they cannot drift.
 *
 * ── Buckets are labels, not instants ──
 *
 * A bucket key is a calendar label ('2026-09-14', '2026-09' …), produced by
 * Postgres with `to_char` and enumerated in JavaScript by plain calendar
 * arithmetic. Nothing here converts a label back into an instant, which is
 * what makes daylight-saving transitions a non-event: a DST day is still
 * exactly one label.
 */

/** Postgres `date_trunc` units we allow. This is the ONLY string ever
 *  interpolated into SQL from this module, so it is a closed set. */
const GRANULARITIES = ['hour', 'day', 'week', 'month'];

/** to_char formats, chosen so the key Postgres emits is byte-identical to the
 *  key `bucketKeys()` generates. Week keys are the Monday's date, matching
 *  what `date_trunc('week', …)` returns. */
const KEY_FORMAT = {
  hour: 'YYYY-MM-DD HH24:00',
  day: 'YYYY-MM-DD',
  week: 'YYYY-MM-DD',
  month: 'YYYY-MM',
};

const DAY_MS = 86400000;

/* ── Timezone plumbing ─────────────────────────────────────────────────── */

/**
 * A timezone is safe to interpolate only if Postgres and JavaScript both
 * accept it and it cannot carry SQL. Both checks matter: the character class
 * stops injection, `Intl` stops a typo becoming a silently-wrong report.
 */
const safeTimezone = (tz) => {
  const value = String(tz || 'UTC');
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(value)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
};

/**
 * The zone's offset from UTC at a given instant, in milliseconds.
 *
 * Derived rather than looked up: ask Intl what wall-clock `instant` shows in
 * the zone, treat that wall-clock as if it were UTC, and the difference is the
 * offset. Works for every IANA zone including half-hour ones, and follows DST
 * because the answer is asked of a specific instant rather than of the zone.
 */
const tzOffsetMs = (instant, tz) => {
  const p = partsInTz(instant, tz);
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute),
  );
  return asUtc - instant.getTime();
};

/**
 * The instant at which a calendar day begins in a timezone.
 *
 * Two passes: the first guess assumes UTC and is corrected by the offset
 * there, the second re-corrects using the offset at the corrected instant —
 * which is what makes it right on the two days a year the offset changes
 * between the guess and the answer.
 */
const startOfDayInTz = (civilDate, tz) => {
  const base = Date.UTC(
    Number(civilDate.slice(0, 4)), Number(civilDate.slice(5, 7)) - 1, Number(civilDate.slice(8, 10)),
  );
  let t = base - tzOffsetMs(new Date(base), tz);
  t = base - tzOffsetMs(new Date(t), tz);
  return new Date(t);
};

/** The civil (wall-clock) parts of an instant, in a given timezone. */
const partsInTz = (date, tz) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const out = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  // Intl renders midnight as '24' in some ICU versions; normalise it.
  if (out.hour === '24') out.hour = '00';
  return out;
};

/* ── SQL fragments ─────────────────────────────────────────────────────── */

/**
 * `date_trunc` over a column, in the window's timezone.
 *
 * Every DateTime column in this schema is `timestamp(3)` WITHOUT time zone and
 * Prisma writes UTC instants into them, so the stored value is UTC wall-clock.
 * To read it on another calendar it must first be told it is UTC
 * (`AT TIME ZONE 'UTC'` turns the naive value into a real instant) and then
 * converted (`AT TIME ZONE tz` turns that instant back into naive local time).
 * Skipping the first step is the classic double-shift bug.
 */
const truncExpr = (granularity, column, tz = 'UTC') => {
  const unit = GRANULARITIES.includes(granularity) ? granularity : 'day';
  const zone = safeTimezone(tz);
  const col = zone === 'UTC' ? column : `((${column}) AT TIME ZONE 'UTC' AT TIME ZONE '${zone}')`;
  return `date_trunc('${unit}', ${col})`;
};

/** The same, wrapped so the query returns the bucket key string directly —
 *  which is what `fillSeries` matches on. */
const bucketExpr = (granularity, column, tz = 'UTC') => {
  const unit = GRANULARITIES.includes(granularity) ? granularity : 'day';
  return `to_char(${truncExpr(unit, column, tz)}, '${KEY_FORMAT[unit]}')`;
};

/* ── Window resolution ─────────────────────────────────────────────────── */

const PRESET_DAYS = {
  '24h': 1, '7d': 7, '14d': 14, '30d': 30, '90d': 90, '180d': 180, '1y': 365,
};

/** Span → granularity, when the caller asked for 'auto'. Deliberately coarse:
 *  a 90-day chart with hourly points is unreadable and expensive. */
const autoGranularity = (spanDays) => {
  if (spanDays <= 2) return 'hour';
  if (spanDays <= 92) return 'day';
  if (spanDays <= 400) return 'week';
  return 'month';
};

/** The calendar date an instant falls on, in a given timezone. */
const civilDateInTz = (date, tz) => {
  const p = partsInTz(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One end of a custom window.
 *
 * A date-only bound ("2026-08-01") names a DAY, not an instant, and the day it
 * names is a day on the reporting calendar — so it snaps to that day's
 * midnight, or to the last millisecond before the next one. Treating it as UTC
 * midnight instead is the bug the preset path already documents avoiding: with
 * a reporting timezone five hours ahead, "1 August" would start at 05:00 and
 * the chart's first bar would come in a fifth short for no reason the reader
 * can see.
 *
 * A full timestamp is honoured as sent. Somebody asking for a window down to
 * the hour means it, and this module has no business rounding it off.
 */
const parseBound = (raw, tz, edge) => {
  const value = String(raw).trim();
  if (DATE_ONLY.test(value)) {
    const midnight = startOfDayInTz(value, tz);
    return edge === 'end' ? new Date(midnight.getTime() + DAY_MS - 1) : midnight;
  }
  return new Date(value);
};

const startOfBucket = (date, granularity, tz) => {
  const p = partsInTz(date, tz);
  if (granularity === 'hour') return `${p.year}-${p.month}-${p.day} ${p.hour}:00`;
  if (granularity === 'month') return `${p.year}-${p.month}`;
  if (granularity === 'week') {
    // Monday, to match Postgres `date_trunc('week', …)`.
    const utc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
    const dow = new Date(utc).getUTCDay();           // 0 = Sunday
    const backToMonday = (dow + 6) % 7;
    return new Date(utc - backToMonday * DAY_MS).toISOString().slice(0, 10);
  }
  return `${p.year}-${p.month}-${p.day}`;
};

/**
 * Resolve a request's window.
 *
 * @param {Object} query  { period, from, to, granularity, compare }
 * @param {Object} policy resolved AnalyticsPolicy (only `windows` is read)
 * @returns {{from:Date,to:Date,prevFrom:Date,prevTo:Date,granularity:string,
 *            timezone:string,spanDays:number,label:string,compare:boolean,
 *            cacheKey:string}}
 */
const resolveWindow = (query = {}, policy = {}) => {
  const windows = policy.windows || {};
  const tz = safeTimezone(windows.timezone);
  const maxRangeDays = Number(windows.maxRangeDays) || 730;

  const now = new Date();
  let to;
  let from;
  let label;
  let custom = false;

  /*
   * A reversed range is put the right way round BEFORE either end is parsed,
   * not after. Each end carries its own edge — the earlier one opens its day,
   * the later one closes its day — so swapping the resolved instants instead
   * would leave the window running from one minute before midnight to one
   * minute after it, and both end bars would come in nearly empty.
   */
  let rawFrom = query.from ? String(query.from).trim() : null;
  let rawTo = query.to ? String(query.to).trim() : null;
  if (rawFrom && rawTo && new Date(rawFrom) > new Date(rawTo)) [rawFrom, rawTo] = [rawTo, rawFrom];

  to = rawTo ? parseBound(rawTo, tz, 'end') : now;
  const customFrom = rawFrom ? parseBound(rawFrom, tz, 'start') : null;
  if (customFrom && !Number.isNaN(customFrom.getTime()) && !Number.isNaN(to.getTime())) {
    from = customFrom;
    custom = true;
  } else {
    const period = PRESET_DAYS[query.period] ? query.period : (windows.defaultPeriod || '30d');
    const days = PRESET_DAYS[period] || 30;
    to = now;
    /*
     * "Last 30 days" means thirty WHOLE days ending today, not a rolling
     * 30×24 hours. Anchoring `from` to the start of the day 29 days back is
     * the difference between 30 bars and 31 — and in the 31-bar version both
     * ends are partial days, so the chart opens and closes on a bar that is
     * artificially low for no reason the reader can see.
     *
     * Sub-two-day presets stay rolling: they are rendered hourly, where
     * snapping to midnight would silently turn "the last 24 hours" into
     * "today so far".
     */
    if (days <= 2) {
      from = new Date(now.getTime() - days * DAY_MS);
    } else {
      const firstDay = startOfBucket(new Date(now.getTime() - (days - 1) * DAY_MS), 'day', tz);
      from = startOfDayInTz(firstDay, tz);
    }
    label = period;
  }

  if (Number.isNaN(from.getTime())) from = new Date(now.getTime() - 30 * DAY_MS);
  if (Number.isNaN(to.getTime())) to = now;
  if (from > to) [from, to] = [to, from];

  // A window nobody asked for is a table scan nobody wanted. Clamp rather
  // than reject, the same way `paginate()` clamps a limit.
  const spanMs = to.getTime() - from.getTime();
  if (spanMs > maxRangeDays * DAY_MS) from = new Date(to.getTime() - maxRangeDays * DAY_MS);

  // Named last, so a clamped or corrected window is labelled with what it
  // actually covers rather than with what was asked for.
  if (custom) label = `${civilDateInTz(from, tz)}..${civilDateInTz(to, tz)}`;

  const spanDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
  const asked = query.granularity;
  const granularity = GRANULARITIES.includes(asked) ? asked : autoGranularity(spanDays);

  // The immediately preceding window of the same length — what "vs previous
  // period" compares against.
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

  /*
   * The cache key rounds `to` DOWN to its bucket. Without this every request
   * carries a slightly different `now`, so the key is unique every time and
   * the cache never once hits — a cache that exists only to add a Map write.
   */
  const cacheKey = [
    label,
    startOfBucket(from, granularity, tz),
    startOfBucket(to, granularity, tz),
    granularity,
    tz,
  ].join(':');

  return {
    from,
    to,
    prevFrom,
    prevTo,
    granularity,
    timezone: tz,
    spanDays,
    label,
    compare: query.compare === true || query.compare === 'true',
    cacheKey,
  };
};

/** Every bucket key the window covers, in order, with no gaps. */
const bucketKeys = (window) => {
  const { granularity, timezone: tz } = window;
  const keys = [];
  const seen = new Set();

  if (granularity === 'hour') {
    const HOUR_MS = 3600000;
    // Step by the hour and let the formatter place each instant on the
    // target calendar — a DST shift simply repeats or skips a label, which
    // the Set below collapses.
    for (let t = window.from.getTime(); t <= window.to.getTime(); t += HOUR_MS) {
      const key = startOfBucket(new Date(t), 'hour', tz);
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
    }
    return keys;
  }

  const step = granularity === 'week' ? 7 : 1;
  if (granularity === 'month') {
    const start = partsInTz(window.from, tz);
    const end = partsInTz(window.to, tz);
    let y = Number(start.year);
    let m = Number(start.month);
    const endY = Number(end.year);
    const endM = Number(end.month);
    while (y < endY || (y === endY && m <= endM)) {
      keys.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return keys;
  }

  // Day and week: enumerate calendar dates. Built from Date.UTC on civil
  // parts, so this is pure calendar arithmetic with no timezone in it.
  const first = startOfBucket(window.from, granularity, tz);
  const last = startOfBucket(window.to, granularity, tz);
  let cursor = Date.UTC(
    Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, Number(first.slice(8, 10)),
  );
  const endAt = Date.UTC(
    Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1, Number(last.slice(8, 10)),
  );
  while (cursor <= endAt) {
    keys.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += step * DAY_MS;
  }
  return keys;
};

/**
 * Turn sparse query rows into a dense series — one entry per bucket, zeroes
 * where the database had nothing to say.
 *
 * @param {Array}  rows   query results, each carrying the bucket key
 * @param {Object} window from `resolveWindow`
 * @param {Object} spec   { key = 'bucket', fields: { views: 0, … } }
 *
 * A missing bucket has to become an explicit zero rather than a gap: a line
 * chart draws straight through a gap, which reads as "it stayed at yesterday's
 * level" when the truth is "nothing happened".
 */
const fillSeries = (rows, window, spec = {}) => {
  const key = spec.key || 'bucket';
  const fields = spec.fields || {};
  const fieldNames = Object.keys(fields);

  const byKey = new Map();
  for (const row of rows || []) byKey.set(String(row[key]), row);

  return bucketKeys(window).map((bucket) => {
    const row = byKey.get(bucket);
    const out = { bucket };
    for (const name of fieldNames) {
      out[name] = row && row[name] !== null && row[name] !== undefined
        ? Number(row[name])
        : fields[name];
    }
    return out;
  });
};

/**
 * Pair a series against the same-length previous window by position.
 *
 * Positional, not by key — the previous window's keys are different dates by
 * definition, so "the 3rd day of this window vs the 3rd day of the last one"
 * is the only alignment that means anything.
 */
const alignCompare = (current = [], previous = []) => current.map((point, i) => ({
  ...point,
  prevBucket: previous[i]?.bucket ?? null,
  prevValue: previous[i] ? previous[i][Object.keys(point).find((k) => k !== 'bucket')] ?? null : null,
}));

/** What every analytics response echoes back, so the UI can label the axis
 *  and say which calendar it is on. */
const describe = (window) => ({
  from: window.from.toISOString(),
  to: window.to.toISOString(),
  granularity: window.granularity,
  timezone: window.timezone,
  label: window.label,
});

module.exports = {
  GRANULARITIES,
  PRESET_DAYS,
  safeTimezone,
  truncExpr,
  bucketExpr,
  resolveWindow,
  bucketKeys,
  fillSeries,
  alignCompare,
  describe,
};
