-- Teams, phase LIMITS.
--
-- A Developer's monthly spend limit (team_members.spend_limit_monthly, added in
-- FOUNDATION) is now enforced. These two columns remember which alert the
-- team's owner and admins have already been sent this month — 80% and 100%
-- of the limit, once each per month (UTC) — so the hourly billing run does not
-- repeat them.
ALTER TABLE "team_members" ADD COLUMN "limit_alert_level" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "team_members" ADD COLUMN "limit_alert_month" TEXT;
