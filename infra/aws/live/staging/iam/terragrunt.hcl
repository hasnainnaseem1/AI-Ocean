include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${get_repo_root()}/infra/aws/modules/iam"
}

inputs = {
  name_prefix = "aiocean"

  # Creates the IAM user the backend authenticates as. Its access key is made
  # by hand afterwards and pasted into the admin center — Terraform must never
  # hold a long-lived credential in state.
  create_platform_user = true
}
