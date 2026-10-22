output "customer_instance_profile_name" {
  value       = aws_iam_instance_profile.customer_vm.name
  description = "Every customer instance launches with this profile. Paste it into the admin center."
}

output "customer_instance_profile_arn" {
  value       = aws_iam_instance_profile.customer_vm.arn
  description = "The same thing, in ARN form."
}

output "customer_role_arn" {
  value       = aws_iam_role.customer_vm.arn
  description = "The role behind the profile. SSM only."
}

output "platform_policy_arn" {
  value       = aws_iam_policy.platform_runtime.arn
  description = "Attach this to whatever identity the backend uses, if you did not create the user here."
}

output "platform_user_name" {
  value       = var.create_platform_user ? aws_iam_user.platform_runtime[0].name : null
  description = "Create an access key for this user by hand — Terraform must never hold one in state."
}

output "region_builder_user_name" {
  value       = var.create_build_user ? aws_iam_user.region_builder[0].name : null
  description = <<-EOT
    The build worker's identity. Create an access key for it by hand — Terraform
    must never hold one in state — and put that key ONLY in the environment of
    the region build worker, never in the API's .env and never in the database.
  EOT
}

output "region_builder_policy_arn" {
  value       = var.create_build_user ? aws_iam_policy.region_builder[0].arn : null
  description = "Attach this to a role instead, if the worker assumes one rather than using a key."
}
