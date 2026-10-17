-- Support ticket metrics: priority, timing, SLA targets, and a status history.
--
-- ── What was missing ──
--
-- A ticket recorded only its CURRENT status. There was no record of a status
-- ever having changed, so none of the questions a support queue is actually
-- judged on could be answered: how long until somebody replied, how long until
-- it was closed, how often work was reopened, how big the backlog was last
-- Tuesday.
--
-- `updated_at` looks like a stand-in for "resolved at" and is not one: it also
-- moves when a ticket is assigned or re-prioritised. Reading resolution time
-- from it gives a number that is right often enough to be believed and wrong
-- often enough to mislead.
--
-- ── What is back-filled, and how honestly ──
--
--   first_response_at   EXACT. The first admin message on the thread. The
--                       messages were always there with their own timestamps;
--                       nothing is guessed.
--   resolved_at         ESTIMATED, from `updated_at`, for solved tickets only,
--                       and every such row is flagged `resolved_at_estimated`.
--                       Charts surface the flag rather than averaging it in
--                       silently.
--   reopened_count      NOT back-filled, left at 0. It genuinely cannot be
--                       derived: a customer message that reopened a SOLVED
--                       ticket is indistinguishable from one that followed a
--                       PENDING reply, because the old schema stored neither
--                       the transition nor which kind of reply an admin sent.
--                       Zero here means "unknown", so the status history rows
--                       this migration invents are marked `backfilled` and the
--                       analytics report reopens only from the first real row
--                       onwards -- and say so on screen.
--
-- Priority defaults to 'normal' for every existing ticket, which is what they
-- were implicitly graded as. SLA targets are left NULL on back-filled rows
-- rather than stamped with today's policy: those tickets were never promised
-- anything, and inventing a promise would manufacture breaches that never
-- happened.

-- ── 1. New columns on support_tickets ──
ALTER TABLE "support_tickets"
    ADD COLUMN IF NOT EXISTS "priority"                   TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS "first_response_at"          TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "resolved_at"                TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "resolution_minutes"         INTEGER,
    ADD COLUMN IF NOT EXISTS "resolved_at_estimated"      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "reopened_count"             INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "sla_first_response_minutes" INTEGER,
    ADD COLUMN IF NOT EXISTS "sla_resolution_minutes"     INTEGER;

-- The priority vocabulary mirrors the keys of AnalyticsPolicy.support.sla.
-- Kept as a CHECK rather than a Prisma enum for the same reason `status` is:
-- an operator adding a tier should not need a schema migration, and the four
-- here are the ones the platform ships with.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_priority_check'
    ) THEN
        ALTER TABLE "support_tickets"
            ADD CONSTRAINT "support_tickets_priority_check"
            CHECK ("priority" IN ('urgent', 'high', 'normal', 'low'));
    END IF;
END $$;

-- ── 2. Status history ──
CREATE TABLE IF NOT EXISTS "support_ticket_status_history" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id"  UUID NOT NULL,
    "status"     TEXT NOT NULL,
    "at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_type"    TEXT NOT NULL,
    "by_id"      UUID,
    "by_name"    TEXT NOT NULL DEFAULT '',
    "note"       TEXT NOT NULL DEFAULT '',
    "backfilled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "support_ticket_status_history_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_status_history_status_check'
    ) THEN
        ALTER TABLE "support_ticket_status_history"
            ADD CONSTRAINT "support_ticket_status_history_status_check"
            CHECK ("status" IN ('open', 'pending', 'solved'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_status_history_by_type_check'
    ) THEN
        ALTER TABLE "support_ticket_status_history"
            ADD CONSTRAINT "support_ticket_status_history_by_type_check"
            CHECK ("by_type" IN ('customer', 'admin', 'system'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_status_history_ticket_id_fkey'
    ) THEN
        ALTER TABLE "support_ticket_status_history"
            ADD CONSTRAINT "support_ticket_status_history_ticket_id_fkey"
            FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- SET NULL, not CASCADE: an admin who has since left must not take the
    -- record of what they did with them. `by_name` is copied onto the row for
    -- exactly that case.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_status_history_by_id_fkey'
    ) THEN
        ALTER TABLE "support_ticket_status_history"
            ADD CONSTRAINT "support_ticket_status_history_by_id_fkey"
            FOREIGN KEY ("by_id") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "support_ticket_status_history_ticket_id_at_idx"
    ON "support_ticket_status_history" ("ticket_id", "at" ASC);
CREATE INDEX IF NOT EXISTS "support_ticket_status_history_status_at_idx"
    ON "support_ticket_status_history" ("status", "at" DESC);

-- ── 3. Indexes for the analytics reads ──
CREATE INDEX IF NOT EXISTS "support_tickets_created_at_idx"
    ON "support_tickets" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "support_tickets_status_priority_idx"
    ON "support_tickets" ("status", "priority");
CREATE INDEX IF NOT EXISTS "support_tickets_assigned_status_idx"
    ON "support_tickets" ("assigned_admin_id", "status");
CREATE INDEX IF NOT EXISTS "support_tickets_resolved_at_idx"
    ON "support_tickets" ("resolved_at" DESC);
CREATE INDEX IF NOT EXISTS "support_ticket_messages_author_type_created_at_idx"
    ON "support_ticket_messages" ("author_type", "created_at" DESC);

-- ── 4. Back-fill: first response (exact) ──
UPDATE "support_tickets" t
SET "first_response_at" = m.first_admin_reply
FROM (
    SELECT "ticket_id", MIN("created_at") AS first_admin_reply
    FROM "support_ticket_messages"
    WHERE "author_type" = 'admin'
    GROUP BY "ticket_id"
) m
WHERE m."ticket_id" = t."id" AND t."first_response_at" IS NULL;

-- ── 5. Back-fill: resolution (an estimate, and flagged as one) ──
UPDATE "support_tickets"
SET "resolved_at"           = "updated_at",
    "resolved_at_estimated" = true,
    "resolution_minutes"    = GREATEST(
        0, (EXTRACT(EPOCH FROM ("updated_at" - "created_at")) / 60)::int
    )
WHERE "status" = 'solved' AND "resolved_at" IS NULL;

-- ── 6. Back-fill: the status history we can honestly claim ──
-- An `open` row at creation is a fact: every ticket starts open.
INSERT INTO "support_ticket_status_history"
    ("ticket_id", "status", "at", "by_type", "by_id", "by_name", "note", "backfilled")
SELECT t."id", 'open', t."created_at", 'customer', t."user_id",
       COALESCE(u."name", ''), 'Reconstructed when ticket metrics were added', true
FROM "support_tickets" t
JOIN "users" u ON u."id" = t."user_id"
WHERE NOT EXISTS (
    SELECT 1 FROM "support_ticket_status_history" h WHERE h."ticket_id" = t."id"
);

-- A `solved` row for tickets that are solved now, at the estimated time. Only
-- the final state is claimed: everything in between was never recorded, and
-- inventing the middle of a history is worse than admitting it is missing.
INSERT INTO "support_ticket_status_history"
    ("ticket_id", "status", "at", "by_type", "by_name", "note", "backfilled")
SELECT t."id", 'solved', t."resolved_at", 'system', '',
       'Estimated from the last update — the real time was never recorded', true
FROM "support_tickets" t
WHERE t."status" = 'solved'
  AND t."resolved_at" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "support_ticket_status_history" h
      WHERE h."ticket_id" = t."id" AND h."status" = 'solved'
  );
