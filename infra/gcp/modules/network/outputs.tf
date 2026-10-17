output "network_id" {
  description = "Self-link of the customer VPC."
  value       = google_compute_network.customer.id
}

output "network_name" {
  value = google_compute_network.customer.name
}

output "subnet_self_links" {
  description = "region -> subnet self-link, for the backend to place instances in."
  value       = { for k, s in google_compute_subnetwork.customer : k => s.self_link }
}

output "subnet_cidrs" {
  description = <<-EOT
    region -> CIDR. The firewall module denies customer egress to every one of
    these, so this output is what makes "deny traffic to our own ranges"
    impossible to get out of step with the subnets that actually exist.
  EOT
  value       = { for k, s in google_compute_subnetwork.customer : k => s.ip_cidr_range }
}
