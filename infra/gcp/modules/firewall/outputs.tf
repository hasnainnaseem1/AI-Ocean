output "rule_names" {
  description = <<-EOT
    Every rule this module created. The isolation proof in infra/tests asserts
    that a blocked connectivity test names one of these as the cause — a test
    that merely reports UNREACHABLE could be passing for the wrong reason (a
    typo'd IP, a stopped VM), so it has to name the rule that did it.
  EOT
  value = concat(
    [
      google_compute_firewall.deny_customer_to_private.name,
      google_compute_firewall.allow_customer_internet.name,
      google_compute_firewall.deny_customer_egress_rest.name,
      google_compute_firewall.allow_iap_ssh.name,
      google_compute_firewall.deny_customer_ingress.name,
    ],
    [for r in google_compute_firewall.allow_internal_exception : r.name],
  )
}

output "isolation_rule_name" {
  description = "The load-bearing rule. If a connectivity test between two customer VMs does not name this, the isolation is not working the way this module claims."
  value       = google_compute_firewall.deny_customer_to_private.name
}
