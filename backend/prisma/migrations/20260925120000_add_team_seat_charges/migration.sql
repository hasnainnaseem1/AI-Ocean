-- Teams, phase CONTROL-TEAMS: charging for seats.
--
-- A platform may charge a monthly fee per member above however many seats it
-- gives away. The fee is billed DAILY — one day's share of the month — rather
-- than in one lump, for two reasons: somebody who joins on the 10th pays from
-- the 10th and not a day before, and somebody who leaves stops costing the
-- team the same afternoon. No day is ever free, and no day is ever charged
-- twice.
--
-- "Charged twice" is what this table exists to prevent. One row per team per
-- day, with a unique index saying so, means a job that runs again — a retry, a
-- second server, an admin pressing the button — finds the day already settled
-- and does nothing. The row also stays as the record of what was charged and
-- why: how many seats, how many were free, and the monthly fee in force that
-- day, none of which can be re-derived later once the settings change.
--
-- `to_wallet` and `to_debt` split what the wallet could actually cover from
-- what it could not. The remainder is never dropped: it becomes debt on the
-- account, the same as any other unpaid usage.

-- CreateTable
CREATE TABLE "team_seat_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "seats" INTEGER NOT NULL,
    "free_seats" INTEGER NOT NULL,
    "monthly_fee" DECIMAL(12,4) NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "to_wallet" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "to_debt" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_seat_charges_pkey" PRIMARY KEY ("id")
);

-- One charge per team per day — the whole point of the table.
CREATE UNIQUE INDEX "team_seat_charges_team_id_day_key" ON "team_seat_charges"("team_id", "day");

-- CreateIndex
CREATE INDEX "team_seat_charges_day_idx" ON "team_seat_charges"("day" DESC);

-- AddForeignKey
ALTER TABLE "team_seat_charges" ADD CONSTRAINT "team_seat_charges_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
