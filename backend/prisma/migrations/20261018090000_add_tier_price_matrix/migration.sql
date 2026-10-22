-- A tier's price becomes a small table instead of a single number.
--
-- `tiers.price_per_hour` stays exactly where it is and keeps working. Nothing
-- reads these two tables yet, so applying this migration changes no behaviour
-- at all — it only makes room for the per-cloud, per-region prices that the
-- hourly refresh job will fill in later.
--
-- Why two tables rather than one:
--
--   `tier_prices`        what ONE tier costs and sells for in one place
--   `cloud_region_costs` what a REGION costs before any machine runs in it
--
-- The second exists because that cost has no tier attached to it. An AWS NAT
-- gateway is charged per availability zone whether zero machines use it or a
-- hundred; storing it per tier would mean the same standing cost recorded
-- once per tier and drifting between them.

CREATE TABLE "tier_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),

  "tier_id" UUID NOT NULL,
  -- 'gcp' | 'aws'
  "cloud"  TEXT NOT NULL,
  -- The PLATFORM region ('eu-central'), never the provider's own ('eu-west-1').
  "region" TEXT NOT NULL,

  -- What the tier's specs actually build as on this cloud.
  "machine_type" TEXT NOT NULL DEFAULT '',

  -- ── Cost. Written only by the refresh job. ──
  -- Decimal(12,6) rather than (12,4) like the sell columns: a per-hour share of
  -- a regional cost spread over many machines is genuinely sub-cent, and
  -- rounding it to four places at this stage would round real money to zero.
  "provider_cost_per_hour"  DECIMAL(12,6) NOT NULL DEFAULT 0,
  "regional_share_per_hour" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "overhead_per_hour"       DECIMAL(12,6) NOT NULL DEFAULT 0,
  "tax_per_hour"            DECIMAL(12,6) NOT NULL DEFAULT 0,
  "total_cost_per_hour"     DECIMAL(12,6) NOT NULL DEFAULT 0,
  "floor_price_per_hour"    DECIMAL(12,6) NOT NULL DEFAULT 0,

  -- 'live' | 'recorded' | 'unknown'
  "cost_source" TEXT NOT NULL DEFAULT 'unknown',
  "cost_as_of"  TIMESTAMP(3),

  -- ── Sell. Four places, because this is a figure that appears on an invoice. ──
  "sell_price_per_hour"    DECIMAL(12,4) NOT NULL DEFAULT 0,
  "stopped_price_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
  -- An admin typed this cell. The refresh job leaves such a row's price alone;
  -- without this flag the next hourly pass would quietly undo their edit.
  "sell_price_is_overridden" BOOLEAN NOT NULL DEFAULT false,

  -- 'sellable' | 'below_floor' | 'unpriced' | 'unbuildable'
  -- Starts 'unpriced': a row that exists but has never been costed must not be
  -- sellable by default, or a failed first refresh would open it at zero.
  "status" TEXT NOT NULL DEFAULT 'unpriced',

  "last_error" TEXT NOT NULL DEFAULT '',

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tier_prices_pkey" PRIMARY KEY ("id")
);

-- One price per tier per cloud per region, enforced by the database rather than
-- by the job that writes it: the refresh upserts on this key, and a duplicate
-- would mean two different prices for the same machine in the same place.
CREATE UNIQUE INDEX "tier_prices_identity_key"
  ON "tier_prices" ("tier_id", "cloud", "region");

-- The customer's question, asked on every deploy screen: "which regions can I
-- have this tier in, on the cloud my model runs on, right now?"
CREATE INDEX "tier_prices_cloud_region_status_idx"
  ON "tier_prices" ("cloud", "region", "status");

-- The admin's question: "which cells of this tier are not sellable?"
CREATE INDEX "tier_prices_tier_id_status_idx"
  ON "tier_prices" ("tier_id", "status");

-- Cascade: a deleted tier's prices are meaningless. Unlike `tier_capacity_events`,
-- which is a historical record worth keeping, these rows are a live derived
-- view of what the tier costs today.
ALTER TABLE "tier_prices"
  ADD CONSTRAINT "tier_prices_tier_id_fkey"
  FOREIGN KEY ("tier_id") REFERENCES "tiers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "cloud_region_costs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),

  "cloud"  TEXT NOT NULL,
  "region" TEXT NOT NULL,

  -- NAT gateways and their addresses: what having this region open costs
  -- before a single customer machine runs in it.
  "fixed_cost_per_hour" DECIMAL(12,6) NOT NULL DEFAULT 0,

  "cost_source" TEXT NOT NULL DEFAULT 'unknown',
  "cost_as_of"  TIMESTAMP(3),

  -- How many machines to spread the standing cost across. A judgement, not a
  -- measurement. 1 is the only value that cannot lose money.
  "assumed_machines" INTEGER NOT NULL DEFAULT 1,

  -- What is actually running here. Reporting only — a price that moved with
  -- live occupancy would charge two customers differently for the same hour.
  "live_machines" INTEGER NOT NULL DEFAULT 0,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cloud_region_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cloud_region_costs_identity_key"
  ON "cloud_region_costs" ("cloud", "region");
