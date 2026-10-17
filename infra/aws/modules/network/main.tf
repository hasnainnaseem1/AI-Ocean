/**
 * The one VPC every customer machine runs in.
 *
 * ── Never the default VPC ──
 *
 * AWS gives every account a default VPC, and it comes with a default security
 * group whose rules allow **all traffic from itself** — meaning every instance
 * placed in it can reach every other instance in it, on every port. That one
 * rule is the whole of customer isolation gone, and it is there by default,
 * which is why this module builds its own VPC and the security module never
 * uses the default group. (The GCP side avoids exactly the same trap with
 * `default-allow-internal`.)
 *
 * ── Private subnets only ──
 *
 * Customer machines get no public IP, ever. `map_public_ip_on_launch` is false
 * so that an instance launched without explicitly asking for a public address
 * does not quietly get one anyway. Egress to the internet goes through the NAT
 * gateway in the `nat` module; administration goes through SSM Session Manager,
 * so there is no inbound path at all and nothing listening on 22.
 *
 * A public subnet exists per AZ too, but only because a NAT gateway has to live
 * in one. No customer machine is ever placed there.
 */

locals {
  # One private and one public subnet per availability zone. Two AZs is the
  # minimum worth having: a single-AZ outage is the common AWS failure, and
  # spreading machines costs nothing extra.
  azs = var.availability_zones
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  # Needed for SSM and for private DNS to resolve interface endpoints.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = var.network_name
  }
}

/*
 * Customer machines live here. No route to an internet gateway — the only way
 * out is the NAT gateway, which the `nat` module adds a route for.
 */
resource "aws_subnet" "private" {
  for_each = { for idx, az in local.azs : az => idx }

  vpc_id            = aws_vpc.main.id
  availability_zone = each.key

  # Carved out of the first half of the VPC range, one /20 per AZ.
  cidr_block = cidrsubnet(var.vpc_cidr, var.subnet_newbits, each.value)

  # The important one. An instance launched here never gets a public address,
  # even if whoever launched it forgot to say so.
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.network_name}-private-${each.key}"
    Tier = "customer"
  }
}

/*
 * Only the NAT gateway and its elastic IP live here. Numbered from the far end
 * of the VPC range so the private subnets can grow without renumbering.
 */
resource "aws_subnet" "public" {
  for_each = { for idx, az in local.azs : az => idx }

  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.vpc_cidr, var.subnet_newbits, each.value + var.public_subnet_offset)

  # False here too. The NAT gateway gets an elastic IP explicitly; nothing else
  # in this subnet should ever be reachable.
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.network_name}-public-${each.key}"
    Tier = "egress"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.network_name}-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${var.network_name}-public"
  }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

/*
 * One route table per private subnet, with no default route yet. The `nat`
 * module adds the 0.0.0.0/0 route to its gateway.
 *
 * Per-subnet rather than shared, because a NAT gateway lives in one AZ: a
 * shared table would send every AZ's traffic through one gateway, so an AZ
 * outage would take out egress for machines that were otherwise fine, and
 * cross-AZ data transfer would be billed for all of it.
 */
resource "aws_route_table" "private" {
  for_each = aws_subnet.private

  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.network_name}-private-${each.key}"
  }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

/*
 * ── VPC flow logs ──
 *
 * Not for debugging. This is the only way to answer "did machine A ever reach
 * machine B" after the fact, and that question is the whole isolation claim.
 * Without it the answer is "the rules say no", which is a design document, not
 * evidence.
 */
resource "aws_flow_log" "main" {
  count = var.enable_flow_logs ? 1 : 0

  vpc_id          = aws_vpc.main.id
  traffic_type    = "ALL"
  iam_role_arn    = aws_iam_role.flow_logs[0].arn
  log_destination = aws_cloudwatch_log_group.flow_logs[0].arn
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name              = "/aiocean/${var.network_name}/flow-logs"
  retention_in_days = var.flow_log_retention_days
}

resource "aws_iam_role" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name = "${var.network_name}-flow-logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name = "write-flow-logs"
  role = aws_iam_role.flow_logs[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Resource = "${aws_cloudwatch_log_group.flow_logs[0].arn}:*"
    }]
  })
}
