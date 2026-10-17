-- Automatic GCP provisioning: where a real machine is recorded, and when the
-- compute meter started.
--
-- Everything here is ADDITIVE and NULLABLE (or defaulted), so applying it
-- changes no existing behaviour: `compute_clock_started_at` is null on every
-- row that exists, which makes the new "is this billable" test identical to the
-- old one until a VM actually exists.
--
-- Note on what is deliberately NOT in this file: `prisma migrate diff` also
-- wants to drop and recreate `support_tickets_user_id_fkey` with a different
-- ON DELETE. That is pre-existing drift between the live database and
-- schema.prisma, it has nothing to do with provisioning, and changing a foreign
-- key's delete behaviour on the support domain is not something to smuggle into
-- an unrelated migration. It is left alone and reported separately.

-- ─────────────────────────────────────────────────────────────────────────────
-- The life of a real machine.
--
-- Deliberately a different vocabulary from DeploymentStatus: a deployment's
-- status is a promise to the customer, this is a fact about hardware, and the
-- two genuinely differ. A machine is `running` on GCP while the deployment is
-- still `provisioning`, because nothing is configured inside it yet — and that
-- gap is exactly the window the platform is paying Google for.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE "CloudInstancePhase" AS ENUM ('planned', 'creating', 'running', 'stopping', 'stopped', 'terminated', 'failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- Two columns on `deployments`.
--
-- Adding a column with a constant default is metadata-only on PostgreSQL 11+,
-- so neither of these rewrites the table however many deployments exist.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "deployments"
  -- When the compute meter started, because a real machine started. Billing has
  -- always meant `status = 'running'`; with automatic provisioning the meter has
  -- to follow the hardware instead, or the platform pays for a machine the
  -- customer is not yet being charged for.
  ADD COLUMN "compute_clock_started_at" TIMESTAMP(3),
  -- Network bandwidth sold. Part of the tier snapshot for the same reason every
  -- other spec is: re-pricing the catalogue must not move what was sold. It was
  -- missing entirely for catalogue tiers — it survived only inside
  -- `tier_custom_build` for custom builds.
  ADD COLUMN "tier_network_gbps" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- The machine behind a deployment.
--
-- A separate table rather than more columns on `deployments`, because that row
-- is already ~70 columns behind a hand-rolled ORM whose `save()` writes every
-- one of them from an in-memory snapshot. The reconciler writes here every
-- minute while a customer may be renaming or pausing the deployment in the same
-- second; on its own table those are narrow UPDATEs that cannot clobber each
-- other.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "deployment_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,

    -- `project_id` is stored per instance, not read from settings at use time:
    -- a machine created in one project must stay findable after an admin points
    -- the platform at another, and it keeps project-per-customer a
    -- configuration change later rather than a migration.
    "provider" TEXT NOT NULL DEFAULT 'gcp',
    "project_id" TEXT NOT NULL,
    "zone" TEXT NOT NULL,

    -- Derived from the deployment id, so GCP's own per-zone name uniqueness is
    -- what stops a double-fire creating two machines for one order.
    "instance_name" TEXT NOT NULL,
    -- GCP's numeric id. TEXT because it exceeds 2^53.
    "instance_id" TEXT,

    -- What was actually built. Differs from what was sold whenever GCP has no
    -- shape matching a tier exactly, and the admin screen shows both.
    "machine_type" TEXT NOT NULL,
    "accelerator_type" TEXT,
    "accelerator_count" INTEGER NOT NULL DEFAULT 0,
    "boot_disk_type" TEXT NOT NULL DEFAULT '',
    "boot_disk_size_gb" INTEGER NOT NULL DEFAULT 0,

    -- No external IP is the design; the column exists so a machine that somehow
    -- has one is visible rather than invisible.
    "internal_ip" TEXT,
    "external_ip" TEXT,

    "phase" "CloudInstancePhase" NOT NULL DEFAULT 'planned',

    -- `instances.insert` returns immediately with an operation that takes 30-90
    -- seconds. There is no queue on this platform, so a cron reconciler polls.
    -- Storing the operation name is also what makes a crash between "GCP
    -- accepted" and "we wrote it down" recoverable.
    "operation_name" TEXT,
    "operation_type" TEXT,
    "operation_at" TIMESTAMP(3),

    -- Retry bookkeeping in the "due and not yet done" shape used everywhere
    -- else in this codebase, so a run that comes late does the missed work.
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),

    "last_error_code" TEXT,
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),

    -- What the spec mapper decided and why. The mapper is pure and keeps
    -- nothing, so this is the only record of why a customer who bought 16 vCPU
    -- got 12.
    "spec_plan" JSONB,

    -- Written from GCP's own timestamps, never from our clock: the reconciler
    -- may notice a machine minutes after it started, and billing from when we
    -- noticed would charge the customer for our polling interval.
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "running_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_instances_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- A machine on GCP that this platform created and can no longer account for.
--
-- Recorded rather than destroyed. Deleting a machine because our own
-- bookkeeping lost track of it is precisely the operation that must not be
-- automatic: a bug in the sweep would then destroy live customer workloads.
-- The sweep raises it; an admin decides.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "orphan_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'gcp',
    "project_id" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "instance_name" TEXT NOT NULL,
    "instance_id" TEXT,
    "machine_type" TEXT NOT NULL DEFAULT '',
    "labels" JSONB,
    -- What GCP says it is doing, so an admin can tell a running machine from one
    -- that is already stopped and merely holding a disk.
    "cloud_status" TEXT NOT NULL DEFAULT '',
    -- Why the sweep thinks nobody owns it.
    "reason" TEXT NOT NULL DEFAULT '',
    -- Not a foreign key: the whole point is that the deployment row may be gone.
    "suspected_deployment_id" UUID,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolution" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "orphan_instances_pkey" PRIMARY KEY ("id")
);

-- One machine per deployment at a time. A destroyed machine leaves its row
-- behind as a tombstone (`phase = terminated`, `deleted_at` set) rather than
-- being deleted, because that is what lets the orphan sweep tell "ours and we
-- destroyed it" from "ours and nobody knows about it".
CREATE UNIQUE INDEX "deployment_instances_deployment_id_key" ON "deployment_instances"("deployment_id");

-- The reconciler's own query: everything with work still to do, by when it is due.
CREATE INDEX "deployment_instances_phase_next_attempt_at_idx" ON "deployment_instances"("phase", "next_attempt_at");

-- The orphan sweep goes the other way — from a name GCP reported back to us.
CREATE INDEX "deployment_instances_provider_location_idx" ON "deployment_instances"("provider", "project_id", "zone", "instance_name");

-- "Which machines are running right now", for the caps and the cost view.
CREATE INDEX "deployment_instances_phase_running_at_idx" ON "deployment_instances"("phase", "running_at");

CREATE INDEX "orphan_instances_resolved_at_idx" ON "orphan_instances"("resolved_at");

-- One row per real machine, so a sweep that runs twice updates rather than
-- duplicating.
CREATE UNIQUE INDEX "orphan_instances_identity_key" ON "orphan_instances"("provider", "project_id", "zone", "instance_name");

-- CASCADE: an instance record describes one deployment and is meaningless
-- without it. The machine itself is destroyed by the driver before a deployment
-- is ever deleted; this only cleans up the bookkeeping.
ALTER TABLE "deployment_instances" ADD CONSTRAINT "deployment_instances_deployment_id_fkey"
  FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL: deleting the admin who resolved an orphan must not make that admin
-- undeletable, and must not erase the record that it was resolved.
ALTER TABLE "orphan_instances" ADD CONSTRAINT "orphan_instances_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
