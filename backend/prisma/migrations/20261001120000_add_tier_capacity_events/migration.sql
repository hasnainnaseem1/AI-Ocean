-- Stock history for machine types.
--
-- `tiers.capacity_allocated` and `tiers.status` are updated in place every
-- time a deployment starts or ends, so the previous value is gone the moment
-- it changes. That makes "how long was the A100 out of stock last month" —
-- the one question that turns a stock-out into a number anybody can act on —
-- unanswerable from the tiers table.
--
-- One append-only log, not a log plus a daily snapshot table: a heartbeat row
-- written once a day by the analytics rollup job gives the daily series
-- (`WHERE is_heartbeat`), while consecutive rows under a window function give
-- exact outage durations. Two tables would have been the same data twice.
--
-- Rows are written inside the same transaction as the capacity change itself.

CREATE TABLE "tier_capacity_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tier_id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "capacity_total" INTEGER NOT NULL,
    "capacity_allocated" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "status" "TierStatus" NOT NULL,
    "price_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "active_deployments" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "is_heartbeat" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tier_capacity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tier_capacity_events_tier_id_at_idx" ON "tier_capacity_events"("tier_id", "at" DESC);
CREATE INDEX "tier_capacity_events_at_idx"         ON "tier_capacity_events"("at" DESC);
CREATE INDEX "tier_capacity_events_status_at_idx"  ON "tier_capacity_events"("status", "at" DESC);

-- AddForeignKey
ALTER TABLE "tier_capacity_events" ADD CONSTRAINT "tier_capacity_events_tier_id_fkey"
    FOREIGN KEY ("tier_id") REFERENCES "tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
