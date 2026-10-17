/**
 * What a customer machine is allowed to do, which is almost nothing.
 *
 * ── The role-less machine ──
 *
 * Every EC2 instance that can reach the metadata service can read whatever
 * credentials its instance profile holds. So the profile a customer machine
 * runs with holds the narrowest thing that still works: permission for SSM
 * Session Manager, and nothing else. No S3, no EC2, no reading other machines,
 * no secrets.
 *
 * If a customer's model, or something they install, is broken into, the
 * credentials it finds can open an administration session to the machine the
 * attacker is already on. That is the whole blast radius.
 *
 * This mirrors the GCP side's `customer-vm` service account, which has no IAM
 * role at all. AWS needs the one SSM policy because that is how a machine is
 * administered without an inbound SSH port — on GCP, IAP provides the same
 * thing without needing a role on the VM.
 *
 * ── The platform's own role ──
 *
 * Separate, and also narrow: it can create, describe, stop and terminate
 * instances, and pass the customer profile to them. It deliberately cannot
 * touch networking — a compromised backend credential must not be able to
 * delete the NACL that keeps customers apart.
 */

/* ── The machine's own identity ──────────────────────────────────────────── */

resource "aws_iam_role" "customer_vm" {
  name        = "${var.name_prefix}-customer-vm"
  description = "Every customer machine runs as this. SSM only — nothing else."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Role = "customer-vm"
  }
}

/*
 * AWS's own managed policy for Session Manager. Using the managed one rather
 * than a hand-written copy means it keeps working when AWS adds an action the
 * agent needs; a hand-rolled version silently breaks administration months
 * later, which is when it is least convenient to discover.
 */
resource "aws_iam_role_policy_attachment" "customer_vm_ssm" {
  role       = aws_iam_role.customer_vm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "customer_vm" {
  name = "${var.name_prefix}-customer-vm"
  role = aws_iam_role.customer_vm.name
}

/* ── The platform's own identity ─────────────────────────────────────────── */

resource "aws_iam_user" "platform_runtime" {
  count = var.create_platform_user ? 1 : 0

  name = "${var.name_prefix}-platform-runtime"

  tags = {
    Role = "platform-runtime"
  }
}

data "aws_iam_policy_document" "platform_runtime" {
  # Run machines, and nothing else.
  statement {
    sid    = "ManageCustomerInstances"
    effect = "Allow"
    actions = [
      "ec2:RunInstances",
      "ec2:TerminateInstances",
      "ec2:StopInstances",
      "ec2:StartInstances",
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
      "ec2:DescribeInstanceTypes",
      "ec2:DescribeImages",
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeAvailabilityZones",
      "ec2:CreateTags",
      "ec2:DescribeVolumes",
      "ec2:DeleteVolume",
    ]
    resources = ["*"]
  }

  /*
   * Handing the customer profile to a machine. Scoped to that one role, so a
   * leaked platform credential cannot start an instance wearing a more
   * powerful identity — which is the classic iam:PassRole escalation.
   */
  statement {
    sid       = "PassOnlyTheCustomerProfile"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.customer_vm.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ec2.amazonaws.com"]
    }
  }

  # Reading prices. The pricing API is global and read-only.
  statement {
    sid    = "ReadPrices"
    effect = "Allow"
    actions = [
      "pricing:GetProducts",
      "pricing:DescribeServices",
      "pricing:GetAttributeValues",
    ]
    resources = ["*"]
  }

  /*
   * ── The important half: what it must NOT be able to do ──
   *
   * An explicit deny beats any allow, anywhere, including a future one added
   * by mistake. The backend creates machines; it has no business editing the
   * network those machines sit in, and a credential that leaks out of the
   * backend must not be able to take the isolation apart.
   *
   * ── Every entry here is a VERB, never a noun ──
   *
   * The obvious way to write this is `ec2:*SecurityGroup*` and `iam:*`. Both
   * are wrong, and wrong in a way that only shows up the first time a customer
   * deploys:
   *
   *   - `ec2:*SecurityGroup*` also matches `ec2:DescribeSecurityGroups`, and
   *     `ec2:*Subnet*` also matches `ec2:DescribeSubnets` — both of which the
   *     allow above needs to launch anything. Deny beats allow, so the backend
   *     would be unable to read the network it is launching into.
   *   - `iam:*` also matches `iam:PassRole`, which is the one IAM action the
   *     backend genuinely needs — without it no instance can be given the
   *     customer profile at all.
   *
   * So the denies name mutating actions explicitly. Reading is always fine;
   * changing never is.
   */
  statement {
    sid    = "NeverChangeTheIsolation"
    effect = "Deny"
    actions = [
      # The NACL is the isolation. Nothing the backend does should touch it.
      "ec2:CreateNetworkAcl",
      "ec2:CreateNetworkAclEntry",
      "ec2:DeleteNetworkAcl",
      "ec2:DeleteNetworkAclEntry",
      "ec2:ReplaceNetworkAclEntry",
      "ec2:ReplaceNetworkAclAssociation",

      # Security groups: the backend attaches the existing one at launch, and
      # never creates, edits or deletes a group.
      "ec2:CreateSecurityGroup",
      "ec2:DeleteSecurityGroup",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:ModifySecurityGroupRules",

      # The network itself.
      "ec2:CreateVpc",
      "ec2:DeleteVpc",
      "ec2:ModifyVpcAttribute",
      "ec2:CreateSubnet",
      "ec2:DeleteSubnet",
      "ec2:ModifySubnetAttribute",
      "ec2:CreateRoute",
      "ec2:DeleteRoute",
      "ec2:ReplaceRoute",
      "ec2:CreateRouteTable",
      "ec2:DeleteRouteTable",
      "ec2:AssociateRouteTable",
      "ec2:DisassociateRouteTable",
      "ec2:CreateInternetGateway",
      "ec2:DeleteInternetGateway",
      "ec2:AttachInternetGateway",
      "ec2:DetachInternetGateway",
      "ec2:CreateNatGateway",
      "ec2:DeleteNatGateway",

      # A public IP is the one instance attribute that would undo "no inbound
      # path", so it is denied even though RunInstances is allowed.
      "ec2:AssociateAddress",
      "ec2:AllocateAddress",

      # IAM, minus PassRole, which the allow above needs and scopes to one role.
      "iam:Create*",
      "iam:Delete*",
      "iam:Update*",
      "iam:Put*",
      "iam:Attach*",
      "iam:Detach*",
      "iam:AddRoleToInstanceProfile",
      "iam:RemoveRoleFromInstanceProfile",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "platform_runtime" {
  name        = "${var.name_prefix}-platform-runtime"
  description = "Run and destroy customer machines. Explicitly cannot touch networking or IAM."
  policy      = data.aws_iam_policy_document.platform_runtime.json
}

resource "aws_iam_user_policy_attachment" "platform_runtime" {
  count = var.create_platform_user ? 1 : 0

  user       = aws_iam_user.platform_runtime[0].name
  policy_arn = aws_iam_policy.platform_runtime.arn
}
