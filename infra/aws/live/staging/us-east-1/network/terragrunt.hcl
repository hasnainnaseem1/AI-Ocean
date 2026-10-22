include "root" {
  path = find_in_parent_folders("root.hcl")
}

locals {
  # This region's own values. The VPC range and the zones belong to the region
  # folder, because an AWS network belongs to exactly one region — reading them
  # from a single `default_region` at the environment level is what made this
  # stack build one region and silently skip the rest.
  region = read_terragrunt_config(find_in_parent_folders("region.hcl")).locals
}

terraform {
  source = "${get_repo_root()}/infra/aws/modules/network"
}

inputs = {
  network_name       = "aiocean-customer"
  vpc_cidr           = local.region.vpc_cidr
  availability_zones = local.region.azs
}
