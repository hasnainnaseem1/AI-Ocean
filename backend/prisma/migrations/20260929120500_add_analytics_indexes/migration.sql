-- Indexes the analytics layer needs to stay off sequential scans.
--
-- Written while rebuilding the admin Dashboard and Analytics pages. The
-- starting position was worse than it looked: `users` had NO index at all
-- beyond its primary key and the unique on email, so every signup trend and
-- every "how many active customers" count read the whole table. `payments`
-- had an index on status but none on `paid_at`, which every revenue figure
-- filters by. `deployment_usages` — the platform's usage fact table, and the
-- hottest path in the whole suite — had nothing on bare `created_at` or
-- `period_start`, so every platform-wide GPU-hours or revenue trend scanned it
-- end to end.
--
-- ── A note for whoever runs this against a large database ──
--
-- These are plain CREATE INDEX statements, which take a brief write lock on
-- each table. That is the right call here and on any database of this size
-- (milliseconds), and it is the only form Prisma can run: CREATE INDEX
-- CONCURRENTLY cannot execute inside a transaction block, and Prisma Migrate
-- wraps each migration in one.
--
-- If you are applying this to a production database large enough for the lock
-- to matter, build them out-of-band FIRST, with psql, one at a time:
--
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_created_at_idx"
--         ON "users" ("created_at" DESC);
--     -- ...and so on for each index below
--
-- then apply this migration, which will skip every index that already exists.
-- If a concurrent build fails part way it leaves an INVALID index behind:
-- find them with
--     SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- and DROP INDEX each one before retrying.

-- ── users: every signup trend and account count ──
CREATE INDEX IF NOT EXISTS "users_created_at_idx"          ON "users" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "users_account_type_status_idx" ON "users" ("account_type", "status");
-- Dormancy is the strongest churn signal; it is a range scan over this column.
CREATE INDEX IF NOT EXISTS "users_last_login_idx"          ON "users" ("last_login" DESC);

-- ── payments: revenue trend, MRR, success rate ──
CREATE INDEX IF NOT EXISTS "payments_status_paid_at_idx"   ON "payments" ("status", "paid_at" DESC);

-- ── deployment_usages: the usage fact table, the hottest path here ──
CREATE INDEX IF NOT EXISTS "deployment_usages_created_at_idx"       ON "deployment_usages" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "deployment_usages_period_start_idx"     ON "deployment_usages" ("period_start" DESC);
-- compute vs storage split, over a window.
CREATE INDEX IF NOT EXISTS "deployment_usages_kind_period_start_idx" ON "deployment_usages" ("kind", "period_start" DESC);

-- ── credit_transactions: the money time series ──
-- Gateway attribution lives on `source` (Payment has no gateway column).
CREATE INDEX IF NOT EXISTS "credit_transactions_source_created_at_idx"     ON "credit_transactions" ("source", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "credit_transactions_team_type_created_at_idx"  ON "credit_transactions" ("team_id", "type", "created_at" DESC);

-- ── credit_wallets: receivables and churn risk both scan every wallet ──
CREATE INDEX IF NOT EXISTS "credit_wallets_outstanding_balance_idx" ON "credit_wallets" ("outstanding_balance" DESC);
CREATE INDEX IF NOT EXISTS "credit_wallets_balance_idx"             ON "credit_wallets" ("balance");
CREATE INDEX IF NOT EXISTS "credit_wallets_debt_since_idx"          ON "credit_wallets" ("debt_since");
CREATE INDEX IF NOT EXISTS "credit_wallets_auto_charge_failures_idx" ON "credit_wallets" ("auto_charge_failures");

-- ── teams: personal vs organization splits, and the one true churn timestamp ──
CREATE INDEX IF NOT EXISTS "teams_deleted_at_idx"        ON "teams" ("deleted_at");
CREATE INDEX IF NOT EXISTS "teams_kind_created_at_idx"   ON "teams" ("kind", "created_at" DESC);

-- ── deployments: lifecycle trends and per-tier consumption ──
CREATE INDEX IF NOT EXISTS "deployments_created_at_idx"    ON "deployments" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "deployments_started_at_idx"    ON "deployments" ("started_at" DESC);
CREATE INDEX IF NOT EXISTS "deployments_terminated_at_idx" ON "deployments" ("terminated_at" DESC);
CREATE INDEX IF NOT EXISTS "deployments_tier_id_status_idx" ON "deployments" ("tier_id", "status");
-- Custom builds never create a Tier row — the parts list is JSON on the
-- deployment, so "which component do people ask for that we do not stock" is
-- a JSON containment query.
CREATE INDEX IF NOT EXISTS "deployments_tier_custom_build_gin_idx"
    ON "deployments" USING GIN ("tier_custom_build" jsonb_path_ops);

-- ── deployment_status_history: approval latency, the funnel's only source ──
CREATE INDEX IF NOT EXISTS "deployment_status_history_status_at_idx" ON "deployment_status_history" ("status", "at" DESC);

-- ── team_activity: member joins/leaves are only recoverable from here,
--    because removing a member is a hard delete of the team_members row ──
CREATE INDEX IF NOT EXISTS "team_activity_action_created_at_idx" ON "team_activity" ("action", "created_at" DESC);
