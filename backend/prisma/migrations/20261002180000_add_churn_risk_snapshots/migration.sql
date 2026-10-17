-- Churn risk, recorded daily.
--
-- ── Why a table and not a query ──
--
-- Every input to a churn score is current state: days since the last sign-in,
-- what the wallet holds, how many automatic charges have failed. All of it is
-- overwritten in place — `credit_wallets.balance` keeps one number, and
-- `users.last_login` keeps one timestamp. So a score for last Tuesday cannot be
-- reconstructed from anything in this database, and "is our at-risk list
-- shrinking?" — the only question that tells an operator whether what they did
-- worked — stays permanently unanswerable unless each day's score is written
-- down on the day.
--
-- The rendered sentences are stored alongside the raw signals on purpose. An
-- operator opening a month-old snapshot must see the explanation the list gave
-- THAT DAY, not today's templates re-rendered over old numbers.
--
-- Only accounts at or above the policy's `churn.snapshotMinScore` are written;
-- the healthy majority would be one row per team per day forever, answering
-- nothing. Rows are pruned by the nightly rollup at
-- `churn.snapshotRetentionDays`.

CREATE TABLE IF NOT EXISTS "churn_risk_snapshots" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id"    UUID NOT NULL,
    "day"        DATE NOT NULL,
    "score"      INTEGER NOT NULL,
    "band"       TEXT NOT NULL,
    "team_name"  TEXT NOT NULL,
    "team_kind"  TEXT NOT NULL,
    "reasons"    JSONB NOT NULL DEFAULT '[]',
    "signals"    JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "churn_risk_snapshots_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    -- One row per team per day. This is what makes the nightly job idempotent:
    -- a re-run updates the day in place instead of doubling it.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'churn_risk_snapshots_team_id_day_key'
    ) THEN
        ALTER TABLE "churn_risk_snapshots"
            ADD CONSTRAINT "churn_risk_snapshots_team_id_day_key" UNIQUE ("team_id", "day");
    END IF;

    -- CASCADE: a deleted account's risk history is about an account that no
    -- longer exists. Unlike the ledger, nothing is owed on it.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'churn_risk_snapshots_team_id_fkey'
    ) THEN
        ALTER TABLE "churn_risk_snapshots"
            ADD CONSTRAINT "churn_risk_snapshots_team_id_fkey"
            FOREIGN KEY ("team_id") REFERENCES "teams"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'churn_risk_snapshots_score_check'
    ) THEN
        ALTER TABLE "churn_risk_snapshots"
            ADD CONSTRAINT "churn_risk_snapshots_score_check"
            CHECK ("score" >= 0 AND "score" <= 100);
    END IF;
END $$;

-- "Today's list, worst first" and "how did the bands move over time".
CREATE INDEX IF NOT EXISTS "churn_risk_snapshots_day_score_idx"
    ON "churn_risk_snapshots" ("day" DESC, "score" DESC);
CREATE INDEX IF NOT EXISTS "churn_risk_snapshots_band_day_idx"
    ON "churn_risk_snapshots" ("band", "day" DESC);

-- ── Indexes the retention reads need ──
-- Cohorts walk every team's first and last activity month. `deployment_usages`
-- already has (team_id, period_start) from the customer-analytics migration;
-- these cover the other two sources a cohort can be defined by.
CREATE INDEX IF NOT EXISTS "team_members_user_id_joined_at_idx"
    ON "team_members" ("user_id", "joined_at" DESC);
