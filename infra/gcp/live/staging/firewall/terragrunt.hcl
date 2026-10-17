include "root" {
  path = find_in_parent_folders("root.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "${get_repo_root()}/infra/gcp/modules/firewall"
}

dependency "network" {
  config_path = "../network"

  # So `terragrunt plan` works on a clean checkout before the network exists.
  mock_outputs = {
    network_name = "aiocean-customer"
  }
  mock_outputs_allowed_terraform_commands = ["plan", "validate"]
}

inputs = {
  project_id   = local.env.project_id
  network_name = dependency.network.outputs.network_name

  customer_service_account = local.env.customer_service_account

  # Empty on purpose. Anything added here punches a hole in customer
  # isolation; see the module's variables.tf for the shape and the rules.
  internal_egress_allow = {}
}
