variable "name_prefix" {
  type    = string
  default = "aiocean"
}

variable "create_platform_user" {
  type        = bool
  description = <<-EOT
    Create the IAM user the backend authenticates as.

    True for a first setup. Turn it off if you would rather the backend use a
    role it assumes (from another AWS account, or from an EC2/ECS task it runs
    on) — the policy is created either way and can simply be attached to that
    role instead. A long-lived access key is the simplest thing that works, and
    the worst thing to leak; an assumed role is better if you already have one.
  EOT
  default     = true
}
