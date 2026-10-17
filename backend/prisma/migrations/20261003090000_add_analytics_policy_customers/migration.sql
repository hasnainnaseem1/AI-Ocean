-- The `customers` section of the analytics policy.
--
-- It shipped with ANLX-CUSTOMERS and was read from the defaults — activation
-- stages, org-size bands, the minimum sample a percentage is allowed to rest
-- on, which TeamActivity actions count as joining or leaving — but no column
-- was added to store an override. So those were operator-facing decisions
-- that an operator could not actually make, which is precisely what this
-- table exists to prevent.
--
-- Nullable like every other section: an unset column inherits the whole
-- default subtree, so adding this changes nothing for an existing policy.
ALTER TABLE "analytics_policies"
    ADD COLUMN IF NOT EXISTS "customers" JSONB;
