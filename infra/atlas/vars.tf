variable "atlas_org_id" {
  description = "MongoDB Atlas organization ID"
  type        = string
  sensitive   = true
}

variable "atlas_public_key" {
  description = "MongoDB Atlas API public key"
  type        = string
  sensitive   = true
}

variable "atlas_private_key" {
  description = "MongoDB Atlas API private key"
  type        = string
  sensitive   = true
}

variable "atlas_project_name" {
  description = "MongoDB Atlas project name"
  type        = string
  default     = "VaultBank-Production"
}

variable "atlas_cluster_name" {
  description = "MongoDB Atlas cluster name"
  type        = string
  default     = "vaultbank-cluster-0"
}

variable "atlas_region" {
  description = "AWS region for the cluster"
  type        = string
  default     = "US_EAST_1"
}

variable "db_username" {
  description = "MongoDB database user username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "MongoDB database user password"
  type        = string
  sensitive   = true
}