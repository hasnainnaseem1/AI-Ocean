-- First-party traffic analytics.
--
-- ── Why the platform records this itself ──
--
-- `activity_logs.user_id` is NOT NULL with a foreign key, so it cannot record
-- anybody who has not signed in — and on a marketing site, the people worth
-- measuring are precisely the ones who have not. No table on this platform
-- stored a URL or a visit before these.
--
-- ── Privacy decisions baked into the shape ──
--
--  • There is no visitor identifier on the client. `visitor_hash` is
--    sha256(daily salt + anonymised IP + user agent), and the salt rotates
--    every day, so the same person on two days is two unrelated hashes. No
--    cookie, no localStorage, no consent banner. The cost is that "returning
--    visitor" is unanswerable, which is the right trade.
--  • `page_view_events.path` has the operator's strip-list query keys removed
--    SERVER-SIDE before insert. The customer center's own URLs carry invite
--    and password-reset tokens; stripping in the browser would be a request,
--    not an enforcement.
--  • Only the referring HOST is stored, never the full referring URL.
--
-- ── Why the rollups exist ──
--
-- `page_view_events` is the only table on this platform that grows without
-- bound, and it is deleted at the operator's `dataRetentionDays` (90 by
-- default). Without a rollup, a ninety-day retention would mean no
-- year-on-year comparison ever existed. The rollups are small, keyed by day,
-- and survive the prune.

-- ── Sessions first: page views point at them ──
CREATE TABLE IF NOT EXISTS "traffic_sessions" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "site"          TEXT NOT NULL,
    "visitor_hash"  TEXT NOT NULL,
    "entry_path"    TEXT NOT NULL,
    "referrer_host" TEXT NOT NULL DEFAULT '',
    "source"        TEXT NOT NULL DEFAULT '',
    "medium"        TEXT NOT NULL DEFAULT '',
    "campaign"      TEXT NOT NULL DEFAULT '',
    "device_type"   TEXT NOT NULL DEFAULT '',
    "browser"       TEXT NOT NULL DEFAULT '',
    "os"            TEXT NOT NULL DEFAULT '',
    "views"         INTEGER NOT NULL DEFAULT 0,
    "started_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at"      TIMESTAMP(3),
    "bounced"       BOOLEAN,
    "duration_sec"  INTEGER,
    CONSTRAINT "traffic_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "page_view_events" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "site"          TEXT NOT NULL,
    "session_id"    UUID NOT NULL,
    "path"          TEXT NOT NULL,
    "path_pattern"  TEXT NOT NULL,
    "referrer_host" TEXT NOT NULL DEFAULT '',
    "source"        TEXT NOT NULL DEFAULT '',
    "medium"        TEXT NOT NULL DEFAULT '',
    "campaign"      TEXT NOT NULL DEFAULT '',
    "device_type"   TEXT NOT NULL DEFAULT '',
    "browser"       TEXT NOT NULL DEFAULT '',
    "os"            TEXT NOT NULL DEFAULT '',
    "duration_ms"   INTEGER,
    "at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_view_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "traffic_daily_rollups" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "day"           DATE NOT NULL,
    "site"          TEXT NOT NULL,
    "dimension"     TEXT NOT NULL,
    "value"         TEXT NOT NULL,
    "views"         INTEGER NOT NULL DEFAULT 0,
    "sessions"      INTEGER NOT NULL DEFAULT 0,
    "visitors"      INTEGER NOT NULL DEFAULT 0,
    "bounces"       INTEGER NOT NULL DEFAULT 0,
    "total_seconds" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "traffic_daily_rollups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "traffic_path_daily" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "day"           DATE NOT NULL,
    "site"          TEXT NOT NULL,
    "path_pattern"  TEXT NOT NULL,
    "views"         INTEGER NOT NULL DEFAULT 0,
    "sessions"      INTEGER NOT NULL DEFAULT 0,
    "entries"       INTEGER NOT NULL DEFAULT 0,
    "exits"         INTEGER NOT NULL DEFAULT 0,
    "total_seconds" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "traffic_path_daily_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    -- CASCADE: a page view without its session is not a measurement of
    -- anything, and the prune deletes whole sessions.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_view_events_session_id_fkey') THEN
        ALTER TABLE "page_view_events"
            ADD CONSTRAINT "page_view_events_session_id_fkey"
            FOREIGN KEY ("session_id") REFERENCES "traffic_sessions"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- Which surfaces may report. Kept as a CHECK rather than an enum for the
    -- same reason `support_tickets.status` is: a small, fixed, admin-facing
    -- vocabulary that an operator should not need a migration to extend.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'page_view_events_site_check') THEN
        ALTER TABLE "page_view_events"
            ADD CONSTRAINT "page_view_events_site_check"
            CHECK ("site" IN ('marketing', 'customer', 'admin'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'traffic_sessions_site_check') THEN
        ALTER TABLE "traffic_sessions"
            ADD CONSTRAINT "traffic_sessions_site_check"
            CHECK ("site" IN ('marketing', 'customer', 'admin'));
    END IF;

    -- The uniqueness that makes the nightly rollup idempotent: a re-run
    -- updates the day in place rather than doubling it.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'traffic_daily_rollups_day_site_dimension_value_key') THEN
        ALTER TABLE "traffic_daily_rollups"
            ADD CONSTRAINT "traffic_daily_rollups_day_site_dimension_value_key"
            UNIQUE ("day", "site", "dimension", "value");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'traffic_path_daily_day_site_path_pattern_key') THEN
        ALTER TABLE "traffic_path_daily"
            ADD CONSTRAINT "traffic_path_daily_day_site_path_pattern_key"
            UNIQUE ("day", "site", "path_pattern");
    END IF;
END $$;

-- ── Indexes ──
-- `page_view_events` is the fastest-growing table here; every read of it is a
-- date range, usually narrowed by site or by path pattern.
CREATE INDEX IF NOT EXISTS "page_view_events_at_idx"            ON "page_view_events" ("at" DESC);
CREATE INDEX IF NOT EXISTS "page_view_events_site_at_idx"       ON "page_view_events" ("site", "at" DESC);
CREATE INDEX IF NOT EXISTS "page_view_events_session_id_at_idx" ON "page_view_events" ("session_id", "at" ASC);
CREATE INDEX IF NOT EXISTS "page_view_events_path_pattern_at_idx" ON "page_view_events" ("path_pattern", "at" DESC);

-- Session stitching looks up the visitor's most recent session on every single
-- beacon, so this index is on the hot write path, not just the read path.
CREATE INDEX IF NOT EXISTS "traffic_sessions_visitor_hash_last_seen_at_idx"
    ON "traffic_sessions" ("visitor_hash", "last_seen_at" DESC);
CREATE INDEX IF NOT EXISTS "traffic_sessions_site_started_at_idx"
    ON "traffic_sessions" ("site", "started_at" DESC);
-- Closing idle sessions: "open, and quiet since before X".
CREATE INDEX IF NOT EXISTS "traffic_sessions_ended_at_last_seen_at_idx"
    ON "traffic_sessions" ("ended_at", "last_seen_at");

CREATE INDEX IF NOT EXISTS "traffic_daily_rollups_day_dimension_idx"
    ON "traffic_daily_rollups" ("day" DESC, "dimension");
CREATE INDEX IF NOT EXISTS "traffic_path_daily_day_views_idx"
    ON "traffic_path_daily" ("day" DESC, "views" DESC);
