/**
 * Customer VM isolation.
 *
 * The requirement this module exists to satisfy: **no customer's VM may reach
 * any other customer's VM, by any means.**
 *
 * ── Why GCP's defaults are not enough on their own ──
 *
 * GCP applies two implied rules to every VPC: ingress is denied at priority
 * 65535, and egress is allowed at priority 65535. So in an empty custom-mode
 * VPC, A already cannot open a connection to B, because B's ingress denies it.
 *
 * That is a true statement and a fragile one. It holds only for as long as
 * nobody adds a broad ingress allow — and "allow 10.0.0.0/8 so the monitoring
 * box can scrape" is the most natural rule in the world to write. One such rule
 * and every customer can see every other. Relying on the absence of a mistake
 * is not an isolation design.
 *
 * ── So isolation is stated twice, in opposite directions ──
 *
 * 1. Egress deny (priority 1000): a customer VM may not SEND to any private
 *    address. This is the load-bearing rule. It does not care what B's ingress
 *    rules say, now or in future, because the packet never leaves A.
 * 2. Ingress deny (priority 65000): explicit rather than implied, so an audit
 *    reads the intent instead of inferring it from silence.
 *
 * An attacker, or a future mistake, has to defeat BOTH to get A talking to B.
 * And on an organization (see ../org-firewall-policy) a third statement sits
 * above both, where nothing inside the project can reach it at all.
 *
 * ── Targeting by service account, not by network tag ──
 *
 * Every rule here targets `var.customer_service_account`. Network tags were the
 * obvious alternative and are the wrong one: a tag is just a string on the
 * instance, and anyone holding `compute.instances.setTags` can remove it —
 * including our own backend, which holds `compute.instanceAdmin.v1`. Changing
 * which service account an instance runs as needs `iam.serviceAccounts.actAs`
 * on that account, which is a far narrower permission and one the backend only
 * has for this single account. The rules therefore cannot be shrugged off by
 * the component most likely to have a bug in it.
 *
 * ── What is deliberately NOT here ──
 *
 * No `allow-internal` of any shape. No health-check ranges (nothing load
 * balances to customer VMs). No ICMP. If something later needs a path between
 * two machines, it goes in `var.internal_egress_allow` as a named, reviewed
 * exception — never as a broad range.
 */

locals {
  # Every private range, not merely the subnets that exist today. A subnet
  # added later, a VPC peering, a VPN to an office — all of them land inside
  # these three blocks, and all of them should be unreachable from a customer
  # VM unless somebody deliberately says otherwise.
  private_ranges = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]

  # Google's Identity-Aware Proxy forwards from this fixed range. It is the
  # only way in: customer VMs have no external IP, so there is no public SSH
  # port to find, and access is an IAM decision rather than a key on a laptop.
  iap_range = "35.235.240.0/20"
}

# ── 1. The load-bearing rule: a customer VM cannot send to a private address ──
#
# Priority 1000 beats the internet-egress allow at 1100, so traffic to
# 10.x/172.16.x/192.168.x is dropped at the source while traffic to the public
# internet is unaffected.
#
# This is what stops `nmap 10.0.0.0/20` from the inside, and it is why the
# isolation does not depend on any rule attached to the *destination* machine.
resource "google_compute_firewall" "deny_customer_to_private" {
  project     = var.project_id
  name        = "${var.name_prefix}-deny-egress-private"
  network     = var.network_name
  description = "Customer VMs may not reach any private address, including each other. See infra/gcp/modules/firewall/main.tf."

  direction          = "EGRESS"
  priority           = 1000
  destination_ranges = local.private_ranges

  target_service_accounts = [var.customer_service_account]

  deny {
    protocol = "all"
  }

  log_config {
    # Every blocked attempt is recorded. A customer VM trying to reach a
    # private range is either a misconfiguration or someone probing, and both
    # are worth being able to see after the fact.
    metadata = "INCLUDE_ALL_METADATA"
  }
}

# ── 2. Named exceptions, if the platform ever needs one ──
#
# Empty by default. Anything added here is a deliberate hole in rule 1 and
# should name exactly one destination and one port.
resource "google_compute_firewall" "allow_internal_exception" {
  for_each = var.internal_egress_allow

  project     = var.project_id
  name        = "${var.name_prefix}-allow-egress-${each.key}"
  network     = var.network_name
  description = "Reviewed exception: ${each.value.reason}"

  direction          = "EGRESS"
  priority           = 900 # beats the deny at 1000, deliberately and narrowly
  destination_ranges = [each.value.cidr]

  target_service_accounts = [var.customer_service_account]

  allow {
    protocol = each.value.protocol
    ports    = each.value.ports
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

# ── 3. Outbound to the internet, on the ports a workload actually needs ──
#
# HTTPS and HTTP for model weights and packages, DNS, and NTP. Everything else
# is left to the implied-allow... no: it is NOT, because this rule is an allow
# and the implied egress allow at 65535 would still permit the rest. The deny
# below it (rule 4) is what closes that.
#
# The point of the narrow port list is what it takes away: a compromised
# customer VM cannot send mail, cannot SSH out to scan the internet, and cannot
# reach a mining pool on a high port.
resource "google_compute_firewall" "allow_customer_internet" {
  project     = var.project_id
  name        = "${var.name_prefix}-allow-egress-internet"
  network     = var.network_name
  description = "Outbound HTTP(S)/DNS/NTP for model and package downloads."

  direction          = "EGRESS"
  priority           = 1100
  destination_ranges = ["0.0.0.0/0"]

  target_service_accounts = [var.customer_service_account]

  allow {
    protocol = "tcp"
    ports    = var.egress_tcp_ports
  }

  allow {
    protocol = "udp"
    ports    = var.egress_udp_ports
  }
}

# ── 4. Everything else outbound is denied ──
#
# Without this, GCP's implied egress-allow at 65535 would let a compromised VM
# talk out on any port it liked. Priority 1200 sits just below the allow above.
#
# This does not strand the machine. GCP treats DHCP, DNS, NTP and metadata
# requests to 169.254.169.254 as always-allowed and firewall rules cannot block
# them, so a VM still boots, resolves names and keeps time under a deny-all.
# The TCP/UDP allows above are for reaching resolvers and mirrors on the public
# internet, not for keeping the instance alive.
resource "google_compute_firewall" "deny_customer_egress_rest" {
  project     = var.project_id
  name        = "${var.name_prefix}-deny-egress-rest"
  network     = var.network_name
  description = "Anything not explicitly allowed above does not leave a customer VM."

  direction          = "EGRESS"
  priority           = 1200
  destination_ranges = ["0.0.0.0/0"]

  target_service_accounts = [var.customer_service_account]

  deny {
    protocol = "all"
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

# ── 5. The only way in: IAP ──
#
# Admin SSH arrives through Google's Identity-Aware Proxy, so reaching a
# customer machine requires an IAM role on our project rather than a network
# position and a key. Priority 900 so it survives the explicit ingress deny.
resource "google_compute_firewall" "allow_iap_ssh" {
  project     = var.project_id
  name        = "${var.name_prefix}-allow-ingress-iap-ssh"
  network     = var.network_name
  description = "Admin SSH via Identity-Aware Proxy only. Customer VMs have no public IP."

  direction     = "INGRESS"
  priority      = 900
  source_ranges = [local.iap_range]

  target_service_accounts = [var.customer_service_account]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}

# ── 6. Explicit ingress deny ──
#
# GCP already denies ingress at 65535. Saying it at 65000 changes nothing about
# the packets and everything about the audit: the intent is written down, and
# `gcloud compute firewall-rules list` shows isolation rather than an absence.
resource "google_compute_firewall" "deny_customer_ingress" {
  project     = var.project_id
  name        = "${var.name_prefix}-deny-ingress-all"
  network     = var.network_name
  description = "Nothing reaches a customer VM except IAP. Stated explicitly; GCP would imply it."

  direction     = "INGRESS"
  priority      = 65000
  source_ranges = ["0.0.0.0/0"]

  target_service_accounts = [var.customer_service_account]

  deny {
    protocol = "all"
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}
