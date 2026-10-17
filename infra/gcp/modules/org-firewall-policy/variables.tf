variable "enabled" {
  description = <<-EOT
    False on a platform with no GCP organization (Raasta B in SETUP.md).
    Turning this off is a real reduction in isolation assurance, not a
    formality — the project-level rules become the only thing enforcing it.
  EOT
  type        = bool
  default     = true
}

variable "parent" {
  description = "Where the policy attaches: `folders/123456` or `organizations/123456`."
  type        = string
  default     = ""

  validation {
    condition     = var.parent == "" || can(regex("^(folders|organizations)/[0-9]+$", var.parent))
    error_message = "Must look like folders/123456 or organizations/123456."
  }
}

variable "policy_name" {
  description = "Short name of the policy. Must be unique within the parent."
  type        = string
  default     = "aiocean-isolation"
}

variable "customer_service_account" {
  description = "The role-less account customer VMs run as — the same one ../firewall targets."
  type        = string
}

variable "private_ranges" {
  description = "Address space a customer VM must never reach. Defaults to all of RFC 1918, which is every address another customer's VM can have."
  type        = list(string)
  default     = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
}
