-- Two more settings sections: AWS, and the cloud-routing tie-breaker.
--
-- Nullable with no default, like every other settings section. The defaults in
-- `adminSettingsDefaults.js` are merged on read, so a platform that never opens
-- these screens behaves exactly as it did before the columns existed:
-- `awsSettings.enabled` reads false, and `cloudRoutingSettings.defaultCloud`
-- reads empty, which the router treats as "no default set".
--
-- Separate columns rather than one `cloud_settings` blob holding both, matching
-- how `gcp_settings` already sits on its own: the section registry in
-- adminSettingsService merges per section, and a shared column would make two
-- unrelated screens write over each other's fields.
ALTER TABLE "admin_settings"
  ADD COLUMN "aws_settings" JSONB,
  ADD COLUMN "cloud_routing_settings" JSONB;
