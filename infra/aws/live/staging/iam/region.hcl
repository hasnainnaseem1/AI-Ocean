/**
 * IAM is GLOBAL on AWS, so this unit sits outside the region folders.
 *
 * A role and an instance profile are account-wide: creating the same names in
 * three regions does not make three of them, it makes the second apply fail
 * with EntityAlreadyExists — and the third, and every one after.
 *
 * The provider still needs a region to talk to, so one is named here. Nothing
 * this unit builds lives in it; `us-east-1` is the conventional choice for
 * global AWS services and is used for no other reason.
 */

locals {
  region = "us-east-1"
  azs    = []
}
