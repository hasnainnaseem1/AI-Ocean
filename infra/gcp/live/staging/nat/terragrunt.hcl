include "root" {
  path = find_in_parent_folders("root.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "${get_repo_root()}/infra/gcp/modules/nat"
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    network_name      = "aiocean-customer"
    subnet_self_links = {}
  }
  mock_outputs_allowed_terraform_commands = ["plan", "validate"]
}

inputs = {
  project_id   = local.env.project_id
  network_name = dependency.network.outputs.network_name

  # Reshaped from the network module's output so NAT can only ever cover a
  # subnet that module actually created.
  subnets = {
    for region, self_link in dependency.network.outputs.subnet_self_links :
    region => { self_link = self_link }
  }
}
