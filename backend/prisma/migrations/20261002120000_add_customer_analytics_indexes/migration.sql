-- Indexes the customer/organization analytics need.
--
-- Phase 0 covered the money and usage tables. This phase reads five tables it
-- did not touch, and each one is read the same way: filtered on a bare
-- `created_at` range with no tenant in the predicate, because these are
-- platform-wide aggregates rather than one team's history. Every one of these
-- tables already had an index leading with `team_id` — excellent for the
-- customer center, useless for a question asked across all teams.
--
-- `activity_logs` is the one that matters most. It is the largest table on the
-- platform after `deployment_usages`, it grows on every customer action, and
-- the engagement view filters it on `user_role = 'customer'` plus a date range.
-- The existing indexes lead with `user_id`, `action`, `action_type` and
-- `status`; none of them can serve that predicate, so a DAU/WAU/MAU read
-- scanned the table end to end.
--
-- Same lock note as 20260929120500: these are plain CREATE INDEX statements
-- because Prisma wraps a migration in a transaction and CREATE INDEX
-- CONCURRENTLY cannot run inside one. On a database large enough for the brief
-- write lock to matter, build them first out-of-band with psql --
--
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS "activity_logs_user_role_created_at_idx"
--         ON "activity_logs" ("user_role", "created_at" DESC);
--
-- -- then apply this migration, which skips whatever already exists. A failed
-- concurrent build leaves an INVALID index: find them with
--     SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- and DROP INDEX each one before retrying.

-- ── activity_logs: active users, logins, DAU/WAU/MAU ──
CREATE INDEX IF NOT EXISTS "activity_logs_user_role_created_at_idx"
    ON "activity_logs" ("user_role", "created_at" DESC);

-- ── the three doors into an organization, each read platform-wide ──
CREATE INDEX IF NOT EXISTS "team_invitations_created_at_idx"
    ON "team_invitations" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "team_join_requests_created_at_idx"
    ON "team_join_requests" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "team_join_links_created_at_idx"
    ON "team_join_links" ("created_at" DESC);

-- ── deployment_usages: the per-account lateral in the personal-vs-org mix ──
-- `(team_id, created_at)` exists; this view filters on `period_start`, which
-- is the hour the usage covers rather than the hour the row was written. On a
-- billing job that catches up late the two differ, and `period_start` is the
-- one that belongs in a report.
CREATE INDEX IF NOT EXISTS "deployment_usages_team_id_period_start_idx"
    ON "deployment_usages" ("team_id", "period_start" DESC);
