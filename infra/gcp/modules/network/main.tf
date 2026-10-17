/**
 * Customer VM network.
 *
 * ── Why a custom-mode VPC, and never the `default` one ──
 *
 * Every GCP project is born with a VPC called `default`, and that VPC ships
 * with a firewall rule called `default-allow-internal` which permits all TCP,
 * UDP and ICMP between every address in 10.128.0.0/9. On this platform that one
 * rule would hand every customer a route to every other customer's machine.
 *
 * So we build our own. `auto_create_subnetworks = false` means no subnets and
 * no firewall rules appear unless this code asks for them, which makes the
 * isolation in ../firewall the complete and only statement of what may talk to
 * what. The `default` network should be deleted from the project by hand; see
 * ../../README.md.
 *
 * ── One subnet per region, and a deliberately small range ──
 *
 * Customer VMs have no external IP (see ../nat), so the only addresses that
 * matter are internal. A /20 is 4094 usable addresses per region, which is far
 * more machines than this platform will run in one region for a long time, and
 * keeping the ranges tight and non-overlapping leaves room to add regions
 * later without renumbering.
 *
 * Private Google Access is on so a machine with no external IP can still reach
 * Google APIs (Cloud Storage for model weights, Logging) without us opening a
 * path to the general internet for that traffic.
 */

resource "google_compute_network" "customer" {
  project     = var.project_id
  name        = var.network_name
  description = "Customer deployment VMs. Isolation is enforced in the firewall module; see infra/README.md."

  # The whole point: nothing exists until we say so.
  auto_create_subnetworks = false

  # Regional, not global, dynamic routing: a subnet's routes stay in its own
  # region. A machine in europe-west4 has no learned route toward us-east4,
  # which is one more thing standing between two customers.
  routing_mode = "REGIONAL"

  delete_default_routes_on_create = false
}

resource "google_compute_subnetwork" "customer" {
  for_each = var.subnets

  project       = var.project_id
  name          = "${var.network_name}-${each.key}"
  region        = each.key
  network       = google_compute_network.customer.id
  ip_cidr_range = each.value.cidr
  description   = "Customer VMs in ${each.key}"

  # Reach Google APIs without an external IP.
  private_ip_google_access = true

  # Flow logs are how an isolation claim is audited after the fact rather than
  # argued about. Sampled at 50% with 5-minute aggregation: enough to see that
  # VM-to-VM traffic is not happening, cheap enough to leave on.
  log_config {
    aggregation_interval = "INTERVAL_5_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}
