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

variable "create_build_user" {
  type        = bool
  description = <<-EOT
    Create the IAM user the REGION BUILD WORKER authenticates as.

    This is a second, separate identity from the platform runtime user, and the
    separation is the whole point. The build user can create a VPC, its
    subnets, its security group and its network ACLs — which on AWS
    unavoidably means it can also rewrite them. There is no way to grant "may
    create this NACL rule but may never change it": the same permission does
    both, and one word changed in one rule lets every customer machine in a
    region reach every other.

    That risk is acceptable only because the key never enters the API process.
    It belongs in the environment of `src/workers/regionBuilder.js`, running as
    a different OS user. If the two ever share an environment, this user is
    simply the platform user with network-admin rights, and the isolation
    guarantee stops being provable.

    Turn it off if the applies are run by hand or from a pipeline.
  EOT
  default     = true
}

variable "build_regions" {
  type        = list(string)
  description = <<-EOT
    The only regions the build credential may act in.

    Enforced with an `aws:RequestedRegion` condition, so a leaked build key
    cannot raise infrastructure somewhere nobody is watching the bill or the
    isolation. Keep this in step with `awsRegionMap.js` — a region the platform
    sells and this list omits cannot be built, and the worker will say so.
  EOT
  default     = ["eu-west-1", "us-east-1", "ap-south-1"]
}
