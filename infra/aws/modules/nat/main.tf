/**
 * How a customer machine reaches the internet without being reachable from it.
 *
 * A NAT gateway is one-way by construction: machines behind it can open
 * connections out, and nothing outside can open one in. That is what lets the
 * security module have no inbound rules at all — there is no inbound path to
 * write a rule about.
 *
 * ── One per availability zone ──
 *
 * A NAT gateway lives in a single AZ. Sharing one across AZs means an AZ
 * outage takes out egress for machines that were otherwise healthy, and every
 * cross-AZ byte is billed as data transfer on top of the NAT charge. One per AZ
 * costs more in gateway-hours and less in everything else.
 *
 * ── This is the expensive part ──
 *
 * NAT gateways bill per hour AND per GB processed, and a machine downloading
 * model weights moves a lot of GB. None of that appears on any per-VM price
 * list, which is exactly why the platform's cost model has an overhead figure
 * an operator fills in from their own bill — see Cloud → Overview in the admin
 * center.
 */

resource "aws_eip" "nat" {
  for_each = var.public_subnet_ids

  domain = "vpc"

  tags = {
    Name = "${var.name_prefix}-nat-${each.key}"
  }
}

resource "aws_nat_gateway" "main" {
  for_each = var.public_subnet_ids

  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = each.value

  tags = {
    Name = "${var.name_prefix}-nat-${each.key}"
  }

  /*
   * A NAT gateway is useless until its VPC's internet gateway is attached, and
   * Terraform cannot see that from the resource graph alone.
   *
   * There is deliberately no `depends_on` here. The obvious thing to write is
   * `depends_on = [var.internet_gateway_id]`, which Terraform accepts in
   * silence and which does nothing at all — `depends_on` creates an edge
   * between *resources*, and a variable is just a value that happens to
   * contain an id. It reads like a guarantee and is not one.
   *
   * The real ordering comes from Terragrunt: the `nat` unit declares a
   * `dependency` on `network`, so the whole network unit — internet gateway
   * included — is applied before this unit starts. `var.internet_gateway_id`
   * is how that ordering is expressed, by being an input that cannot exist
   * until the network is built.
   */
}

/*
 * The default route for each private subnet, pointing at the NAT gateway in
 * its own AZ. Until this exists, a customer machine has no way out at all.
 */
resource "aws_route" "private_default" {
  for_each = var.private_route_table_ids

  route_table_id         = each.value
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[each.key].id
}
