-- Whether a region's network has been built, kept apart from what it costs.
--
-- The platform costs and sells a region before it builds one, on purpose: that
-- is what puts the region's standing cost (on AWS, its NAT gateways) into every
-- price from the first day, so the customer who happens to be first in a region
-- is not being subsidised by nobody. What is genuinely absent on that first day
-- is the VPC, not the price — hence a build state that is separate from
-- `cost_source`.
--
-- Every column is added with a default, so existing rows keep working and the
-- code that does not read these columns yet is unaffected.

ALTER TABLE "cloud_region_costs"
  -- 'unbuilt' | 'wanted' | 'building' | 'built' | 'failed'
  --
  -- 'unbuilt' is the correct starting value even for a region that IS built:
  -- the truth lives in awsSettings.regions (the ids), and the reconciler
  -- promotes a region to 'built' the first time it finds them. Defaulting to
  -- 'built' would claim a network exists on the strength of a migration having
  -- run, which is how an order gets routed at a VPC that was never applied.
  ADD COLUMN IF NOT EXISTS "build_state" TEXT NOT NULL DEFAULT 'unbuilt',

  -- How many orders are waiting on this region. The admin's work list is
  -- ordered by it: a region with orders on it is urgent, one with none is a plan.
  ADD COLUMN IF NOT EXISTS "waiting_deployments" INTEGER NOT NULL DEFAULT 0,

  -- Three timestamps rather than one. An apply that was asked for and never
  -- started is a different problem from one that started and died, and with a
  -- single column the two are indistinguishable — which is exactly the case
  -- where a customer waits on a build nobody is running.
  ADD COLUMN IF NOT EXISTS "build_wanted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "build_started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "build_finished_at" TIMESTAMP(3),

  -- For the admin only. It names our own infrastructure, so nothing
  -- customer-facing reads it.
  ADD COLUMN IF NOT EXISTS "build_error" TEXT NOT NULL DEFAULT '';

-- The admin's "what needs building" list, and the reconciler's own lookup.
-- Partial, because the rows that matter are the few not yet built — on a table
-- with one row per (cloud, region) that keeps the index to the working set.
CREATE INDEX IF NOT EXISTS "cloud_region_costs_build_state_idx"
  ON "cloud_region_costs" ("build_state", "waiting_deployments" DESC)
  WHERE "build_state" <> 'built';
