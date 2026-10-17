/**
 * Outbound internet for machines that have no public address.
 *
 * Customer VMs are created with no external IP — that is what removes the
 * public attack surface entirely: there is no address on the internet that
 * resolves to a customer's machine, so there is no SSH port to brute-force and
 * no service to find with a scanner.
 *
 * But the workload still has to pull model weights and packages. Cloud NAT is
 * how: it gives outbound connectivity with no inbound counterpart. A NAT
 * gateway translates connections that originate inside; nothing outside can
 * start one. The firewall module already decides *which* outbound traffic is
 * allowed to get this far (HTTP/HTTPS/DNS/NTP only).
 *
 * One router and one NAT per region, scoped to the customer subnet alone, so
 * adding another subnet later is a deliberate act rather than something that
 * silently inherits internet access.
 */

resource "google_compute_router" "nat" {
  for_each = var.subnets

  project = var.project_id
  name    = "${var.name_prefix}-${each.key}-router"
  region  = each.key
  network = var.network_name

  description = "Carries Cloud NAT for customer VMs in ${each.key}. No BGP; routing is regional."
}

resource "google_compute_router_nat" "nat" {
  for_each = var.subnets

  project = var.project_id
  name    = "${var.name_prefix}-${each.key}-nat"
  region  = each.key
  router  = google_compute_router.nat[each.key].name

  # Let GCP allocate and scale the external addresses. A fixed pool would be
  # worth it only if an upstream needed to allowlist us, which nothing does.
  nat_ip_allocate_option = "AUTO_ONLY"

  # Named subnets, not ALL_SUBNETWORKS: a subnet added later does not get
  # internet access by accident.
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = each.value.self_link
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    # Errors only. Logging every translation on a box downloading a 140 GB
    # model would be expensive and would bury the one line that matters:
    # ports ran out, or a connection was dropped.
    filter = "ERRORS_ONLY"
  }

  # A machine pulling weights holds few connections for a long time, which is
  # the opposite of the default assumption. Fewer ports per VM, more VMs per
  # address; dynamic allocation raises it when a workload actually needs more.
  enable_dynamic_port_allocation = true
  min_ports_per_vm               = 64
  max_ports_per_vm               = 2048
}
