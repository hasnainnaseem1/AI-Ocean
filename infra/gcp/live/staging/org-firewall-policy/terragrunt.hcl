include "root" {
  path = find_in_parent_folders("root.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "${get_repo_root()}/infra/gcp/modules/org-firewall-policy"
}

inputs = {
  # Off when there is no GCP organization. This is not a formality: with it
  # off, the only thing keeping one customer's VM away from another's is the
  # project-level firewall, which anyone with compute.securityAdmin on the
  # project can change. See ../../../README.md.
  enabled = local.env.firewall_policy_parent != ""

  parent                   = local.env.firewall_policy_parent
  policy_name              = "aiocean-isolation-${local.env.env}"
  customer_service_account = local.env.customer_service_account
}
