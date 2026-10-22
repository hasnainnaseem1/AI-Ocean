-- What a model needs to run at all.
--
-- A model declared one number, `min_vram_gb`. Everything else a machine had to
-- provide — cards, cores, memory — was inferred from what the customer said
-- about their workload. That is right for "how busy will it be" and useless
-- for "will it start": a model needing two cards does not need them because of
-- anyone's traffic, it needs them because the weights do not fit on one.
--
-- Default 0, meaning "not stated", on purpose. A model nobody has filled in
-- must not suddenly start refusing the machines that have been running it.
ALTER TABLE "ai_models"
  ADD COLUMN "min_gpu_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "min_vcpu" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "min_ram_gb" DOUBLE PRECISION NOT NULL DEFAULT 0;
