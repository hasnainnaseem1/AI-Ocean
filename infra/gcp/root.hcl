/**
 * Root Terragrunt configuration.
 *
 * Named `root.hcl`, not `terragrunt.hcl`: Terragrunt warns that a root config
 * sharing the unit filename is an anti-pattern and will become an error, since
 * it makes "the config for this unit" and "the config everything inherits"
 * indistinguishable by name.
 *
 * Everything under live/ includes this, so the backend and the provider are
 * declared once rather than copied into every unit — which is the whole reason
 * Terragrunt is here rather than plain Terraform.
 *
 * State lives in a GCS bucket, never on a laptop. Two reasons: it is the only
 * record of what actually exists in GCP, so a lost local file means
 * reconstructing reality by hand; and it holds resource detail that should not
 * sit in a working directory. The bucket is created once by gcloud before the
 * first apply (see SETUP.md) — Terraform cannot create the thing it stores its
 * own state in.
 */

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))

  project_id     = local.env_vars.locals.project_id
  state_bucket   = local.env_vars.locals.state_bucket
  default_region = local.env_vars.locals.default_region
}

remote_state {
  backend = "gcs"

  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }

  config = {
    project  = local.project_id
    bucket   = local.state_bucket
    location = local.default_region

    # One state file per unit, keyed by its path under live/. Keeping network,
    # firewall and nat in separate states means a mistake while editing one
    # cannot corrupt or lock the others — and the firewall, which is the
    # isolation, can be applied on its own.
    prefix = path_relative_to_include()

    # Belt and braces on the bucket itself, in case it was created by hand
    # without them.
    enable_bucket_policy_only = true
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    provider "google" {
      project = "${local.project_id}"
      region  = "${local.default_region}"
    }

    provider "google-beta" {
      project = "${local.project_id}"
      region  = "${local.default_region}"
    }
  EOF
}

/*
 * ── There is deliberately no `generate "versions"` block here ──
 *
 * There used to be, and it meant this stack could never be applied. Each
 * module ships its own `versions.tf` — which is where a module's provider
 * requirements belong, so it stays valid whether it is called from here, from
 * another stack, or from a bare `terraform apply`. Terragrunt's
 * `if_exists = "overwrite_terragrunt"` only replaces files Terragrunt itself
 * wrote; a file that came from the module's source makes it stop with
 * "versions.tf already exists", before Terraform is ever run.
 *
 * The same block was removed from infra/aws/root.hcl for the same reason.
 */


inputs = {
  project_id = local.project_id
}
