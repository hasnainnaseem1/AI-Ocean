/**
 * Customer isolation on AWS.
 *
 * The promise is the same as on GCP: **no customer's machine can reach any
 * other customer's machine, by any route.** AWS gives you different tools to
 * keep that promise, and the difference matters enough to spell out, because
 * the obvious translation of the GCP design does not work here.
 *
 * ── The one thing to understand about AWS ──
 *
 * **Security groups cannot deny.** They are allow-lists: whatever is not
 * allowed is implicitly denied, and there is no way to write "allow everything
 * except this". GCP's design leans on an explicit high-priority *deny* rule for
 * all private addresses, and that rule simply cannot be expressed as a security
 * group.
 *
 * **Network ACLs can deny**, and they sit at the subnet boundary, which is
 * *outside* the instance. So the load-bearing rule lives in a NACL, and a
 * security group is the second layer rather than the first. That is the inverse
 * of how most AWS setups are written, and it is deliberate: a security group is
 * attached to an instance, and anything that can launch or modify an instance
 * can change which groups it is in. A NACL belongs to the subnet. An instance
 * cannot opt out of it.
 *
 * ── The layers ──
 *
 *  1. **Our own VPC** (the `network` module). The default VPC's default
 *     security group allows all traffic from itself — every instance reaching
 *     every other instance — and that is the isolation gone in one rule.
 *
 *  2. **NACL deny on the VPC range, both directions.** Rule numbers are
 *     evaluated low to high and the first match wins, so the denies are
 *     numbered below the allows. This is the rule that does the work: machine
 *     A's packet to machine B is dropped at the subnet edge, whatever either
 *     instance's security group says.
 *
 *  3. **A security group with no inbound rules at all.** Nothing may start a
 *     connection to a customer machine — not from the internet, not from
 *     inside the VPC, not from us. Outbound is restricted to the ports a
 *     machine genuinely needs (443/80 to fetch a model, 53 and 123 for DNS and
 *     time) and nothing else.
 *
 *  4. **No inbound administration path at all.** No SSH, no bastion, no port
 *     22 anywhere. Administration is SSM Session Manager, which works
 *     *outbound* through the NAT gateway — so there is nothing to attack. This
 *     is the AWS equivalent of GCP's IAP, and it is why layer 3 can afford to
 *     have no inbound rules whatsoever.
 *
 *  5. **An instance profile with no permissions** (the `iam` module). A machine
 *     that is broken into gets credentials that can do nothing. Same reasoning
 *     as GCP's role-less service account.
 *
 * ── What is NOT here, and why ──
 *
 * The GCP side has a hierarchical firewall policy — an organization-level rule
 * a project admin cannot override. AWS's equivalent is a **Service Control
 * Policy** in AWS Organizations, which denies the IAM *actions* that would undo
 * this (deleting NACL entries, attaching other security groups, assigning
 * public IPs). That is an account-level setting, not a VPC resource, so it is
 * in SETUP.md as a one-time step rather than here. Without it, isolation rests
 * on these rules not being edited — exactly the same residual risk the GCP
 * README states for a setup without an organization.
 */

locals {
  # Every private subnet this VPC has. The NACL is attached to all of them.
  subnet_ids = values(var.private_subnet_ids)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Layer 2 — the NACL. This is the isolation.
 * ──────────────────────────────────────────────────────────────────────────── */

resource "aws_network_acl" "customer" {
  vpc_id     = var.vpc_id
  subnet_ids = local.subnet_ids

  tags = {
    Name = "${var.name_prefix}-customer"
    Role = "customer-isolation"
  }
}

/*
 * ── Outbound: deny anything headed into this VPC ──
 *
 * Rule 100, below every allow, so it is matched first. A customer machine's
 * packet aimed at another customer machine dies here.
 *
 * Numbered in hundreds throughout so a rule can be inserted between two
 * existing ones later without renumbering the lot.
 */
resource "aws_network_acl_rule" "egress_deny_vpc" {
  network_acl_id = aws_network_acl.customer.id
  rule_number    = 100
  egress         = true
  protocol       = "-1"
  rule_action    = "deny"
  cidr_block     = var.vpc_cidr
}

/*
 * A deliberately narrow hole, for the rare case where machines genuinely must
 * talk — a shared cache, say. Empty by default, and every entry has to be a
 * /24 or smaller (enforced in variables.tf), so "allow the whole VPC" cannot be
 * typed in here by accident.
 *
 * Numbered BELOW the deny above, because first match wins.
 */
resource "aws_network_acl_rule" "egress_allow_exception" {
  for_each = var.internal_allow_cidrs

  network_acl_id = aws_network_acl.customer.id
  rule_number    = 50 + index(keys(var.internal_allow_cidrs), each.key)
  egress         = true
  protocol       = "-1"
  rule_action    = "allow"
  cidr_block     = each.value
}

/* Outbound to the internet is fine — that is how a model gets downloaded. */
resource "aws_network_acl_rule" "egress_allow_internet" {
  network_acl_id = aws_network_acl.customer.id
  rule_number    = 200
  egress         = true
  protocol       = "-1"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
}

/*
 * ── Inbound: deny anything from inside this VPC ──
 *
 * The mirror of the egress rule, and not redundant: a NACL is **stateless**, so
 * the reply to an allowed outbound connection has to be allowed back in
 * explicitly. That is what the ephemeral-port rule below does — and it is
 * exactly the hole an inbound VPC deny closes, because without it a machine
 * could reach another machine's high ports by dressing the packet up as a
 * reply.
 */
resource "aws_network_acl_rule" "ingress_deny_vpc" {
  network_acl_id = aws_network_acl.customer.id
  rule_number    = 100
  egress         = false
  protocol       = "-1"
  rule_action    = "deny"
  cidr_block     = var.vpc_cidr
}

resource "aws_network_acl_rule" "ingress_allow_exception" {
  for_each = var.internal_allow_cidrs

  network_acl_id = aws_network_acl.customer.id
  rule_number    = 50 + index(keys(var.internal_allow_cidrs), each.key)
  egress         = false
  protocol       = "-1"
  rule_action    = "allow"
  cidr_block     = each.value
}

/*
 * Replies to connections the machine itself opened. Restricted to the
 * ephemeral port range rather than all ports, so this cannot double as a way in
 * to anything a machine might be listening on.
 */
resource "aws_network_acl_rule" "ingress_allow_return" {
  network_acl_id = aws_network_acl.customer.id
  rule_number    = 200
  egress         = false
  protocol       = "tcp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 1024
  to_port        = 65535
}

resource "aws_network_acl_rule" "ingress_allow_return_udp" {
  network_acl_id = aws_network_acl.customer.id
  rule_number    = 210
  egress         = false
  protocol       = "udp"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  from_port      = 1024
  to_port        = 65535
}

/* ────────────────────────────────────────────────────────────────────────────
 * Layer 3 — the security group. Second line, not the first.
 * ──────────────────────────────────────────────────────────────────────────── */

resource "aws_security_group" "customer" {
  name        = "${var.name_prefix}-customer"
  description = "Customer machines. No inbound at all; outbound only to what a machine genuinely needs."
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-customer"
    Role = "customer-isolation"
  }

  lifecycle {
    # The group is referenced by every running instance; replacing it would
    # need them all stopped.
    create_before_destroy = true
  }
}

/*
 * ── No inbound rules exist, and that is the point ──
 *
 * A security group with no ingress rules denies all inbound traffic. Nothing is
 * written here deliberately — not even a self-referencing rule, which is what
 * AWS's default security group has and what makes every instance in the default
 * VPC reachable from every other.
 *
 * Administration does not need one: SSM Session Manager connects outbound.
 */

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.customer.id
  description       = "Fetch model weights, reach package registries, and talk to SSM."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "http" {
  security_group_id = aws_security_group.customer.id
  description       = "Some package mirrors are still plain HTTP."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "dns" {
  security_group_id = aws_security_group.customer.id
  description       = "DNS."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "ntp" {
  security_group_id = aws_security_group.customer.id
  description       = "Clock. A machine with the wrong time fails TLS and logs nonsense."
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "udp"
  from_port         = 123
  to_port           = 123
}

/*
 * Note what is absent: no egress rule for the VPC range. Even if the NACL were
 * somehow removed, this group allows a machine to reach ports 443/80/53/123 on
 * 0.0.0.0/0 — which does technically include the VPC — so the NACL is genuinely
 * load-bearing rather than decorative. Narrowing these four rules to exclude
 * the VPC range is possible but requires expressing "everything except
 * 10.30.0.0/16" as a list of CIDRs, which is long, easy to get wrong, and has
 * to be rewritten whenever the VPC range changes. The honest tradeoff is
 * recorded here and the NACL is what is tested.
 */
