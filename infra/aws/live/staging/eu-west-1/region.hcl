/**
 * eu-west-1 — the AWS region this folder builds in.
 *
 * Every unit beneath it reads this: the provider's region, the availability
 * zones to spread across, and the address range for its VPC. On AWS a network
 * belongs to one region and cannot be shared, so each region gets its own
 * whole stack rather than a second copy of some of it.
 *
 * Sold to customers as the platform region "eu-central". That mapping also
 * lives in backend/src/services/aws/awsRegionMap.js, and the two must agree —
 * a test asserts it.
 */

locals {
  region = "eu-west-1"

  # Two availability zones. A single-AZ outage is the common AWS failure, and
  # spreading machines across two costs nothing extra in instance price.
  #
  # It does cost in NAT: a gateway is billed per zone whether anything uses it
  # or not, so two zones is two standing charges. That figure reaches every
  # tier's price through Cloud -> Overview; it is not free and is not hidden.
  azs = ["eu-west-1a", "eu-west-1b"]

  # The whole address range for this region's customer VPC.
  #
  # Every region gets its own /16, non-overlapping, so the regions could one
  # day be peered without renumbering. Renumbering a live subnet means
  # recreating every machine in it.
  #
  # Deliberately clear of the Google side's 10.20-10.22 ranges as well.
  vpc_cidr = "10.30.0.0/16"
}
