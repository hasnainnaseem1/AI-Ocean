-- Teams, phase CUSTODY.
--
-- `team_activity`: the team's own history — who invited whom, who changed a
-- role or a spend limit, who left, who handed the team over. It is the team's
-- record, not the platform's: the admin audit trail (`activity_logs`) stays a
-- separate table so a customer can never read the platform's log.
--
-- The actor's name and email are copied onto the row rather than joined at
-- read time. Someone removed from the team, or gone from the platform
-- entirely, must still read as the person who did it.
--
-- `action` is a stable key and `metadata` carries the values it needs, so the
-- customer center renders each entry in the reader's own language — the same
-- reason notifications store a key instead of a finished sentence.
--
-- `ownership_transfers`: an owner's offer to hand the team to an existing
-- member, which only takes effect when that member accepts. None of the money
-- moves with it — the wallet, cards and any outstanding balance belong to the
-- team — so this can never be used to hand a debt to someone else. At most one
-- offer is open per team at a time, enforced below by a partial unique index
-- rather than by the code that writes it.

-- CreateTable
CREATE TABLE "team_activity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_name" TEXT NOT NULL,
    "actor_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "target_name" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_activity_team_id_created_at_idx" ON "team_activity"("team_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "team_activity" ADD CONSTRAINT "team_activity_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The actor link goes null if the account is ever erased; the row itself, with
-- its copied name and email, survives.
ALTER TABLE "team_activity" ADD CONSTRAINT "team_activity_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ownership_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ownership_transfers_team_id_created_at_idx" ON "ownership_transfers"("team_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ownership_transfers_to_user_id_idx" ON "ownership_transfers"("to_user_id");

-- One open offer per team: a second one cannot be created while the first is
-- still unanswered, whatever two concurrent requests try to do.
CREATE UNIQUE INDEX "ownership_transfers_one_open_per_team" ON "ownership_transfers"("team_id")
    WHERE "accepted_at" IS NULL AND "declined_at" IS NULL AND "cancelled_at" IS NULL;

-- A team is never offered to the person who already owns it.
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_not_to_self"
    CHECK ("from_user_id" <> "to_user_id");

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_from_user_id_fkey"
    FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_to_user_id_fkey"
    FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
