#!/usr/bin/env bash
#
# Proof that one customer's machine cannot reach another's — on AWS.
#
# The AWS twin of infra/gcp/tests/isolation-proof.sh, and it asks the same
# question in the same order: build two machines belonging to different
# "customers", try to make them talk, and then try to BREAK the isolation
# deliberately and check it still holds.
#
# A test that only checks the happy path proves the rules exist. It does not
# prove they are load-bearing. The last two checks are the ones that matter.
#
# AWS's analysis tool here is Reachability Analyzer, which answers from the
# actual VPC configuration — routes, NACLs, security groups — rather than by
# sending a packet. That is the right kind of answer: it is true even when a
# machine happens to be switched off.
#
# Usage:  ./infra/aws/tests/isolation-proof.sh <region> [vpc-id]
# Costs a few cents and about ten minutes.

set -euo pipefail

REGION="${1:?Usage: isolation-proof.sh <region> [vpc-id]}"
VPC_ID="${2:-}"

PREFIX="aiocean-isolation-test"
PASS=0
FAIL=0

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL + 1)); }
note() { printf '        %s\n' "$*"; }

aws_() { aws --region "$REGION" "$@"; }

# ── Find the pieces ──────────────────────────────────────────────────────────

if [ -z "$VPC_ID" ]; then
  VPC_ID=$(aws_ ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=aiocean-customer" \
    --query 'Vpcs[0].VpcId' --output text)
fi
[ "$VPC_ID" != "None" ] || { echo "No aiocean-customer VPC in $REGION. Apply infra/aws/live/<env> first."; exit 1; }

SG_ID=$(aws_ ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=aiocean-customer" \
  --query 'SecurityGroups[0].GroupId' --output text)

mapfile -t SUBNETS < <(aws_ ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Tier,Values=customer" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' '\n')

NACL_ID=$(aws_ ec2 describe-network-acls \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=association.subnet-id,Values=${SUBNETS[0]}" \
  --query 'NetworkAcls[0].NetworkAclId' --output text)

say "Using VPC $VPC_ID, security group $SG_ID, NACL $NACL_ID"

AMI=$(aws_ ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)

# ── Two machines, two "customers" ────────────────────────────────────────────

launch() {
  aws_ ec2 run-instances \
    --image-id "$AMI" --instance-type t3.micro \
    --subnet-id "${SUBNETS[0]}" --security-group-ids "$SG_ID" \
    --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$PREFIX-$1},{Key=team-id,Value=$1},{Key=managed-by,Value=aiocean}]" \
    --query 'Instances[0].InstanceId' --output text
}

say "Launching two machines belonging to different customers"
A=$(launch tenant-a)
B=$(launch tenant-b)
note "A = $A    B = $B"
aws_ ec2 wait instance-running --instance-ids "$A" "$B"

cleanup() {
  say "Cleaning up"
  aws_ ec2 terminate-instances --instance-ids "$A" "$B" >/dev/null 2>&1 || true
  aws_ ec2 delete-network-insights-path --network-insights-path-id "$PATH_ID" >/dev/null 2>&1 || true
  # Put the deny rule back if a check left it removed.
  aws_ ec2 describe-network-acls --network-acl-ids "$NACL_ID" \
    --query 'NetworkAcls[0].Entries[?RuleNumber==`100` && Egress==`true`]' --output text | grep -q . || {
    note "Restoring the egress deny rule"
    aws_ ec2 create-network-acl-entry --network-acl-id "$NACL_ID" \
      --rule-number 100 --egress --protocol -1 --rule-action deny \
      --cidr-block "$(aws_ ec2 describe-vpcs --vpc-ids "$VPC_ID" --query 'Vpcs[0].CidrBlock' --output text)" || true
  }
}
trap cleanup EXIT

# ── The analysis ─────────────────────────────────────────────────────────────

PATH_ID=$(aws_ ec2 create-network-insights-path \
  --source "$A" --destination "$B" --protocol tcp --destination-port 22 \
  --query 'NetworkInsightsPath.NetworkInsightsPathId' --output text)

analyse() {
  local id
  id=$(aws_ ec2 start-network-insights-analysis \
    --network-insights-path-id "$PATH_ID" \
    --query 'NetworkInsightsAnalysis.NetworkInsightsAnalysisId' --output text)
  aws_ ec2 wait network-insights-analysis-succeeded --network-insights-analysis-ids "$id" 2>/dev/null || true
  aws_ ec2 describe-network-insights-analyses --network-insights-analysis-ids "$id" \
    --query 'NetworkInsightsAnalyses[0].[NetworkPathFound,Explanations[0].ExplanationCode]' --output text
}

say "1. Can customer A reach customer B?"
read -r FOUND WHY <<<"$(analyse)"
if [ "$FOUND" = "False" ]; then
  ok "unreachable"
  # The same discipline as the GCP test: "unreachable" is not enough on its
  # own, because a machine that is merely switched off is also unreachable.
  # Something has to say it was a RULE that stopped it.
  if echo "$WHY" | grep -qi "ACL\|SECURITY_GROUP"; then
    ok "and a rule is what stopped it — $WHY"
  else
    bad "unreachable, but not because of a rule — $WHY"
    note "That is the wrong kind of pass. Check the NACL is attached to the subnet."
  fi
else
  bad "REACHABLE. Customer isolation is broken."
fi

say "2. Does a deliberately wide security group rule break it?"
note "Adding allow-all inbound from the whole VPC to the customer group."
VPC_CIDR=$(aws_ ec2 describe-vpcs --vpc-ids "$VPC_ID" --query 'Vpcs[0].CidrBlock' --output text)
aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol -1 --cidr "$VPC_CIDR" >/dev/null
read -r FOUND WHY <<<"$(analyse)"
if [ "$FOUND" = "False" ]; then
  ok "still unreachable — the NACL holds even with a wide group rule ($WHY)"
else
  bad "REACHABLE once a security group was loosened."
  note "This is the whole reason the deny lives in the NACL and not in a group."
fi
aws_ ec2 revoke-security-group-ingress --group-id "$SG_ID" \
  --protocol -1 --cidr "$VPC_CIDR" >/dev/null
note "Wide rule removed."

say "3. Is the NACL deny actually the thing doing the work?"
note "Removing the egress deny rule and re-testing."
aws_ ec2 delete-network-acl-entry --network-acl-id "$NACL_ID" --rule-number 100 --egress >/dev/null
read -r FOUND WHY <<<"$(analyse)"
if [ "$FOUND" = "True" ]; then
  ok "reachable without it — confirming the deny rule is load-bearing, not decorative"
else
  note "Still unreachable ($WHY) — something else is also blocking."
  note "Not a failure, but find out what, or you are trusting a rule you have not tested."
fi
aws_ ec2 create-network-acl-entry --network-acl-id "$NACL_ID" \
  --rule-number 100 --egress --protocol -1 --rule-action deny --cidr-block "$VPC_CIDR" >/dev/null
note "Deny rule restored."

say "4. Do these machines have public addresses?"
PUBLIC=$(aws_ ec2 describe-instances --instance-ids "$A" "$B" \
  --query 'Reservations[].Instances[].PublicIpAddress' --output text)
if [ -z "$PUBLIC" ] || [ "$PUBLIC" = "None" ]; then
  ok "no public IP on either machine"
else
  bad "a machine has a public address: $PUBLIC"
fi

say "5. Is IMDSv1 switched off?"
TOKENS=$(aws_ ec2 describe-instances --instance-ids "$A" \
  --query 'Reservations[0].Instances[0].MetadataOptions.HttpTokens' --output text)
if [ "$TOKENS" = "required" ]; then
  ok "IMDSv2 required — an SSRF bug cannot read the instance credentials"
else
  bad "IMDSv1 still allowed ($TOKENS). This is the classic credential-theft path."
fi

say "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
