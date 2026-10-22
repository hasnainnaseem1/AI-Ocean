include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/aws/modules/nat"
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    public_subnet_ids       = { "us-east-1a" = "subnet-mock" }
    private_route_table_ids = { "us-east-1a" = "rtb-mock" }
    internet_gateway_id     = "igw-mock"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan", "init"]
}

inputs = {
  name_prefix             = "aiocean"
  public_subnet_ids       = dependency.network.outputs.public_subnet_ids
  private_route_table_ids = dependency.network.outputs.private_route_table_ids
  internet_gateway_id     = dependency.network.outputs.internet_gateway_id
}
