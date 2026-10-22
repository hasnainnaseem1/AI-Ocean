-- The part of a region's cost that scales with machines, kept apart from the
-- part that does not.
--
-- The two clouds put their NAT charge in different places, and the difference
-- is not cosmetic:
--
--   AWS    a NAT gateway is billed per availability zone whether zero machines
--          use it or a hundred. Pure fixed cost.
--   Google Cloud NAT is billed per VM attached to it (capped past 32 VMs).
--          Almost entirely a per-machine cost.
--
-- Folding Google's per-VM charge into `fixed_cost_per_hour` would make the
-- figure correct only at the exact moment `live_machines` equalled
-- `assumed_machines`, and wrong the rest of the time — under-recovering when
-- the region is fuller than assumed, which is the direction that loses money.
ALTER TABLE "cloud_region_costs"
  ADD COLUMN "per_machine_cost_per_hour" DECIMAL(12,6) NOT NULL DEFAULT 0;
