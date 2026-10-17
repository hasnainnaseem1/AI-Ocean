-- Analytics policy — the thresholds the analytics layer interprets numbers with.
--
-- One Json column per section so a new tunable needs no migration; the shipped
-- defaults in services/analytics/analyticsPolicyDefaults.js are deep-merged
-- underneath, so a policy row written today still resolves correctly after a
-- new section ships.
--
-- "Exactly one active" is the partial unique index at the bottom. Prisma's DSL
-- cannot express it — a plain @@unique([is_active]) would also forbid a second
-- INACTIVE row, which is a perfectly normal state — so it is written by hand
-- here, exactly as 20260906114845_recommendation_policy_single_active does for
-- the recommendation engine.

-- CreateTable
CREATE TABLE "analytics_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT false,

    "windows" JSONB,
    "capacity" JSONB,
    "engagement" JSONB,
    "churn" JSONB,
    "retention" JSONB,
    "receivables" JSONB,
    "support" JSONB,
    "traffic" JSONB,
    "dashboard" JSONB,

    "cache_ttl_seconds" INTEGER,
    "heavy_window_cache_ttl_seconds" INTEGER,
    "heavy_window_days" INTEGER,

    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_policies_key_key" ON "analytics_policies"("key");

-- AddForeignKey
ALTER TABLE "analytics_policies" ADD CONSTRAINT "analytics_policies_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one active policy, enforced by the database rather than by a
-- promise in application code.
CREATE UNIQUE INDEX "analytics_policies_single_active_idx"
    ON "analytics_policies" ("is_active")
    WHERE "is_active" = true;
