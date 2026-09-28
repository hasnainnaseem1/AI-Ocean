-- A deployment can now run on a machine the customer assembled themselves.
-- `tier_id` is null for those, but it is also null when a catalogue tier was
-- deleted (onDelete: SetNull), so the flag is what tells the two apart.
-- `tier_custom_build` keeps the parts list the admin provisions from.
ALTER TABLE "deployments" ADD COLUMN "tier_is_custom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deployments" ADD COLUMN "tier_custom_build" JSONB;
