-- Mongo enforced "exactly one active RecommendationPolicy" in a pre('save')
-- hook. Prisma's schema DSL can't express a partial unique index directly
-- (a plain @@unique([isActive]) would wrongly also forbid more than one
-- *inactive* row, which is a normal, expected state), so this is added by
-- hand instead, exactly as flagged in schema.prisma's comment on the model.
CREATE UNIQUE INDEX "recommendation_policies_single_active_idx"
  ON "recommendation_policies" ("is_active")
  WHERE "is_active" = true;
