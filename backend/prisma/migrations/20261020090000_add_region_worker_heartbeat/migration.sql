-- The region build worker's heartbeat.
--
-- The worker is a separate OS process holding a credential the API process
-- deliberately cannot read — that separation is what keeps the platform's
-- runtime unable to change a network, and so keeps customer isolation
-- provable rather than merely hoped for.
--
-- The cost of that separation is that the API cannot inspect the worker: being
-- able to would be exactly the access the design removes. So the worker writes
-- a timestamp and the admin screen reads it, which is the only honest way to
-- answer "will asking for this region actually build it, or just leave a note
-- for a human?" — two very different meanings for the same button.

ALTER TABLE "cloud_region_costs"
  ADD COLUMN IF NOT EXISTS "worker_seen_at" TIMESTAMP(3);
