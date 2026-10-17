output "enabled" {
  description = "Whether the folder/org-level isolation layer is actually in force. The isolation proof reads this to decide whether it can run its 'delete the project rules and confirm traffic is still blocked' case."
  value       = var.enabled
}

output "policy_id" {
  value = var.enabled ? google_compute_firewall_policy.isolation[0].id : null
}

output "rule_priority" {
  value = var.enabled ? google_compute_firewall_policy_rule.deny_customer_to_private[0].priority : null
}
