include "root" {
  path = find_in_parent_folders("root.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "${get_repo_root()}/infra/gcp/modules/network"
}

inputs = {
  project_id   = local.env.project_id
  network_name = "aiocean-customer"
  subnets      = local.env.subnets
}
