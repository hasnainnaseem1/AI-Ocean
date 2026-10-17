variable "project_id" {
  description = "GCP project the network lives in."
  type        = string
}

variable "network_name" {
  description = "VPC name. Never `default` — see main.tf."
  type        = string
  default     = "aiocean-customer"

  validation {
    condition     = var.network_name != "default"
    error_message = "The `default` VPC carries default-allow-internal, which would let every customer VM reach every other one. Use a custom-mode network."
  }
}

variable "subnets" {
  description = <<-EOT
    GCP region -> { cidr }. One subnet per region we place customers in.
    Ranges must not overlap; the firewall module denies traffic to all of them
    collectively, so an overlap would be a silent hole.
  EOT
  type = map(object({
    cidr = string
  }))
}
