variable "name_prefix" {
  type        = string
  description = "Name prefix for the NACL and security group."
  default     = "aiocean"
}

variable "vpc_id" {
  type        = string
  description = "The VPC from the network module."
}

variable "vpc_cidr" {
  type        = string
  description = <<-EOT
    The whole VPC range.

    This is what the NACL denies, in both directions, and it is therefore the
    single most important input in this module: get it wrong and the deny
    covers the wrong addresses while appearing to work.
  EOT
}

variable "private_subnet_ids" {
  type        = map(string)
  description = "Customer subnets, keyed by availability zone. The NACL is attached to all of them."
}

variable "internal_allow_cidrs" {
  type        = map(string)
  description = <<-EOT
    Narrow exceptions to the VPC-wide deny, keyed by a name explaining why.

    Empty by default, and that is the intended state. Every entry here is a
    hole in customer isolation, so each one has to be a /24 or smaller — a
    whole-VPC entry cannot be typed in here by accident.
  EOT
  default     = {}

  validation {
    condition = alltrue([
      for cidr in values(var.internal_allow_cidrs) :
      tonumber(split("/", cidr)[1]) >= 24
    ])
    error_message = "Every exception must be a /24 or smaller. A wider range would reopen the isolation this module exists to enforce."
  }
}
