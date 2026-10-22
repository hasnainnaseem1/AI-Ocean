/**
 * Staging environment — AWS.
 *
 * Where the first real EC2 instance gets created and the isolation proof is
 * run, somewhere that has no customers in it.
 *
 * ── What lives here, and what does not ──
 *
 * Only things that are true of the whole ACCOUNT. Anything that belongs to one
 * region — the VPC's address range, which availability zones to use — lives in
 * that region's own `region.hcl`, because on AWS a network belongs to exactly
 * one region and so does everything hanging off it.
 *
 * This file used to carry a `default_region` and a `regions` map. Only
 * `regions[default_region]` was ever read, so listing three regions built one
 * and the other two failed at launch with no sign of why.
 *
 * Fill in `account_id`, `state_bucket` and `lock_table` from SETUP.md.
 */

locals {
  env = "staging"

  # Your 12-digit AWS account number. The provider refuses to run against any
  # other account, so a stale profile fails loudly instead of building customer
  # machines somewhere nothing is watching.
  account_id = "REPLACE-ME-123456789012"

  # Created once by the AWS CLI before the first apply — see SETUP.md step 3.
  #
  # ONE bucket and ONE lock table for every region. State is not regional data:
  # keeping it in one place means one backup to look after and one bucket
  # policy to get right, and the per-unit key already separates the regions.
  state_bucket = "REPLACE-ME-aiocean-staging-tfstate"
  lock_table   = "REPLACE-ME-aiocean-staging-tflock"

  # Where that bucket itself lives. Nothing to do with where machines are
  # built — a unit in ap-south-1 still reads its state from here.
  state_bucket_region = "eu-west-1"
}
