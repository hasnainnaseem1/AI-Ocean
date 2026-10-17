/**
 * Staging environment.
 *
 * This is where the first real VM gets created and the isolation proof is run.
 * It exists so that the first time this code touches money and networking, it
 * does so somewhere that has no customers in it.
 *
 * Fill in `project_id`, `state_bucket` and (if you created an organization)
 * `firewall_policy_parent` from SETUP.md. Nothing else here needs changing to
 * get started.
 */

locals {
  env        = "staging"
  project_id = "REPLACE-ME-aiocean-staging"

  # Created once by gcloud before the first apply — see SETUP.md step 3.5.
  state_bucket = "REPLACE-ME-aiocean-staging-tfstate"

  default_region = "europe-west4"

  # The platform's region names mapped to real GCP regions. The backend holds
  # the same mapping in code (backend/src/services/gcp/gcpRegionMap.js); these
  # two must agree, and the mapper has a test that reads this list.
  #
  # A /20 is 4094 usable addresses — far more machines per region than this
  # platform will run for a long time — and the ranges are spaced so another
  # region can be added without renumbering.
  subnets = {
    "europe-west4" = { cidr = "10.20.0.0/20" } # platform region: eu-central
    "us-east4"     = { cidr = "10.21.0.0/20" } # platform region: us-east
    "asia-south1"  = { cidr = "10.22.0.0/20" } # platform region: ap-south
  }

  # The role-less account every customer VM runs as. Created in SETUP.md 5.1.
  customer_service_account = "customer-vm@REPLACE-ME-aiocean-staging.iam.gserviceaccount.com"

  # Raasta A only. Leave as "" if there is no GCP organization — the
  # org-firewall-policy unit then does nothing, and isolation rests on the
  # project-level rules alone. See README.md.
  firewall_policy_parent = ""
}
