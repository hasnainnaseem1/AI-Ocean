-- The one number that prices a tier everywhere.
--
-- With a price per (cloud x region), an operator cannot be asked to type six
-- figures per tier. They set what the tier should earn over its cost, and the
-- hourly refresh works out the rest: what the machine costs on each cloud in
-- each region, plus that region's own standing cost, plus overhead and tax,
-- and then this margin on top.
--
-- NULL on purpose, rather than defaulting to a number. Null means "use the
-- platform default", so changing the business-wide target margin reaches every
-- tier that has not deliberately been given its own. A default of 0 here would
-- have silently pinned every existing tier to no margin at all.
ALTER TABLE "tiers"
  ADD COLUMN "target_margin_percent" DECIMAL(7,4);
