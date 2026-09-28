-- Teams, phase JOIN-LINK.
--
-- ── Why a link at all ──
--
-- An invitation by email is the safest way into a team and stays the default,
-- but it needs the inviter to know every address. A join link is the other
-- half: one link, dropped into the company's own chat, that anyone there can
-- use. What keeps it safe is that it does not let anyone in — it lets them
-- ASK. An owner or admin approves, so a link that leaks, gets forwarded, or
-- stays in an ex-employee's inbox is worth nothing on its own.
--
-- Only the SHA-256 of the token is stored, exactly like `team_invitations`: a
-- copy of this database cannot be used to join anything. A link expires, can
-- be revoked, can be re-issued (which kills the old one), and can carry a cap
-- on how many people may come through it. The role it hands out is limited to
-- the two that see no money — nobody reaches a wallet by opening a link.
--
-- ── `teams.discoverable_by_domain` ──
--
-- The one switch behind "somebody at your company is already here". It is off
-- for every team, and only a team's owner turns it on. Detecting whether an
-- email domain is a public mailbox provider is not something any list can do
-- for the whole internet, so nothing is ever disclosed because a domain looked
-- private — it is disclosed because the owner said so. The lists and the
-- popularity check (see domainNudgeService) sit on top of that consent, not in
-- place of it.
--
-- ── Organization names ──
--
-- Unique per owner, case-insensitively: one person cannot end up with two
-- accounts they cannot tell apart. Deliberately NOT unique platform-wide —
-- "that name is taken" would let anyone test which companies are customers
-- here, and an unrelated customer in another country must not be able to take
-- a name away from the company it belongs to.

-- AlterTable
ALTER TABLE "teams" ADD COLUMN "discoverable_by_domain" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "teams_one_name_per_owner" ON "teams"("created_by_id", lower("name"))
    WHERE "kind" = 'team' AND "deleted_at" IS NULL;

-- CreateTable
CREATE TABLE "team_join_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'developer',
    "created_by_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_join_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_join_links_token_hash_key" ON "team_join_links"("token_hash");

-- CreateIndex
CREATE INDEX "team_join_links_team_id_created_at_idx" ON "team_join_links"("team_id", "created_at" DESC);

-- One live link per team: re-issuing revokes the old one rather than leaving
-- a second door open that nobody remembers.
CREATE UNIQUE INDEX "team_join_links_one_live_per_team" ON "team_join_links"("team_id")
    WHERE "revoked_at" IS NULL;

-- A link may only hand out a role that sees no money.
ALTER TABLE "team_join_links" ADD CONSTRAINT "team_join_links_role_check"
    CHECK ("role" IN ('developer', 'viewer'));

-- AddForeignKey
ALTER TABLE "team_join_links" ADD CONSTRAINT "team_join_links_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_join_links" ADD CONSTRAINT "team_join_links_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A join request now records which door it came through: a link, or the
-- company-domain hint. Null means it came from the domain side.
ALTER TABLE "team_join_requests" ADD COLUMN "join_link_id" UUID;

ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_join_link_id_fkey"
    FOREIGN KEY ("join_link_id") REFERENCES "team_join_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
