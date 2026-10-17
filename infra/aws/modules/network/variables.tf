variable "network_name" {
  type        = string
  description = "Name prefix for the VPC and everything in it."
  default     = "aiocean-customer"

  validation {
    # AWS has no VPC literally called "default", but a name like this almost
    # always means somebody is about to point this module at shared or
    # pre-existing networking. Customer isolation depends on this VPC being
    # ours alone.
    condition     = !contains(["default", "main", "vpc"], lower(var.network_name))
    error_message = "Give the VPC its own distinct name. Sharing a general-purpose VPC with anything else breaks the isolation this platform promises."
  }
}

variable "vpc_cidr" {
  type        = string
  description = "The whole address range for this VPC. A /16 leaves room for many AZs without renumbering."
  default     = "10.30.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "Which AZs to build subnets in. Two is the sensible minimum; a single-AZ outage is the common AWS failure."

  validation {
    condition     = length(var.availability_zones) >= 1
    error_message = "At least one availability zone is required."
  }
}

variable "subnet_newbits" {
  type        = number
  description = "How many bits to add to the VPC prefix for each subnet. 4 on a /16 gives /20s — 4094 usable addresses each."
  default     = 4
}

variable "public_subnet_offset" {
  type        = number
  description = <<-EOT
    Where the public (NAT-only) subnets start, counted in subnet slots.

    Kept well clear of the private ones so more AZs can be added for customer
    machines without renumbering anything that already exists — renumbering a
    live subnet means recreating every instance in it.
  EOT
  default     = 8
}

variable "enable_flow_logs" {
  type        = bool
  description = "Record who talked to whom. This is the evidence behind the isolation claim, not a debugging nicety."
  default     = true
}

variable "flow_log_retention_days" {
  type        = number
  description = "How long flow logs are kept, in days."
  default     = 30
}
