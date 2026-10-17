-- Automatic provisioning is the default; an admin switches it off per account.
--
-- This replaces the opt-in allowlist that used to live in
-- `admin_settings.gcp_settings.allowedTeamIds`. The allowlist made the normal
-- case the one that needed work: every new customer landed on the manual queue
-- and stayed there until somebody remembered to add them. The product rule is
-- the other way round — everybody is automatic, and an admin takes it away from
-- one account when they want to see that account's requests first.
--
-- `DEFAULT true` is what makes this a no-op on deploy: every existing account
-- gets automatic provisioning the moment it is switched on platform-wide, which
-- is exactly the intended behaviour. Adding a column with a constant default is
-- metadata-only on PostgreSQL 11+, so this does not rewrite the table.
--
-- On Team rather than User: deployments, wallets and cards are all
-- account-scoped, and a personal account is a Team of kind 'personal'. One
-- column therefore covers both individuals and organizations — unlike
-- `payg_access`, whose admin route checks `kind = 'team'` and so silently
-- cannot be applied to a personal account.
ALTER TABLE "teams"
  ADD COLUMN "auto_deploy" BOOLEAN NOT NULL DEFAULT true,
  -- Shown to the admin who looks at the account later, and in the activity
  -- log. Not shown to the customer: "your account needs review" is a support
  -- conversation, not a status message.
  ADD COLUMN "auto_deploy_off_reason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "auto_deploy_changed_at" TIMESTAMP(3);

-- The provisioner reads this per deployment, and the admin list filters on it
-- to answer "which accounts are on manual review". Partial, because `false` is
-- the rare case and a full index on a mostly-true boolean earns nothing.
CREATE INDEX "teams_auto_deploy_off_idx" ON "teams" ("auto_deploy") WHERE "auto_deploy" = false;
