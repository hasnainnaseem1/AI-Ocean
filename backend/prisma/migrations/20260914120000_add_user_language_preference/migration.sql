-- Remember which language each customer reads the product in.
--
-- Two columns, not one. "en" is both the default and a legitimate deliberate
-- choice, so without the flag there is no way to tell a customer who picked
-- English from one who was never asked — and the first-run language prompt
-- would nag the former forever.
--
-- `language` is TEXT rather than an enum on purpose: which languages are live
-- is an admin setting (AdminSettings.features.languages), so an enum would
-- force a migration every time an operator adds one, which is the exact thing
-- this feature exists to avoid.
--
-- Purely additive with defaults, so every existing row is already correct and
-- no backfill is needed. Nothing filters by language, so no index.
ALTER TABLE "users" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "users" ADD COLUMN "language_preference_set" BOOLEAN NOT NULL DEFAULT false;
