-- Why an order is waiting, in words the customer reads.
--
-- Distinct from `rejection_reason`, which means an admin turned the order down
-- and it is finished. This means the opposite: the order stands, the platform
-- cannot fill it right now, and the customer has something to decide.
--
-- The case it exists for is a price that moved. A customer is quoted a rate;
-- between the quote and the build, the cloud raises its own, and the machine
-- would now earn less than this platform is set to need. The order is not
-- wrong and the customer did nothing. The price is ours to fix, and the hourly
-- refresh usually fixes it within the hour.
--
-- Until now that customer saw "Pending review" with no reason attached and no
-- end to it. The only way out was to give up, which is the one outcome nobody
-- wanted.
ALTER TABLE "deployments"
  ADD COLUMN "hold_reason" TEXT NOT NULL DEFAULT '',
  -- 'repricing' | 'capacity' | 'funds' | '' — what KIND of wait, so the screen
  -- can offer the right way forward instead of one generic line.
  ADD COLUMN "hold_kind" TEXT NOT NULL DEFAULT '',
  -- So the customer can be told how long it has been, and the screen can stop
  -- promising "within the hour" once an hour has passed.
  ADD COLUMN "held_at" TIMESTAMP(3);
