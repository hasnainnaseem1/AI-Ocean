include "root" {
  path = find_in_parent_folders("root.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "${get_repo_root()}/infra/aws/modules/security"
}

# The isolation is built from the network's own outputs rather than from
# anything typed again here — the VPC range the NACL denies has to be the VPC's
# actual range, and typing it twice is how those two drift apart.
dependency "network" {
  config_path = "../network"

  mock_outputs = {
    vpc_id             = "vpc-mock"
    vpc_cidr           = "10.32.0.0/16"
    private_subnet_ids = { "ap-south-1a" = "subnet-mock" }
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan", "init"]
}

inputs = {
  name_prefix        = "aiocean"
  vpc_id             = dependency.network.outputs.vpc_id
  vpc_cidr           = dependency.network.outputs.vpc_cidr
  private_subnet_ids = dependency.network.outputs.private_subnet_ids

  # Empty, and that is the intended state. Every entry is a hole in customer
  # isolation.
  internal_allow_cidrs = {}
}
