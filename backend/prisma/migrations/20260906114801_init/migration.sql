-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('customer', 'admin');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('customer', 'super_admin', 'admin', 'moderator', 'viewer', 'custom');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending_verification', 'active', 'suspended', 'banned', 'inactive');

-- CreateEnum
CREATE TYPE "ComponentKind" AS ENUM ('gpu', 'cpu', 'memory', 'storage', 'network', 'other');

-- CreateEnum
CREATE TYPE "PricingPeriod" AS ENUM ('hour', 'month');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('components', 'flat');

-- CreateEnum
CREATE TYPE "TierStatus" AS ENUM ('available', 'limited', 'out_of_stock');

-- CreateEnum
CREATE TYPE "ModelFamily" AS ENUM ('kimi', 'deepseek', 'llama', 'qwen', 'mistral', 'gemma', 'phi', 'falcon', 'custom');

-- CreateEnum
CREATE TYPE "Modality" AS ENUM ('chat', 'completion', 'vision', 'image_generation', 'embedding', 'audio', 'code');

-- CreateEnum
CREATE TYPE "ModelUseCaseFit" AS ENUM ('excellent', 'good', 'possible');

-- CreateEnum
CREATE TYPE "AIModelStatus" AS ENUM ('available', 'beta', 'coming_soon', 'deprecated');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('topup', 'charge', 'refund', 'adjustment', 'bonus', 'signup_credit', 'debt_accrual', 'debt_settlement', 'debt_writeoff', 'dispute');

-- CreateEnum
CREATE TYPE "CreditTransactionSource" AS ENUM ('stripe', 'lemonsqueezy', 'admin', 'system');

-- CreateEnum
CREATE TYPE "PaymentMethodGateway" AS ENUM ('stripe');

-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('active', 'expired', 'requires_action', 'removed');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('topup', 'one_time');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('succeeded', 'pending', 'failed', 'refunded', 'cancelled');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('pending_review', 'approved', 'rejected', 'provisioning', 'running', 'paused', 'stopped', 'failed', 'terminated');

-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('prepaid', 'payg');

-- CreateEnum
CREATE TYPE "DeploymentUsageKind" AS ENUM ('compute', 'storage');

-- CreateEnum
CREATE TYPE "NotificationRecipientType" AS ENUM ('customer', 'admin', 'all');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "ActivityLogActionType" AS ENUM ('create', 'read', 'update', 'delete', 'auth', 'export', 'system');

-- CreateEnum
CREATE TYPE "ActivityLogStatus" AS ENUM ('success', 'failed', 'warning', 'error');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('stripe', 'lemonsqueezy', 'none');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "CronActionType" AS ENUM ('http', 'log', 'email', 'cleanup', 'notification', 'backup');

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'POST', 'PUT', 'DELETE');

-- CreateEnum
CREATE TYPE "CronCleanupTarget" AS ENUM ('activityLogs', 'notifications', 'unverifiedUsers', 'expiredSessions', 'failedJobs');

-- CreateEnum
CREATE TYPE "CronLastStatus" AS ENUM ('success', 'error');

-- CreateEnum
CREATE TYPE "JourneyMode" AS ENUM ('model_first', 'requirements_first');

-- CreateEnum
CREATE TYPE "JourneyStepType" AS ENUM ('intro', 'question', 'question_group', 'model_match', 'recommendation', 'name', 'review', 'custom');

-- CreateEnum
CREATE TYPE "MarketingBlockType" AS ENUM ('hero', 'features', 'pricing', 'cta', 'faq', 'text', 'contact', 'stats', 'testimonials', 'custom', 'steps', 'split', 'code_sample', 'logos', 'comparison', 'product_showcase', 'model_catalog', 'gpu_pricing', 'use_cases', 'machine_cards');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('select', 'multiselect', 'text', 'textarea', 'number', 'radio', 'boolean');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL DEFAULT 'customer',
    "role" "Role" NOT NULL DEFAULT 'customer',
    "custom_role_id" UUID,
    "status" "UserStatus" NOT NULL DEFAULT 'pending_verification',
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verification_token" TEXT,
    "email_verification_expires" TIMESTAMP(3),
    "stripe_customer_id" TEXT,
    "lemon_squeezy_customer_id" TEXT,
    "dispute_hold" BOOLEAN NOT NULL DEFAULT false,
    "dispute_reason" TEXT NOT NULL DEFAULT '',
    "disputed_at" TIMESTAMP(3),
    "department" TEXT,
    "permissions" JSONB,
    "assigned_by_id" UUID,
    "avatar" TEXT,
    "google_id" TEXT,
    "last_login" TIMESTAMP(3),
    "last_login_ip" TEXT,
    "login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),
    "reset_password_requested_by_id" UUID,
    "reset_password_requested_at" TIMESTAMP(3),
    "password_change_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "use_case_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "use_case_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tier_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tier_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "kind" "ComponentKind" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "unit_label" TEXT NOT NULL DEFAULT 'unit',
    "price_per_unit" DECIMAL(12,6) NOT NULL,
    "pricing_period" "PricingPeriod" NOT NULL DEFAULT 'hour',
    "price_per_unit_per_hour" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "hours_per_month" INTEGER NOT NULL DEFAULT 730,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billed_while_stopped" BOOLEAN NOT NULL DEFAULT false,
    "min_quantity" INTEGER NOT NULL DEFAULT 1,
    "max_quantity" INTEGER NOT NULL DEFAULT 0,
    "step_quantity" INTEGER NOT NULL DEFAULT 1,
    "specs" JSONB,
    "available_for_custom_builds" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "category_id" UUID,
    "pricing_mode" "PricingMode" NOT NULL DEFAULT 'flat',
    "pricing_flat_price_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "pricing_flat_stopped_price_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "pricing_markup_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "pricing_component_subtotal_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "pricing_component_stopped_subtotal_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "price_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "stopped_price_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "gpu_model" TEXT NOT NULL DEFAULT '',
    "gpu_count" INTEGER NOT NULL DEFAULT 0,
    "vram_gb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vcpu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ram_gb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storage_gb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "storage_type" TEXT NOT NULL DEFAULT '',
    "network_gbps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "regions" TEXT[] DEFAULT ARRAY['default']::TEXT[],
    "capacity_total" INTEGER NOT NULL DEFAULT 0,
    "capacity_allocated" INTEGER NOT NULL DEFAULT 0,
    "status" "TierStatus" NOT NULL DEFAULT 'available',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tier_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tier_id" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "component_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "name" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL DEFAULT '',
    "unit_label" TEXT NOT NULL DEFAULT 'unit',
    "quantity" DECIMAL(12,4) NOT NULL,
    "unit_price_per_hour" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "billed_while_stopped" BOOLEAN NOT NULL DEFAULT false,
    "line_total_per_hour" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "specs" JSONB,

    CONSTRAINT "tier_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "family" "ModelFamily" NOT NULL DEFAULT 'custom',
    "version" TEXT NOT NULL DEFAULT '',
    "short_description" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "logo_url" TEXT NOT NULL DEFAULT '',
    "docs_url" TEXT NOT NULL DEFAULT '',
    "hugging_face_id" TEXT NOT NULL DEFAULT '',
    "license" TEXT NOT NULL DEFAULT '',
    "modalities" "Modality"[] DEFAULT ARRAY['chat']::"Modality"[],
    "parameter_size" TEXT NOT NULL DEFAULT '',
    "context_length" INTEGER NOT NULL DEFAULT 0,
    "min_vram_gb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "limitations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AIModelStatus" NOT NULL DEFAULT 'available',
    "category" TEXT NOT NULL DEFAULT 'General',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_supported_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ai_model_id" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "tier_id" UUID NOT NULL,
    "tier_name" TEXT NOT NULL DEFAULT '',
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "price_multiplier" DECIMAL(6,4) NOT NULL DEFAULT 1,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ai_model_supported_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_use_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ai_model_id" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "fit" "ModelUseCaseFit" NOT NULL DEFAULT 'good',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ai_model_use_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "balance" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "outstanding_balance" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "debt_since" TIMESTAMP(3),
    "debt_notified_at" TIMESTAMP(3),
    "last_auto_charge_at" TIMESTAMP(3),
    "auto_charge_failures" INTEGER NOT NULL DEFAULT 0,
    "last_auto_charge_error" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lifetime_top_up" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "lifetime_spend" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "auto_top_up_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_top_up_threshold" DECIMAL(12,4) NOT NULL DEFAULT 10,
    "auto_top_up_amount" DECIMAL(12,4) NOT NULL DEFAULT 50,
    "low_balance_notified_at" TIMESTAMP(3),
    "suspended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "balance_after" DECIMAL(12,4) NOT NULL,
    "debt_delta" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "outstanding_after" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" "CreditTransactionSource" NOT NULL DEFAULT 'system',
    "reference_id" TEXT,
    "reference_model" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "gateway" "PaymentMethodGateway" NOT NULL DEFAULT 'stripe',
    "provider_customer_id" TEXT NOT NULL,
    "provider_payment_method_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "last4" TEXT NOT NULL DEFAULT '',
    "exp_month" INTEGER,
    "exp_year" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "PaymentMethodStatus" NOT NULL DEFAULT 'active',
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "last_failure_code" TEXT NOT NULL DEFAULT '',
    "last_failure_message" TEXT NOT NULL DEFAULT '',
    "last_failure_at" TIMESTAMP(3),
    "last_expiry_warning_days" INTEGER,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "stripe_invoice_id" TEXT,
    "type" "PaymentType" NOT NULL DEFAULT 'topup',
    "credits_added" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "receipt_url" TEXT,
    "invoice_url" TEXT,
    "metadata" JSONB,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "recipient_id" UUID NOT NULL,
    "recipient_type" "NotificationRecipientType" NOT NULL DEFAULT 'customer',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionLabel" TEXT,
    "actionUrl" TEXT,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'medium',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "sender_id" UUID,
    "sender_name" TEXT NOT NULL DEFAULT 'System',
    "metadata" JSONB,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "deployment_name" TEXT NOT NULL,
    "model_id" UUID,
    "model_name" TEXT NOT NULL DEFAULT '',
    "model_slug" TEXT NOT NULL DEFAULT '',
    "model_family" TEXT NOT NULL DEFAULT '',
    "model_version" TEXT NOT NULL DEFAULT '',
    "model_parameter_size" TEXT NOT NULL DEFAULT '',
    "model_context_length" INTEGER NOT NULL DEFAULT 0,
    "tier_id" UUID,
    "tier_name" TEXT NOT NULL DEFAULT '',
    "tier_category_name" TEXT NOT NULL DEFAULT '',
    "tier_gpu_model" TEXT NOT NULL DEFAULT '',
    "tier_gpu_count" INTEGER NOT NULL DEFAULT 0,
    "tier_vram_gb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier_vcpu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier_ram_gb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier_storage_gb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier_storage_type" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT 'default',
    "price_per_hour" DECIMAL(12,4) NOT NULL,
    "stopped_price_per_hour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "plan_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billing_method" "BillingMethod" NOT NULL DEFAULT 'prepaid',
    "sizing_journey_key" TEXT NOT NULL DEFAULT '',
    "sizing_recommended_tier_id" UUID,
    "sizing_recommended_tier_name" TEXT NOT NULL DEFAULT '',
    "sizing_followed_recommendation" BOOLEAN,
    "sizing_requirement_profile" JSONB,
    "sizing_reasons" JSONB,
    "sizing_suitability_verdict" TEXT NOT NULL DEFAULT '',
    "sizing_confidence" TEXT NOT NULL DEFAULT '',
    "sizing_computed_at" TIMESTAMP(3),
    "status" "DeploymentStatus" NOT NULL DEFAULT 'pending_review',
    "endpoint_url" TEXT NOT NULL DEFAULT '',
    "endpoint_api_key_encrypted" TEXT NOT NULL DEFAULT '',
    "endpoint_api_key_masked" TEXT NOT NULL DEFAULT '',
    "endpoint_docs_url" TEXT NOT NULL DEFAULT '',
    "endpoint_extra" JSONB,
    "endpoint_active" BOOLEAN NOT NULL DEFAULT true,
    "endpoint_key_version" INTEGER NOT NULL DEFAULT 1,
    "endpoint_suspended_at" TIMESTAMP(3),
    "endpoint_suspend_reason" TEXT NOT NULL DEFAULT '',
    "endpoint_suspended_for_enforcement" BOOLEAN NOT NULL DEFAULT false,
    "endpoint_revoked_at" TIMESTAMP(3),
    "endpoint_revoke_reason" TEXT NOT NULL DEFAULT '',
    "endpoint_shutdown_required" BOOLEAN NOT NULL DEFAULT false,
    "endpoint_shutdown_requested_at" TIMESTAMP(3),
    "endpoint_shutdown_completed_at" TIMESTAMP(3),
    "endpoint_shutdown_completed_by_id" UUID,
    "admin_notes" TEXT NOT NULL DEFAULT '',
    "rejection_reason" TEXT NOT NULL DEFAULT '',
    "assigned_to_id" UUID,
    "provisioned_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "last_billed_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "terminated_at" TIMESTAMP(3),
    "total_runtime_hours" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "auto_suspended_for_credit" BOOLEAN NOT NULL DEFAULT false,
    "has_unpaid_storage" BOOLEAN NOT NULL DEFAULT false,
    "storage_debt_notified_at" TIMESTAMP(3),
    "payg_offered_at" TIMESTAMP(3),
    "card_gate_suspended" BOOLEAN NOT NULL DEFAULT false,
    "storage_grace_warned_at" TIMESTAMP(3),
    "stale_provisioning_notified_at" TIMESTAMP(3),
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "DeploymentStatus" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_id" UUID,
    "by_name" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "deployment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_billing_method_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "deployment_id" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "method" "BillingMethod" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_name" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "deployment_billing_method_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "question_key" TEXT NOT NULL,
    "question" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'text',
    "answer" JSONB,

    CONSTRAINT "deployment_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_usages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "deployment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "kind" "DeploymentUsageKind" NOT NULL DEFAULT 'compute',
    "status" TEXT NOT NULL DEFAULT '',
    "hours" DECIMAL(10,4) NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "to_wallet" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "to_debt" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "transaction_id" UUID,
    "debt_transaction_id" UUID,
    "charged" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "user_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "action_type" "ActivityLogActionType" NOT NULL,
    "target_model" TEXT,
    "target_id" TEXT,
    "target_name" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "status" "ActivityLogStatus" NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "is_singleton" BOOLEAN NOT NULL DEFAULT true,
    "theme_settings" JSONB,
    "site_name" TEXT NOT NULL DEFAULT 'My Platform',
    "site_description" TEXT NOT NULL DEFAULT 'AI-powered platform',
    "support_email" TEXT NOT NULL DEFAULT 'support@example.com',
    "contact_email" TEXT NOT NULL DEFAULT 'contact@example.com',
    "email_settings" JSONB,
    "email_templates" JSONB,
    "customer_settings" JSONB,
    "security_settings" JSONB,
    "analytics_settings" JSONB,
    "notification_settings" JSONB,
    "stripe_settings" JSONB,
    "lemon_squeezy_settings" JSONB,
    "active_payment_gateway" "PaymentGateway" NOT NULL DEFAULT 'stripe',
    "maintenance_mode" JSONB,
    "seo_settings" JSONB,
    "billing_settings" JSONB,
    "deployment_settings" JSONB,
    "features" JSONB,
    "google_sso_settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "featured_image" TEXT NOT NULL DEFAULT '',
    "author_id" UUID,
    "author_name" TEXT NOT NULL DEFAULT 'Admin',
    "category" TEXT NOT NULL DEFAULT 'General',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "seo_title" TEXT NOT NULL DEFAULT '',
    "seo_description" TEXT NOT NULL DEFAULT '',
    "og_image" TEXT NOT NULL DEFAULT '',
    "canonical_url" TEXT NOT NULL DEFAULT '',
    "no_index" BOOLEAN NOT NULL DEFAULT false,
    "read_time" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "schedule" TEXT NOT NULL,
    "schedule_label" TEXT NOT NULL DEFAULT '',
    "action_type" "CronActionType" NOT NULL DEFAULT 'log',
    "http_config_url" TEXT NOT NULL DEFAULT '',
    "http_config_method" "HttpMethod" NOT NULL DEFAULT 'GET',
    "http_config_headers" JSONB,
    "http_config_body" TEXT NOT NULL DEFAULT '',
    "log_message" TEXT NOT NULL DEFAULT 'Custom cron job executed',
    "email_config_to" TEXT NOT NULL DEFAULT '',
    "email_config_subject" TEXT NOT NULL DEFAULT '',
    "email_config_body" TEXT NOT NULL DEFAULT '',
    "cleanup_config_target" "CronCleanupTarget" NOT NULL DEFAULT 'activityLogs',
    "cleanup_config_older_than_days" INTEGER NOT NULL DEFAULT 30,
    "notification_config_title" TEXT NOT NULL DEFAULT '',
    "notification_config_message" TEXT NOT NULL DEFAULT '',
    "notification_config_type" TEXT NOT NULL DEFAULT 'system_alert',
    "backup_config_collections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "backup_config_output_dir" TEXT NOT NULL DEFAULT 'backups',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run" TIMESTAMP(3),
    "last_status" "CronLastStatus",
    "last_error" TEXT,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "customer_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_journeys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "mode" "JourneyMode" NOT NULL DEFAULT 'model_first',
    "settings_auto_advance" BOOLEAN NOT NULL DEFAULT true,
    "settings_auto_advance_delay_ms" INTEGER NOT NULL DEFAULT 350,
    "settings_show_live_sizing" BOOLEAN NOT NULL DEFAULT true,
    "settings_show_progress_bar" BOOLEAN NOT NULL DEFAULT true,
    "settings_allow_back" BOOLEAN NOT NULL DEFAULT true,
    "settings_show_estimated_cost" BOOLEAN NOT NULL DEFAULT true,
    "settings_allow_manual_tier_override" BOOLEAN NOT NULL DEFAULT true,
    "settings_model_match_limit" INTEGER NOT NULL DEFAULT 5,
    "settings_require_all_required" BOOLEAN NOT NULL DEFAULT true,
    "settings_completion_message" TEXT NOT NULL DEFAULT '',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_journey_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "journey_id" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "type" "JourneyStepType" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "cta_label" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "question_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "depends_on_question_key" TEXT NOT NULL DEFAULT '',
    "depends_on_equals" JSONB,
    "settings" JSONB,
    "skippable" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "deployment_journey_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "meta_title" TEXT NOT NULL DEFAULT '',
    "meta_description" TEXT NOT NULL DEFAULT '',
    "meta_keywords" TEXT NOT NULL DEFAULT '',
    "og_image" TEXT NOT NULL DEFAULT '',
    "canonical_url" TEXT NOT NULL DEFAULT '',
    "no_index" BOOLEAN NOT NULL DEFAULT false,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "is_home_page" BOOLEAN NOT NULL DEFAULT false,
    "show_in_navigation" BOOLEAN NOT NULL DEFAULT true,
    "navigation_order" INTEGER NOT NULL DEFAULT 0,
    "navigation_label" TEXT NOT NULL DEFAULT '',
    "custom_css" TEXT NOT NULL DEFAULT '',
    "last_edited_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_page_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "page_id" UUID NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "type" "MarketingBlockType" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "button_text" TEXT NOT NULL DEFAULT '',
    "button_link" TEXT NOT NULL DEFAULT '',
    "secondary_button_text" TEXT NOT NULL DEFAULT '',
    "secondary_button_link" TEXT NOT NULL DEFAULT '',
    "background_image" TEXT NOT NULL DEFAULT '',
    "background_color" TEXT NOT NULL DEFAULT '',
    "text_color" TEXT NOT NULL DEFAULT '',
    "items" JSONB,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,

    CONSTRAINT "marketing_page_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "key" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "help_text" TEXT NOT NULL DEFAULT '',
    "placeholder" TEXT NOT NULL DEFAULT '',
    "type" "QuestionType" NOT NULL DEFAULT 'select',
    "options" JSONB,
    "signal_rules" JSONB,
    "affects_sizing" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "default_value" JSONB,
    "applies_to_all_models" BOOLEAN NOT NULL DEFAULT true,
    "applies_to_model_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applies_to_modalities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "depends_on_question_key" TEXT NOT NULL DEFAULT '',
    "depends_on_equals" JSONB,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "model_ranking" JSONB,
    "tier_scoring" JSONB,
    "suitability" JSONB,
    "fit_weights" JSONB,
    "uptime_ranks" JSONB,
    "confidence" JSONB,
    "modality_labels" JSONB,
    "reason_templates" JSONB,
    "suitability_templates" JSONB,
    "tier_issue_templates" JSONB,
    "match_reason_templates" JSONB,
    "alternative_templates" JSONB,
    "blocker_templates" JSONB,
    "match_reason_limits" JSONB,
    "cache_ttl_seconds" INTEGER,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_redirects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legacy_mongo_id" TEXT,
    "from_path" TEXT NOT NULL,
    "to_path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL DEFAULT 301,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "last_hit_at" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_legacy_mongo_id_key" ON "users"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_roles_legacy_mongo_id_key" ON "custom_roles"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_roles_name_key" ON "custom_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "use_case_tags_legacy_mongo_id_key" ON "use_case_tags"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "use_case_tags_key_key" ON "use_case_tags"("key");

-- CreateIndex
CREATE INDEX "use_case_tags_is_active_idx" ON "use_case_tags"("is_active");

-- CreateIndex
CREATE INDEX "use_case_tags_display_order_idx" ON "use_case_tags"("display_order");

-- CreateIndex
CREATE UNIQUE INDEX "tier_categories_legacy_mongo_id_key" ON "tier_categories"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "tier_categories_name_key" ON "tier_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tier_categories_slug_key" ON "tier_categories"("slug");

-- CreateIndex
CREATE INDEX "tier_categories_slug_idx" ON "tier_categories"("slug");

-- CreateIndex
CREATE INDEX "tier_categories_display_order_idx" ON "tier_categories"("display_order");

-- CreateIndex
CREATE UNIQUE INDEX "resource_components_legacy_mongo_id_key" ON "resource_components"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_components_name_key" ON "resource_components"("name");

-- CreateIndex
CREATE UNIQUE INDEX "resource_components_slug_key" ON "resource_components"("slug");

-- CreateIndex
CREATE INDEX "resource_components_slug_idx" ON "resource_components"("slug");

-- CreateIndex
CREATE INDEX "resource_components_kind_display_order_idx" ON "resource_components"("kind", "display_order");

-- CreateIndex
CREATE INDEX "resource_components_is_active_idx" ON "resource_components"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_legacy_mongo_id_key" ON "tiers"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_name_key" ON "tiers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_slug_key" ON "tiers"("slug");

-- CreateIndex
CREATE INDEX "tiers_slug_idx" ON "tiers"("slug");

-- CreateIndex
CREATE INDEX "tiers_is_active_idx" ON "tiers"("is_active");

-- CreateIndex
CREATE INDEX "tiers_display_order_idx" ON "tiers"("display_order");

-- CreateIndex
CREATE INDEX "tiers_category_id_idx" ON "tiers"("category_id");

-- CreateIndex
CREATE INDEX "tier_components_tier_id_order_idx" ON "tier_components"("tier_id", "order");

-- CreateIndex
CREATE INDEX "tier_components_component_id_idx" ON "tier_components"("component_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_legacy_mongo_id_key" ON "ai_models"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_name_key" ON "ai_models"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_slug_key" ON "ai_models"("slug");

-- CreateIndex
CREATE INDEX "ai_models_slug_idx" ON "ai_models"("slug");

-- CreateIndex
CREATE INDEX "ai_models_is_active_idx" ON "ai_models"("is_active");

-- CreateIndex
CREATE INDEX "ai_models_status_idx" ON "ai_models"("status");

-- CreateIndex
CREATE INDEX "ai_models_family_idx" ON "ai_models"("family");

-- CreateIndex
CREATE INDEX "ai_models_display_order_idx" ON "ai_models"("display_order");

-- CreateIndex
CREATE INDEX "ai_model_supported_tiers_ai_model_id_order_idx" ON "ai_model_supported_tiers"("ai_model_id", "order");

-- CreateIndex
CREATE INDEX "ai_model_supported_tiers_tier_id_idx" ON "ai_model_supported_tiers"("tier_id");

-- CreateIndex
CREATE INDEX "ai_model_use_cases_ai_model_id_order_idx" ON "ai_model_use_cases"("ai_model_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "credit_wallets_legacy_mongo_id_key" ON "credit_wallets"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_wallets_user_id_key" ON "credit_wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_legacy_mongo_id_key" ON "credit_transactions"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "credit_transactions_user_id_created_at_idx" ON "credit_transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "credit_transactions_wallet_id_idx" ON "credit_transactions"("wallet_id");

-- CreateIndex
CREATE INDEX "credit_transactions_type_created_at_idx" ON "credit_transactions"("type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "credit_transactions_reference_id_idx" ON "credit_transactions"("reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_legacy_mongo_id_key" ON "payment_methods"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "payment_methods_user_id_status_idx" ON "payment_methods"("user_id", "status");

-- CreateIndex
CREATE INDEX "payment_methods_fingerprint_idx" ON "payment_methods"("fingerprint");

-- CreateIndex
CREATE INDEX "payment_methods_status_idx" ON "payment_methods"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_provider_customer_id_provider_payment_metho_key" ON "payment_methods"("provider_customer_id", "provider_payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_legacy_mongo_id_key" ON "payments"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_invoice_id_key" ON "payments"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_legacy_mongo_id_key" ON "notifications"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_is_read_created_at_idx" ON "notifications"("recipient_id", "is_read", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_type_idx" ON "notifications"("recipient_id", "type");

-- CreateIndex
CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "deployments_legacy_mongo_id_key" ON "deployments"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "deployments_user_id_created_at_idx" ON "deployments"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deployments_status_created_at_idx" ON "deployments"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deployments_model_id_idx" ON "deployments"("model_id");

-- CreateIndex
CREATE INDEX "deployments_tier_id_idx" ON "deployments"("tier_id");

-- CreateIndex
CREATE UNIQUE INDEX "deployments_user_id_idempotency_key_key" ON "deployments"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "deployment_status_history_deployment_id_order_idx" ON "deployment_status_history"("deployment_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_billing_method_history_legacy_mongo_id_key" ON "deployment_billing_method_history"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "deployment_billing_method_history_deployment_id_order_idx" ON "deployment_billing_method_history"("deployment_id", "order");

-- CreateIndex
CREATE INDEX "deployment_requirements_deployment_id_order_idx" ON "deployment_requirements"("deployment_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_usages_legacy_mongo_id_key" ON "deployment_usages"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "deployment_usages_deployment_id_period_start_idx" ON "deployment_usages"("deployment_id", "period_start" DESC);

-- CreateIndex
CREATE INDEX "deployment_usages_user_id_created_at_idx" ON "deployment_usages"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "activity_logs_legacy_mongo_id_key" ON "activity_logs"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_created_at_idx" ON "activity_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_action_created_at_idx" ON "activity_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_action_type_created_at_idx" ON "activity_logs"("action_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_status_created_at_idx" ON "activity_logs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_target_model_target_id_idx" ON "activity_logs"("target_model", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_settings_legacy_mongo_id_key" ON "admin_settings"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_settings_is_singleton_key" ON "admin_settings"("is_singleton");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_legacy_mongo_id_key" ON "blog_posts"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_status_published_at_idx" ON "blog_posts"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "blog_posts_category_idx" ON "blog_posts"("category");

-- CreateIndex
CREATE INDEX "blog_posts_tags_idx" ON "blog_posts"("tags");

-- CreateIndex
CREATE INDEX "blog_posts_views_idx" ON "blog_posts"("views" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cron_jobs_legacy_mongo_id_key" ON "cron_jobs"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "cron_jobs_key_key" ON "cron_jobs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "customer_notes_legacy_mongo_id_key" ON "customer_notes"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "customer_notes_customer_id_created_at_idx" ON "customer_notes"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "departments_legacy_mongo_id_key" ON "departments"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_value_key" ON "departments"("value");

-- CreateIndex
CREATE INDEX "departments_value_idx" ON "departments"("value");

-- CreateIndex
CREATE INDEX "departments_is_active_idx" ON "departments"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_journeys_legacy_mongo_id_key" ON "deployment_journeys"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_journeys_key_key" ON "deployment_journeys"("key");

-- CreateIndex
CREATE INDEX "deployment_journeys_is_active_idx" ON "deployment_journeys"("is_active");

-- CreateIndex
CREATE INDEX "deployment_journeys_mode_is_default_idx" ON "deployment_journeys"("mode", "is_default");

-- CreateIndex
CREATE INDEX "deployment_journeys_display_order_idx" ON "deployment_journeys"("display_order");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_journey_steps_legacy_mongo_id_key" ON "deployment_journey_steps"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "deployment_journey_steps_journey_id_order_idx" ON "deployment_journey_steps"("journey_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_pages_legacy_mongo_id_key" ON "marketing_pages"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_pages_slug_key" ON "marketing_pages"("slug");

-- CreateIndex
CREATE INDEX "marketing_pages_slug_status_idx" ON "marketing_pages"("slug", "status");

-- CreateIndex
CREATE INDEX "marketing_pages_show_in_navigation_navigation_order_idx" ON "marketing_pages"("show_in_navigation", "navigation_order");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_page_blocks_legacy_mongo_id_key" ON "marketing_page_blocks"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "marketing_page_blocks_page_id_order_idx" ON "marketing_page_blocks"("page_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "question_templates_legacy_mongo_id_key" ON "question_templates"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_templates_key_key" ON "question_templates"("key");

-- CreateIndex
CREATE INDEX "question_templates_is_active_idx" ON "question_templates"("is_active");

-- CreateIndex
CREATE INDEX "question_templates_display_order_idx" ON "question_templates"("display_order");

-- CreateIndex
CREATE INDEX "question_templates_affects_sizing_idx" ON "question_templates"("affects_sizing");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_policies_legacy_mongo_id_key" ON "recommendation_policies"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_policies_key_key" ON "recommendation_policies"("key");

-- CreateIndex
CREATE UNIQUE INDEX "seo_redirects_legacy_mongo_id_key" ON "seo_redirects"("legacy_mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "seo_redirects_from_path_key" ON "seo_redirects"("from_path");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "custom_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_reset_password_requested_by_id_fkey" FOREIGN KEY ("reset_password_requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "use_case_tags" ADD CONSTRAINT "use_case_tags_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "use_case_tags" ADD CONSTRAINT "use_case_tags_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tier_categories" ADD CONSTRAINT "tier_categories_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tier_categories" ADD CONSTRAINT "tier_categories_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_components" ADD CONSTRAINT "resource_components_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_components" ADD CONSTRAINT "resource_components_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "tier_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tier_components" ADD CONSTRAINT "tier_components_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tier_components" ADD CONSTRAINT "tier_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "resource_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_supported_tiers" ADD CONSTRAINT "ai_model_supported_tiers_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_supported_tiers" ADD CONSTRAINT "ai_model_supported_tiers_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_use_cases" ADD CONSTRAINT "ai_model_use_cases_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_sizing_recommended_tier_id_fkey" FOREIGN KEY ("sizing_recommended_tier_id") REFERENCES "tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_endpoint_shutdown_completed_by_id_fkey" FOREIGN KEY ("endpoint_shutdown_completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_status_history" ADD CONSTRAINT "deployment_status_history_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_status_history" ADD CONSTRAINT "deployment_status_history_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_billing_method_history" ADD CONSTRAINT "deployment_billing_method_history_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_billing_method_history" ADD CONSTRAINT "deployment_billing_method_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_requirements" ADD CONSTRAINT "deployment_requirements_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_usages" ADD CONSTRAINT "deployment_usages_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_usages" ADD CONSTRAINT "deployment_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_usages" ADD CONSTRAINT "deployment_usages_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "credit_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_usages" ADD CONSTRAINT "deployment_usages_debt_transaction_id_fkey" FOREIGN KEY ("debt_transaction_id") REFERENCES "credit_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_journeys" ADD CONSTRAINT "deployment_journeys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_journeys" ADD CONSTRAINT "deployment_journeys_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_journey_steps" ADD CONSTRAINT "deployment_journey_steps_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "deployment_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_pages" ADD CONSTRAINT "marketing_pages_last_edited_by_id_fkey" FOREIGN KEY ("last_edited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_page_blocks" ADD CONSTRAINT "marketing_page_blocks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "marketing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_templates" ADD CONSTRAINT "question_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_templates" ADD CONSTRAINT "question_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_policies" ADD CONSTRAINT "recommendation_policies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_redirects" ADD CONSTRAINT "seo_redirects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
