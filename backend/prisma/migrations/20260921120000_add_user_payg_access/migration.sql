-- Pay-as-you-go used to be one platform-wide switch: on for every customer or
-- off for every customer. The operator needs to decide it per customer too —
-- let one trusted account keep a tab while PAYG is off for everyone else, or
-- take it away from one account while it stays on for the rest.
--
-- 'default' (every existing row) keeps today's behaviour exactly: follow the
-- platform switch. 'allowed' and 'blocked' override it for this one customer.
-- It only opens or closes the door; eligibility, the card gate, the debt
-- limits and dispute holds still apply to everyone (fundingService).
--
-- TEXT with a CHECK rather than an enum, matching how this schema stores
-- other small admin-set states, and so the three values are enforced by the
-- database even if a caller skips the route's validation.
ALTER TABLE "users" ADD COLUMN "payg_access" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "users" ADD CONSTRAINT "users_payg_access_check"
  CHECK ("payg_access" IN ('default', 'allowed', 'blocked'));
