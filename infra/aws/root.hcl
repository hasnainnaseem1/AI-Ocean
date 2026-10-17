/**
 * Root Terragrunt configuration — AWS.
 *
 * The AWS twin of `infra/gcp/root.hcl`. Separate on purpose rather than one
 * clever shared file with conditionals in it: the two clouds need different
 * backends (S3 vs GCS), different providers, and different version pins, and a
 * single file juggling both would be harder to read than two files that each
 * do one thing. The folder layout under each is deliberately identical, so
 * knowing your way around one means knowing your way around the other.
 *
 * Everything under live/ includes this, so the backend and the provider are
 * declared once rather than copied into every unit.
 *
 * State lives in an S3 bucket, never on a laptop — same reasoning as the GCP
 * side: it is the only record of what actually exists in AWS, and it holds
 * resource detail that should not sit in a working directory. The bucket and
 * its lock table are created once by the AWS CLI before the first apply (see
 * SETUP.md); Terraform cannot create the thing it stores its own state in.
 */

locals {
  env_vars = read_terragrunt_config(find_in_parent_folders("env.hcl"))

  account_id     = local.env_vars.locals.account_id
  state_bucket   = local.env_vars.locals.state_bucket
  lock_table     = local.env_vars.locals.lock_table
  default_region = local.env_vars.locals.default_region
  env            = local.env_vars.locals.env
}

remote_state {
  backend = "s3"

  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }

  config = {
    bucket = local.state_bucket
    region = local.default_region

    # One state file per unit, keyed by its path under live/. Keeping network,
    # security and nat in separate states means a mistake while editing one
    # cannot corrupt or lock the others — and the security unit, which IS the
    # isolation, can be applied on its own.
    key = "${path_relative_to_include()}/terraform.tfstate"

    # State describes live infrastructure, so it is encrypted at rest and the
    # bucket is never public. Belt and braces, in case the bucket was created
    # by hand without them.
    encrypt = true

    # Two clients running apply at once would interleave writes and leave the
    # state describing neither reality. DynamoDB holds the lock.
    dynamodb_table = local.lock_table
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    provider "aws" {
      region = "${local.default_region}"

      # Refuse to run against the wrong account. Without this, a stale profile
      # or an exported key from another account applies happily — and the first
      # sign is customer machines in a place nothing is watching.
      allowed_account_ids = ["${local.account_id}"]

      default_tags {
        tags = {
          managed-by  = "terragrunt"
          platform    = "aiocean"
          environment = "${local.env}"
        }
      }
    }
  EOF
}

generate "versions" {
  path      = "versions.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    terraform {
      required_version = ">= 1.5"

      required_providers {
        aws = {
          source  = "hashicorp/aws"
          version = "~> 5.0"
        }
      }
    }
  EOF
}

inputs = {
  environment = local.env
}
