variable "project_id" {
  type = string
}

variable "network_name" {
  description = "The customer VPC these rules attach to."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for every rule name, so they sort together in the console."
  type        = string
  default     = "aiocean-customer"
}

variable "customer_service_account" {
  description = <<-EOT
    Email of the role-less service account every customer VM runs as. Every
    rule in this module targets it. Targeting by service account rather than by
    network tag is the point — see main.tf.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[^@]+@[^@]+\\.iam\\.gserviceaccount\\.com$", var.customer_service_account))
    error_message = "Must be a service account email, e.g. customer-vm@my-project.iam.gserviceaccount.com."
  }
}

variable "egress_tcp_ports" {
  description = "Outbound TCP a customer workload may use. Narrow on purpose: HTTP(S) covers model weights, packages and container images."
  type        = list(string)
  default     = ["80", "443"]
}

variable "egress_udp_ports" {
  description = "Outbound UDP. DNS and NTP against external resolvers; the GCP metadata server is reachable regardless (see main.tf)."
  type        = list(string)
  default     = ["53", "123"]
}

variable "internal_egress_allow" {
  description = <<-EOT
    Reviewed exceptions to "a customer VM may not reach a private address".
    Empty by default, and it should stay that way unless a platform service
    genuinely has to be reachable from inside a customer machine.

    Each entry must name one destination and one port range, never a broad
    block, and `reason` ends up in the rule's description in the GCP console so
    whoever finds it later knows why it exists.
  EOT
  type = map(object({
    cidr     = string
    protocol = string
    ports    = list(string)
    reason   = string
  }))
  default = {}

  validation {
    condition = alltrue([
      for k, v in var.internal_egress_allow :
      tonumber(split("/", v.cidr)[1]) >= 24
    ])
    error_message = "An exception must be /24 or narrower. A wider range is a hole in customer isolation, not an exception to it."
  }
}
