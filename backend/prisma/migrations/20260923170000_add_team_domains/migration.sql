-- Teams, phase DOMAIN.
--
-- A team can claim its company domain and let colleagues in by it. The claim
-- is proved with a DNS TXT record holding `domain_token`, never by an email
-- address at the domain: anyone can be given a mailbox, but only whoever runs
-- the domain can publish a record for it. Until `domain_verified_at` is set,
-- a claim counts for nothing.
--
-- One verified domain belongs to one team — the partial unique index below —
-- so two teams cannot both answer for acme.com. Public mailbox providers
-- (gmail.com and the rest) are refused by an admin-editable blocklist in
-- `AdminSettings.features.teams.publicEmailDomains`, because "everyone with a
-- gmail address" is not a company.
--
-- `domain_join_mode`: off (nothing happens), request (they ask and an owner or
-- admin decides) or auto (in as soon as their email is verified). What they
-- come in as is `domain_join_role`, and the CHECK below allows only the two
-- roles that see no money — nobody reaches a team's wallet by signing up with
-- the right address.
--
-- `team_join_requests` holds the asking. One open request per person per team,
-- again as an index rather than as a promise made by the code.

-- AlterTable
ALTER TABLE "teams"
    ADD COLUMN "verified_domain"    TEXT,
    ADD COLUMN "domain_token"       TEXT,
    ADD COLUMN "domain_verified_at" TIMESTAMP(3),
    ADD COLUMN "domain_join_mode"   TEXT NOT NULL DEFAULT 'off',
    ADD COLUMN "domain_join_role"   "TeamRole" NOT NULL DEFAULT 'developer';

ALTER TABLE "teams" ADD CONSTRAINT "teams_domain_join_mode_check"
    CHECK ("domain_join_mode" IN ('off', 'request', 'auto'));

-- Only a role that sees no money may be handed out by a domain rule.
ALTER TABLE "teams" ADD CONSTRAINT "teams_domain_join_role_check"
    CHECK ("domain_join_role" IN ('developer', 'viewer'));

-- One verified domain, one team. Unverified claims do not reserve anything.
CREATE UNIQUE INDEX "teams_one_team_per_verified_domain" ON "teams"("verified_domain")
    WHERE "verified_domain" IS NOT NULL AND "domain_verified_at" IS NOT NULL AND "deleted_at" IS NULL;

-- CreateTable
CREATE TABLE "team_join_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "decided_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_join_requests_team_id_created_at_idx" ON "team_join_requests"("team_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "team_join_requests_user_id_idx" ON "team_join_requests"("user_id");

-- One open request per person per team.
CREATE UNIQUE INDEX "team_join_requests_one_open_per_user" ON "team_join_requests"("team_id", "user_id")
    WHERE "approved_at" IS NULL AND "declined_at" IS NULL AND "cancelled_at" IS NULL;

-- AddForeignKey
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_decided_by_id_fkey"
    FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
