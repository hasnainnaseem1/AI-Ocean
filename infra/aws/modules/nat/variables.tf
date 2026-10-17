variable "name_prefix" {
  type    = string
  default = "aiocean"
}

variable "public_subnet_ids" {
  type        = map(string)
  description = "Where the NAT gateways go, keyed by availability zone."
}

variable "private_route_table_ids" {
  type        = map(string)
  description = "Customer subnets' route tables, keyed by AZ. Each gets a default route to the gateway in its own AZ."
}

variable "internet_gateway_id" {
  type        = string
  description = "The VPC's internet gateway. Depended on so the NAT gateway is not created before its route exists."
}
