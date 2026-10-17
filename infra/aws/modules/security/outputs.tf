output "security_group_id" {
  value       = aws_security_group.customer.id
  description = "Every customer instance launches with this group and no other."
}

output "network_acl_id" {
  value       = aws_network_acl.customer.id
  description = "The subnet-level rules that actually keep customers apart."
}

output "isolation_rule_ids" {
  value = {
    egress_deny_vpc  = aws_network_acl_rule.egress_deny_vpc.id
    ingress_deny_vpc = aws_network_acl_rule.ingress_deny_vpc.id
  }
  description = "The two load-bearing deny rules, surfaced so the isolation test can name what it is checking."
}
