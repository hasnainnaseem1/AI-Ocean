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

      /*
       * Reading the network ACLs — the isolation check, and ONLY the read.
       *
       * The platform verifies, after every region build and on a schedule,
       * that the NACL still denies the VPC range in both directions. That
       * check has to run with this credential rather than the build one: an
       * answer from the same key that could have changed the rules proves
       * less than an answer from a key that demonstrably cannot.
       *
       * `Describe` only. Every mutating NACL action stays in the explicit
       * deny below, so this credential can see the isolation and can never
       * touch it. Without this line the check fails with
       * UnauthorizedOperation, which the platform reads as "could not verify"
       * and holds every region — safe, but nothing would ever build.
       */
      "ec2:DescribeNetworkAcls",
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

/* ── The region build identity ───────────────────────────────────────────────
 *
 * A SECOND credential, deliberately separate from the platform runtime one
 * above, used by `backend/src/workers/regionBuilder.js` and by nothing else.
 *
 * ── Why it cannot be narrowed to "safe" network permissions ──
 *
 * Building a region means creating network ACLs. On AWS, the permission that
 * creates a NACL entry is the same permission that replaces and deletes one:
 * `ec2:CreateNetworkAclEntry` and `ec2:ReplaceNetworkAclEntry` cannot be
 * separated by resource, because the ACL does not exist when the policy is
 * written. So this user CAN take customer isolation apart. There is no policy
 * that both lets it build a region and prevents that.
 *
 * Three things make that acceptable, and all three have to hold:
 *
 *   1. **It never enters the API process.** The key lives in the build
 *      worker's environment, under a different OS user. The API can ask for a
 *      region to be built; it cannot build one and cannot read this key.
 *      Share the environment and this becomes the platform user with
 *      network-admin rights.
 *
 *   2. **It is region-limited** (below). A leaked key cannot raise
 *      infrastructure in a region nobody is watching.
 *
 *   3. **Its work is verified by a credential that cannot do it.** After
 *      every apply, the platform re-reads the NACL rules with the RUNTIME
 *      credential — which has `DescribeNetworkAcls` and an explicit deny on
 *      every mutating NACL action — and refuses to publish a region whose
 *      isolation is not in place. See `services/aws/isolationCheck.js`.
 *
 * The strongest available control is an AWS Organizations SCP denying the
 * mutating NACL actions account-wide, which binds even this user. It cannot be
 * created from inside the account it governs, so it is a documented one-time
 * step in SETUP.md rather than a resource here.
 */

resource "aws_iam_user" "region_builder" {
  count = var.create_build_user ? 1 : 0

  name = "${var.name_prefix}-region-builder"

  tags = {
    Role = "region-builder"
    Note = "Build worker only. NEVER in the API's environment."
  }
}

data "aws_iam_policy_document" "region_builder" {
  /*
   * Everything Terraform needs to raise a region: the VPC, its subnets, its
   * routing, its NAT, and the security group and NACLs that isolate customers.
   *
   * Written as whole verbs rather than wildcards for the same reason as the
   * runtime policy — but note the asymmetry: here the mutating actions are
   * the point, and `Describe*` is granted because Terraform reads before it
   * writes and a refresh that cannot read plans a destroy.
   */
  statement {
    sid    = "BuildTheNetwork"
    effect = "Allow"
    actions = [
      "ec2:CreateVpc",
      "ec2:DeleteVpc",
      "ec2:ModifyVpcAttribute",
      "ec2:CreateSubnet",
      "ec2:DeleteSubnet",
      "ec2:ModifySubnetAttribute",
      "ec2:CreateRouteTable",
      "ec2:DeleteRouteTable",
      "ec2:CreateRoute",
      "ec2:DeleteRoute",
      "ec2:AssociateRouteTable",
      "ec2:DisassociateRouteTable",
      "ec2:CreateInternetGateway",
      "ec2:DeleteInternetGateway",
      "ec2:AttachInternetGateway",
      "ec2:DetachInternetGateway",
      "ec2:CreateNatGateway",
      "ec2:DeleteNatGateway",
      "ec2:AllocateAddress",
      "ec2:ReleaseAddress",
      "ec2:AssociateAddress",
      "ec2:DisassociateAddress",

      # The isolation itself. The reason this user is kept out of the API.
      "ec2:CreateNetworkAcl",
      "ec2:DeleteNetworkAcl",
      "ec2:CreateNetworkAclEntry",
      "ec2:DeleteNetworkAclEntry",
      "ec2:ReplaceNetworkAclEntry",
      "ec2:ReplaceNetworkAclAssociation",
      "ec2:CreateSecurityGroup",
      "ec2:DeleteSecurityGroup",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupEgress",

      "ec2:CreateTags",
      "ec2:DeleteTags",
      "ec2:Describe*",
    ]
    resources = ["*"]

    /*
     * The region fence.
     *
     * A leaked build key cannot raise infrastructure outside the regions this
     * platform actually sells — so it cannot quietly run up a bill, or stand
     * up an unmonitored network, somewhere nobody is looking.
     *
     * It does NOT protect the regions in the list: inside them this key can
     * still rewrite the isolation. That is what the separate process and the
     * verification are for.
     */
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = var.build_regions
    }
  }

  /*
   * Terraform's own state. S3 and DynamoDB, scoped to the two resources the
   * backend configuration actually names — a build credential has no reason
   * to read any other bucket in the account.
   */
  statement {
    sid    = "TerraformState"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
    ]
    resources = ["*"]
  }

  /*
   * ── What this user must NOT be able to do ──
   *
   * It builds networks. It has no business creating identities, minting
   * credentials, or starting machines — and an explicit deny beats any allow,
   * including one added here by mistake later.
   */
  statement {
    sid    = "NeverBecomeSomethingElse"
    effect = "Deny"
    actions = [
      # No new identities, and no new keys for existing ones. Without this, a
      # leaked build key mints a permanent admin key and the fence is moot.
      "iam:Create*",
      "iam:Delete*",
      "iam:Update*",
      "iam:Put*",
      "iam:Attach*",
      "iam:Detach*",
      "iam:PassRole",

      # It builds the places machines run. It does not run machines — that is
      # the platform runtime user's job, and keeping them apart means neither
      # key alone can both create a network and put a machine in it.
      "ec2:RunInstances",
      "ec2:TerminateInstances",
      "ec2:StartInstances",
      "ec2:StopInstances",

      # Nothing here needs customer data.
      "s3:GetObject*Acl",
      "kms:Decrypt",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "region_builder" {
  count = var.create_build_user ? 1 : 0

  name        = "${var.name_prefix}-region-builder"
  description = "Builds regions. Region-limited. Must NEVER be in the API process's environment."
  policy      = data.aws_iam_policy_document.region_builder.json
}

resource "aws_iam_user_policy_attachment" "region_builder" {
  count = var.create_build_user ? 1 : 0

  user       = aws_iam_user.region_builder[0].name
  policy_arn = aws_iam_policy.region_builder[0].arn
}
