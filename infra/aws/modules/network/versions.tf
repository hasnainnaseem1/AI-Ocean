# A reusable module declares the provider it needs itself, rather than relying
# on whatever the caller happens to have configured.
terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
