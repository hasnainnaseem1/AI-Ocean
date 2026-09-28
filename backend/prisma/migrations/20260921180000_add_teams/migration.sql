-- Teams, phase FOUNDATION.
--
-- Until now every wallet, ledger row, saved card, payment, deployment and usage
-- row belonged directly to a User. Teams need money to belong to an ACCOUNT
-- that several people can share, so ownership moves to a new `teams` table and
-- `user_id` on those rows now only records which member acted (who paid, who
-- created the deployment).
--
-- Individual customers do not change: every existing customer gets exactly one
-- `personal` account, is its owner, and everything they had moves onto it —
-- balances, debt, ledger, cards, deployments, usage. Not one row is created or
-- removed in the money tables and no amount is touched; only the owner column
-- is added. `src/scripts/teamsMigrationSnapshot.js` compares every customer's
-- figures before and after.
--
-- Account-level flags move with the money: the gateway customer ids (the card
-- belongs to the account), dispute hold (a chargeback is on the account's
-- card) and pay-as-you-go access.
--
-- Safety: every `team_id` is backfilled while nullable and only then made NOT
-- NULL. A money row that could not be matched to a personal account — for
-- instance one owned by an admin user, who gets no account — makes the NOT NULL
-- step fail and the whole migration roll back, rather than orphaning money.

-- ── Types ────────────────────────────────────────────────────────────────
CREATE TYPE "TeamKind" AS ENUM ('personal', 'team');
CREATE TYPE "TeamRole" AS ENUM ('owner', 'admin', 'billing', 'developer', 'viewer');

-- ── Tables ───────────────────────────────────────────────────────────────
CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "TeamKind" NOT NULL DEFAULT 'team',
    "name" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "payg_access" TEXT NOT NULL DEFAULT 'default',
    "dispute_hold" BOOLEAN NOT NULL DEFAULT false,
    "dispute_reason" TEXT NOT NULL DEFAULT '',
    "disputed_at" TIMESTAMP(3),
    "stripe_customer_id" TEXT,
    "polar_customer_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "teams_payg_access_check" CHECK ("payg_access" IN ('default', 'allowed', 'blocked'))
);

CREATE TABLE "team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'developer',
    "spend_limit_monthly" DECIMAL(12,4),
    "invited_by_id" UUID,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "team_members_spend_limit_check" CHECK ("spend_limit_monthly" IS NULL OR "spend_limit_monthly" >= 0)
);

CREATE INDEX "teams_created_by_id_idx" ON "teams"("created_by_id");
-- One personal account per user, enforced by the database.
CREATE UNIQUE INDEX "teams_one_personal_per_user" ON "teams"("created_by_id") WHERE "kind" = 'personal';
CREATE INDEX "team_members_user_id_idx" ON "team_members"("user_id");
CREATE UNIQUE INDEX "team_members_team_id_user_id_key" ON "team_members"("team_id", "user_id");

ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── A personal account for every existing customer ───────────────────────
INSERT INTO "teams" ("kind", "name", "created_by_id", "payg_access", "dispute_hold",
                     "dispute_reason", "disputed_at", "stripe_customer_id", "polar_customer_id",
                     "created_at", "updated_at")
SELECT 'personal', u."name", u."id", u."payg_access", u."dispute_hold",
       u."dispute_reason", u."disputed_at", u."stripe_customer_id", u."polar_customer_id",
       u."created_at", CURRENT_TIMESTAMP
FROM "users" u
WHERE u."account_type" = 'customer';

INSERT INTO "team_members" ("team_id", "user_id", "role", "joined_at", "updated_at")
SELECT t."id", t."created_by_id", 'owner', t."created_at", CURRENT_TIMESTAMP
FROM "teams" t
WHERE t."kind" = 'personal';

-- ── Move ownership of the money tables to the personal account ───────────
ALTER TABLE "credit_wallets"      ADD COLUMN "team_id" UUID;
ALTER TABLE "credit_transactions" ADD COLUMN "team_id" UUID;
ALTER TABLE "payment_methods"     ADD COLUMN "team_id" UUID;
ALTER TABLE "payments"            ADD COLUMN "team_id" UUID;
ALTER TABLE "deployments"         ADD COLUMN "team_id" UUID;
ALTER TABLE "deployment_usages"   ADD COLUMN "team_id" UUID;

UPDATE "credit_wallets" x SET "team_id" = t."id" FROM "teams" t WHERE t."kind" = 'personal' AND t."created_by_id" = x."user_id";
UPDATE "credit_transactions" x SET "team_id" = t."id" FROM "teams" t WHERE t."kind" = 'personal' AND t."created_by_id" = x."user_id";
UPDATE "payment_methods" x SET "team_id" = t."id" FROM "teams" t WHERE t."kind" = 'personal' AND t."created_by_id" = x."user_id";
UPDATE "payments" x SET "team_id" = t."id" FROM "teams" t WHERE t."kind" = 'personal' AND t."created_by_id" = x."user_id";
UPDATE "deployments" x SET "team_id" = t."id" FROM "teams" t WHERE t."kind" = 'personal' AND t."created_by_id" = x."user_id";
UPDATE "deployment_usages" x SET "team_id" = t."id" FROM "teams" t WHERE t."kind" = 'personal' AND t."created_by_id" = x."user_id";

-- Fails, and rolls everything back, if any row above was left unmatched.
ALTER TABLE "credit_wallets"      ALTER COLUMN "team_id" SET NOT NULL;
ALTER TABLE "credit_transactions" ALTER COLUMN "team_id" SET NOT NULL;
ALTER TABLE "payment_methods"     ALTER COLUMN "team_id" SET NOT NULL;
ALTER TABLE "payments"            ALTER COLUMN "team_id" SET NOT NULL;
ALTER TABLE "deployments"         ALTER COLUMN "team_id" SET NOT NULL;
ALTER TABLE "deployment_usages"   ALTER COLUMN "team_id" SET NOT NULL;

-- The wallet belongs to the account alone; its user column goes.
ALTER TABLE "credit_wallets" DROP CONSTRAINT "credit_wallets_user_id_fkey";
DROP INDEX "credit_wallets_user_id_key";
ALTER TABLE "credit_wallets" DROP COLUMN "user_id";

-- A ledger row's member is optional from now on (account-level entries).
ALTER TABLE "credit_transactions" ALTER COLUMN "user_id" DROP NOT NULL;

CREATE UNIQUE INDEX "credit_wallets_team_id_key" ON "credit_wallets"("team_id");
CREATE INDEX "credit_transactions_team_id_created_at_idx" ON "credit_transactions"("team_id", "created_at" DESC);
CREATE INDEX "payment_methods_team_id_status_idx" ON "payment_methods"("team_id", "status");
CREATE INDEX "payments_team_id_created_at_idx" ON "payments"("team_id", "created_at" DESC);
CREATE INDEX "deployments_team_id_created_at_idx" ON "deployments"("team_id", "created_at" DESC);
CREATE INDEX "deployment_usages_team_id_created_at_idx" ON "deployment_usages"("team_id", "created_at" DESC);

ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deployment_usages" ADD CONSTRAINT "deployment_usages_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Account-level flags have moved to teams ──────────────────────────────
ALTER TABLE "users" DROP COLUMN "dispute_hold",
                    DROP COLUMN "dispute_reason",
                    DROP COLUMN "disputed_at",
                    DROP COLUMN "payg_access",
                    DROP COLUMN "polar_customer_id",
                    DROP COLUMN "stripe_customer_id";
