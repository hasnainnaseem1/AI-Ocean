variable "project_id" {
  type = string
}

variable "network_name" {
  type = string
}

variable "name_prefix" {
  type    = string
  default = "aiocean-customer"
}

variable "subnets" {
  description = "region -> { self_link }. Pass the network module's subnet_self_links, reshaped, so NAT can never cover a subnet the network module did not create."
  type = map(object({
    self_link = string
  }))
}
