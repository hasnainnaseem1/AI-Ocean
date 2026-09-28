-- When a saved card was last proven to still work by putting a small
-- authorisation through it and releasing it again. Additive and nullable:
-- every existing card reads as "never live-checked", which is exactly right.
ALTER TABLE "payment_methods" ADD COLUMN "last_live_check_at" TIMESTAMP(3);
