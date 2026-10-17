# A reusable module declares what it needs rather than inheriting it silently
# from whoever called it. Terragrunt also generates a versions.tf at the live/
# layer; these agree, and this one is what makes the module validate and
# version-check on its own.
terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}
