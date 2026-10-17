/**
 * Staging environment — AWS.
 *
 * Where the first real EC2 instance gets created and the isolation proof is
 * run, somewhere that has no customers in it.
 *
 * Fill in `account_id`, `state_bucket` and `lock_table` from SETUP.md. Nothing
 * else here needs changing to get started.
 */

locals {
  env = "staging"

  # Your 12-digit AWS account number. The provider refuses to run against any
  # other account, so a stale profile fails loudly instead of building customer
  # machines somewhere nothing is watching.
  account_id = "REPLACE-ME-123456789012"

  # Created once by the AWS CLI before the first apply — see SETUP.md step 3.
  state_bucket = "REPLACE-ME-aiocean-staging-tfstate"
  lock_table   = "REPLACE-ME-aiocean-staging-tflock"

  default_region = "eu-west-1"

  # The platform's region names mapped to real AWS regions. The backend holds
  # the same mapping in code (backend/src/services/aws/awsRegionMap.js); these
  # two must agree.
  #
  # Two availability zones per region: a single-AZ outage is the common AWS
  # failure, and spreading machines across two costs nothing extra.
  regions = {
    "eu-west-1" = {
      azs = ["eu-west-1a", "eu-west-1b"] # platform region: eu-central
    }
  }

  # The whole address range for the customer VPC. A /16 leaves room for many
  # availability zones without renumbering — and renumbering a live subnet
  # means recreating every machine in it.
  #
  # Deliberately well clear of the GCP side's 10.20-10.22 ranges, so the two
  # clouds could one day be peered without a collision.
  vpc_cidr = "10.30.0.0/16"
}
