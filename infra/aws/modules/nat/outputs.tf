output "nat_gateway_ids" {
  value       = { for az, gw in aws_nat_gateway.main : az => gw.id }
  description = "Keyed by availability zone."
}

output "nat_public_ips" {
  value       = { for az, eip in aws_eip.nat : az => eip.public_ip }
  description = "The addresses customer traffic appears to come from. Useful when a model host asks to allowlist us."
}
