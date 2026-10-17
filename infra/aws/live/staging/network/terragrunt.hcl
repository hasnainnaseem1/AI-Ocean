include "root" {
  path = find_in_parent_folders("root.hcl")
}

locals {
  env    = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
  region = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals.default_region
}

terraform {
  source = "${get_repo_root()}/infra/aws/modules/network"
}

inputs = {
  network_name       = "aiocean-customer"
  vpc_cidr           = local.env.vpc_cidr
  availability_zones = local.env.regions[local.region].azs
}
