-- Teams, phase INVITE.
--
-- `team_invitations`: joining a team by email. Only the SHA-256 of the link's
-- token is stored, so a copy of the database cannot be used to join anything.
-- An invitation is single-use (accepted_at), revocable, expiring, and bound to
-- the invited address — only a verified account with that exact email can
-- accept it (enforced in invitationService).
--
-- Nobody is ever invited as `owner`: ownership only moves by an explicit,
-- accepted transfer (phase CUSTODY). The CHECK below makes that a property of
-- the data, not just of the code that writes it.
--
-- `users.team_onboarding_pending`: the customer chose "my team / company" at
-- signup and has not yet created (or skipped creating) their organization.
-- Every existing row gets false — individual customers see nothing new.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "team_onboarding_pending" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_token_hash_key" ON "team_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "team_invitations_team_id_created_at_idx" ON "team_invitations"("team_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "team_invitations_email_idx" ON "team_invitations"("email");

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_role_not_owner" CHECK ("role" <> 'owner');
