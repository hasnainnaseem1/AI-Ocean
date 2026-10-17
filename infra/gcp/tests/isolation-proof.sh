#!/usr/bin/env bash
#
# Proof that one customer's VM cannot reach another customer's VM.
#
# This is the exit test for the GCP-INFRA phase. It is not a smoke test — it is
# the artifact that says the isolation requirement is met, and its output
# should be kept with the release it was run against.
#
# Three things are proved, in increasing order of how much they tell you:
#
#   A. Two customer VMs cannot reach each other, and the connectivity test
#      NAMES the rule that stopped it. A bare "unreachable" proves nothing —
#      a typo'd address is also unreachable.
#   B. Adding a deliberately permissive ingress rule does NOT open the path.
#      This is what separates "we have no allow rule" from "we have a deny
#      rule", and it is the difference between isolation and luck.
#   C. (organization only) Deleting the project's own deny rule does NOT open
#      the path either, because the folder-level policy is doing the work.
#      This proves the control survives a mistake made inside the project.
#
# Usage:
#   ./isolation-proof.sh <project-id> <region> [--keep]
#
# Everything it creates is prefixed `isoproof-` and is removed on exit, including
# on failure or Ctrl-C. --keep leaves the VMs up for manual poking.

set -euo pipefail

PROJECT="${1:?usage: isolation-proof.sh <project-id> <region> [--keep]}"
REGION="${2:?usage: isolation-proof.sh <project-id> <region> [--keep]}"
KEEP="${3:-}"

ZONE="${REGION}-b"
PREFIX="isoproof"
VM_A="${PREFIX}-tenant-a"
VM_B="${PREFIX}-tenant-b"
NETWORK="aiocean-customer"
SUBNET="${NETWORK}-${REGION}"
SA="customer-vm@${PROJECT}.iam.gserviceaccount.com"
PROBE_RULE="${PREFIX}-deliberately-permissive"
DENY_RULE="aiocean-customer-deny-egress-private"

pass=0
fail=0
ok()   { pass=$((pass+1)); echo "  PASS  $1${2:+ — $2}"; }
bad()  { fail=$((fail+1)); echo "  FAIL  $1${2:+ — $2}"; }
note() { echo "        $1"; }

cleanup() {
  if [[ "$KEEP" == "--keep" ]]; then
    echo; echo "--keep given; leaving ${VM_A}, ${VM_B} and any probe rule in place."
    return
  fi
  echo; echo "== Cleaning up =="
  gcloud compute firewall-rules delete "$PROBE_RULE" --project="$PROJECT" -q 2>/dev/null || true
  for t in a-to-b b-to-a; do
    gcloud network-management connectivity-tests delete "${PREFIX}-${t}" --project="$PROJECT" -q 2>/dev/null || true
  done
  gcloud compute instances delete "$VM_A" "$VM_B" --project="$PROJECT" --zone="$ZONE" -q 2>/dev/null || true
  echo "        done"
}
trap cleanup EXIT

# Create a VM exactly the way the platform's provisioning driver will: no
# external address, the role-less runtime account, no project SSH keys, no IP
# forwarding, shielded. If the proof passed against a softer VM it would prove
# nothing about the real ones.
make_vm() {
  local name="$1" team="$2"
  gcloud compute instances create "$name" \
    --project="$PROJECT" --zone="$ZONE" \
    --machine-type=e2-micro \
    --subnet="$SUBNET" --no-address \
    --service-account="$SA" --scopes="" \
    --no-can-ip-forward \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata=block-project-ssh-keys=TRUE,enable-oslogin=TRUE \
    --labels="managed-by=aiocean,purpose=isolation-proof,team-id=${team}" \
    --image-family=debian-12 --image-project=debian-cloud \
    --quiet >/dev/null
}

# Returns "RESULT|rule-that-blocked-it".
probe() {
  local name="$1" src="$2" dst="$3"
  gcloud network-management connectivity-tests delete "$name" --project="$PROJECT" -q 2>/dev/null || true
  gcloud network-management connectivity-tests create "$name" \
    --project="$PROJECT" \
    --source-instance="projects/${PROJECT}/zones/${ZONE}/instances/${src}" \
    --destination-instance="projects/${PROJECT}/zones/${ZONE}/instances/${dst}" \
    --protocol=TCP --destination-port=22 \
    --quiet >/dev/null 2>&1
  # The API re-runs the analysis on describe; give it a moment to settle.
  sleep 12
  local json
  json=$(gcloud network-management connectivity-tests describe "$name" \
           --project="$PROJECT" --format=json)
  local result rule
  result=$(echo "$json" | python -c "import sys,json;d=json.load(sys.stdin);print(d.get('reachabilityDetails',{}).get('result','UNKNOWN'))" 2>/dev/null || echo UNKNOWN)
  rule=$(echo "$json" | python -c "
import sys,json
d=json.load(sys.stdin)
names=set()
for t in d.get('reachabilityDetails',{}).get('traces',[]):
    for s in t.get('steps',[]):
        fw=s.get('firewall') or {}
        if fw.get('displayName'): names.add(fw['displayName'])
        if fw.get('uri'): names.add(fw['uri'].rsplit('/',1)[-1])
print(','.join(sorted(names)) or '(none named)')
" 2>/dev/null || echo "(parse failed)")
  echo "${result}|${rule}"
}

echo "== Setting up two tenants in ${PROJECT}/${ZONE} =="
make_vm "$VM_A" "tenant-a"
make_vm "$VM_B" "tenant-b"
IP_B=$(gcloud compute instances describe "$VM_B" --project="$PROJECT" --zone="$ZONE" \
         --format='value(networkInterfaces[0].networkIP)')
note "VM A and VM B are up; B is at ${IP_B}"

echo
echo "== A. Can one tenant reach the other? =="
r=$(probe "${PREFIX}-a-to-b" "$VM_A" "$VM_B"); res="${r%%|*}"; rule="${r##*|}"
[[ "$res" == "UNREACHABLE" ]] \
  && ok "A cannot reach B" "result=${res}" \
  || bad "A cannot reach B" "expected UNREACHABLE, got ${res}"
[[ "$rule" == *"deny"* ]] \
  && ok "and a deny rule is named as the cause" "$rule" \
  || bad "a deny rule is named as the cause" "got: ${rule}"

r=$(probe "${PREFIX}-b-to-a" "$VM_B" "$VM_A"); res="${r%%|*}"
[[ "$res" == "UNREACHABLE" ]] \
  && ok "B cannot reach A either" "result=${res}" \
  || bad "B cannot reach A either" "expected UNREACHABLE, got ${res}"

echo
echo "== B. Does a deliberately permissive rule open it? =="
note "Adding 'allow ingress from 10.0.0.0/8' at priority 1000 — the exact mistake"
note "a teammate would make. The egress deny should still hold."
gcloud compute firewall-rules create "$PROBE_RULE" \
  --project="$PROJECT" --network="$NETWORK" \
  --direction=INGRESS --priority=1000 \
  --source-ranges=10.0.0.0/8 --allow=tcp,udp,icmp \
  --target-service-accounts="$SA" \
  --description="isolation-proof probe; deleted automatically" \
  --quiet >/dev/null
r=$(probe "${PREFIX}-a-to-b" "$VM_A" "$VM_B"); res="${r%%|*}"; rule="${r##*|}"
[[ "$res" == "UNREACHABLE" ]] \
  && ok "still unreachable with a broad ingress allow in place" "blocked by ${rule}" \
  || bad "still unreachable with a broad ingress allow in place" "ISOLATION BROKE: ${res}"
gcloud compute firewall-rules delete "$PROBE_RULE" --project="$PROJECT" -q >/dev/null

echo
echo "== C. Does the project's own deny rule have to exist? =="
if gcloud compute firewall-policies list --format='value(name)' 2>/dev/null | grep -q .; then
  note "A hierarchical policy exists. Removing the PROJECT deny rule; the"
  note "folder-level policy should still block the traffic on its own."
  gcloud compute firewall-rules delete "$DENY_RULE" --project="$PROJECT" -q >/dev/null 2>&1 || true
  r=$(probe "${PREFIX}-a-to-b" "$VM_A" "$VM_B"); res="${r%%|*}"; rule="${r##*|}"
  [[ "$res" == "UNREACHABLE" ]] \
    && ok "still unreachable without the project rule" "blocked by ${rule}" \
    || bad "still unreachable without the project rule" "ISOLATION BROKE: ${res}"
  note "Re-apply the project rule now:  cd infra/gcp/live/staging/firewall && terragrunt apply"
else
  echo "  SKIP  no hierarchical firewall policy on this project (Raasta B)."
  note "Isolation here rests on the project-level rules alone. Case B above"
  note "shows they hold against a permissive ingress rule, but nothing stops"
  note "someone with compute.securityAdmin deleting the deny rule itself."
  note "See infra/README.md, 'What this does not protect against'."
fi

echo
echo "${pass}/$((pass+fail)) passed${fail:+, ${fail} FAILED}"
[[ $fail -eq 0 ]] || { echo; echo "Isolation is NOT proven. Do not provision customer VMs."; exit 1; }
echo "Isolation proven for ${PROJECT} on $(date -u +%Y-%m-%dT%H:%MZ)."
