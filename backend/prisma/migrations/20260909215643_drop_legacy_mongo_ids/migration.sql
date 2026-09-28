-- Drop the Mongo-shaped public id.
--
-- Every table carried `legacy_mongo_id`, a 24-hex string minted during the
-- MongoDB -> PostgreSQL migration so the frontends could keep treating it as
-- "the id" while the move happened. The API now returns the row's real UUID
-- primary key as `id`, every route resolves that, and all three frontends
-- read it — so the column has no readers left.
--
-- Its unique indexes go with it. Nothing referenced these columns by foreign
-- key: they were an application-level convention, never a relational one.
--
-- Historical `activity_logs.target_id` and `credit_transactions.reference_id`
-- still hold 24-hex strings. Those are polymorphic labels with no foreign key
-- and nothing in the codebase resolves them back to a row, so they are left
-- as they are rather than rewritten.

ALTER TABLE "activity_logs" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "ai_models" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "blog_posts" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "credit_transactions" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "credit_wallets" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "cron_jobs" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "custom_roles" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "customer_notes" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "departments" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "deployment_billing_method_history" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "deployment_journey_steps" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "deployment_journeys" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "deployment_usages" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "marketing_page_blocks" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "marketing_pages" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "payment_methods" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "question_templates" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "recommendation_policies" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "resource_components" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "seo_redirects" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "tier_categories" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "tiers" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "use_case_tags" DROP COLUMN IF EXISTS "legacy_mongo_id";
ALTER TABLE "users" DROP COLUMN IF EXISTS "legacy_mongo_id";
