-- Which cloud a deployment runs on, and which cloud a model is assigned to.
--
-- Both nullable with no default, and that is the whole safety of this
-- migration: every existing row reads as "no cloud", which the router turns
-- into the manual fulfilment queue — exactly where those deployments were
-- already being fulfilled from. Applying this changes no behaviour at all.
--
-- ── Why the deployment carries its own copy ──
--
-- `ai_models.cloud_provider` is the assignment an admin can change at any time.
-- `deployments.cloud_provider` is a SNAPSHOT of what that assignment said at
-- the moment the deployment was created, and it is never recomputed.
--
-- That separation is not tidiness. Moving a model from AWS to Google is a
-- normal admin action. If `terminate` re-derived the cloud from the model, it
-- would send the destroy order to Google for a machine living in AWS; Google
-- would answer "no such instance", the platform would mark it gone, and the
-- AWS machine would keep running and keep billing with nothing on this
-- platform watching it. A leaked machine is the most expensive bug this
-- codebase can produce.
--
-- Text rather than an enum on purpose. Adding a third cloud should be a
-- settings change and a module, not a migration that locks the table — and an
-- unknown value read back is handled (`cloudRouter.cloudOf` treats anything it
-- does not recognise as manual) rather than throwing at the database layer.
ALTER TABLE "deployments"
  ADD COLUMN "cloud_provider" TEXT;

ALTER TABLE "ai_models"
  ADD COLUMN "cloud_provider" TEXT;

-- "Which deployments are on AWS right now" — asked by the per-cloud machine
-- counts and by the admin screens. Partial, because the overwhelming majority
-- of rows on a platform that has not switched over are NULL, and indexing
-- those earns nothing.
CREATE INDEX "deployments_cloud_provider_idx"
  ON "deployments" ("cloud_provider")
  WHERE "cloud_provider" IS NOT NULL;

-- "Which models are pinned, and to what" — the model list screen groups by
-- this, and it is a small table, but the index keeps that free.
CREATE INDEX "ai_models_cloud_provider_idx"
  ON "ai_models" ("cloud_provider")
  WHERE "cloud_provider" IS NOT NULL;
