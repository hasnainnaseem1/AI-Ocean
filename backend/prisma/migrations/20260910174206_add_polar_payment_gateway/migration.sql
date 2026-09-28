-- Add Polar as a third payment gateway.
--
-- Purely additive: new enum values and new nullable columns. No data loss,
-- no backfill, existing stripe/lemonsqueezy/none rows are untouched.

ALTER TYPE "PaymentGateway" ADD VALUE 'polar';
ALTER TYPE "PaymentMethodGateway" ADD VALUE 'polar';

ALTER TABLE "admin_settings" ADD COLUMN "polar_settings" JSONB;
ALTER TABLE "users" ADD COLUMN "polar_customer_id" TEXT;
