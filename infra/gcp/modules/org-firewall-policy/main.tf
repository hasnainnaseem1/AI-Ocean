/**
 * The isolation rule that the project cannot talk its way out of.
 *
 * ── Why this exists on top of ../firewall ──
 *
 * The VPC rules in ../firewall are correct, and they are also *editable by
 * anyone holding compute.securityAdmin on the project*. That includes a future
 * teammate debugging something at 2am, and it includes our own Terraform if
 * somebody changes a variable without understanding it. An isolation guarantee
 * that one `gcloud compute firewall-rules create` can undo is a guarantee with
 * a footnote.
 *
 * Hierarchical firewall policies are evaluated BEFORE any VPC firewall rule,
 * and they live on the folder or organization — outside the project, where
 * project-level IAM does not reach. A `deny` here is final: no rule inside the
 * project can override it, because nothing inside the project is consulted
 * once this one matches.
 *
 * So the same statement is made twice, at two levels of authority. The project
 * rule is the one that explains itself in the console where people look; this
 * one is the one that holds when the first is wrong.
 *
 * ── This module is optional, and the reason matters ──
 *
 * Hierarchical policies require a GCP **organization**, which requires a
 * verified domain and Cloud Identity. A standalone project cannot have one.
 * If the platform is running without an organization (Raasta B in
 * ../../SETUP.md), this module is simply not instantiated — and the isolation
 * then rests on the project rules alone, which is a real reduction in
 * assurance and is recorded as such in ../../README.md.
 */

resource "google_compute_firewall_policy" "isolation" {
  count = var.enabled ? 1 : 0

  parent      = var.parent
  short_name  = var.policy_name
  description = "Customer VM isolation that project-level rules cannot override. See infra/gcp/modules/org-firewall-policy/main.tf."
}

/**
 * Deny every customer VM from sending to any private address.
 *
 * Deliberately the same statement as the project's `deny-egress-private`, in
 * the same direction, for the same targets. Duplication is the point: these two
 * are independent, and defeating one leaves the other standing.
 *
 * Priority 100 is low (= evaluated early) within the policy, so a permissive
 * rule added to this policy later cannot be slipped in above it without being
 * obvious in review.
 */
resource "google_compute_firewall_policy_rule" "deny_customer_to_private" {
  count = var.enabled ? 1 : 0

  firewall_policy = google_compute_firewall_policy.isolation[0].id
  description     = "No customer VM may reach a private address, including another customer's VM."
  priority        = 100
  direction       = "EGRESS"
  action          = "deny"
  enable_logging  = true

  # Only machines running as the customer runtime account. Platform
  # infrastructure in the same folder is untouched.
  target_service_accounts = [var.customer_service_account]

  match {
    dest_ip_ranges = var.private_ranges

    layer4_configs {
      ip_protocol = "all"
    }
  }
}

/**
 * Attaching the policy is what makes it take effect. A policy that exists but
 * is associated with nothing is a document, not a control.
 */
resource "google_compute_firewall_policy_association" "attach" {
  count = var.enabled ? 1 : 0

  firewall_policy   = google_compute_firewall_policy.isolation[0].id
  attachment_target = var.parent
  name              = "${var.policy_name}-attachment"
}
