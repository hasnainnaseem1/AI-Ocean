output "router_names" {
  value = { for k, r in google_compute_router.nat : k => r.name }
}

output "nat_names" {
  value = { for k, n in google_compute_router_nat.nat : k => n.name }
}
