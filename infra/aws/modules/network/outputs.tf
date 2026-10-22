output "vpc_id" {
  value       = aws_vpc.main.id
  description = "The VPC every customer machine runs in."
}

output "vpc_cidr" {
  value       = aws_vpc.main.cidr_block
  description = "The whole VPC range. The security module denies traffic to this, which is what keeps customers apart."
}

output "private_subnet_ids" {
  value       = { for az, s in aws_subnet.private : az => s.id }
  description = "Where customer machines go, keyed by availability zone."
}

output "private_subnet_cidrs" {
  value       = { for az, s in aws_subnet.private : az => s.cidr_block }
  description = "Keyed by availability zone."
}

output "public_subnet_ids" {
  value       = { for az, s in aws_subnet.public : az => s.id }
  description = "NAT gateways only. No customer machine is ever placed here."
}

output "private_route_table_ids" {
  value       = { for az, rt in aws_route_table.private : az => rt.id }
  description = "The nat module adds the default route to these."
}

/*
 * The internet gateway, consumed by the `nat` unit.
 *
 * Not decoration: a NAT gateway is useless until the VPC's internet gateway is
 * attached, and Terraform cannot see that from the resource graph. Passing
 * this id into `nat` is how that ordering is expressed — it is an input that
 * cannot exist until the network is built, which `depends_on` on a variable
 * only pretends to be.
 *
 * The `nat` unit has always asked for it. Without this output it resolved only
 * against the mock, which Terragrunt allows for `validate` and `plan` — so the
 * stack planned cleanly and failed on the first real apply.
 */
output "internet_gateway_id" {
  value       = aws_internet_gateway.main.id
  description = "Consumed by the nat module, so NAT is never built before its route out exists."
}
