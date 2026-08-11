/**
 * infra/atlas/main.tf
 * 
 * Provision an Atlas M0 free-tier cluster, DB user, and IP network access.
 * Idempotent — safe to run multiple times.
 */

terraform {
  required_providers {
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "~> 1.20"
    }
  }
}

resource "mongodbatlas_project" "this" {
  name   = var.atlas_project_name
  org_id = var.atlas_org_id
}

resource "mongodbatlas_cluster" "this" {
  project_id = mongodbatlas_project.this.id
  name       = var.atlas_cluster_name

  # M0 free tier
  provider_name         = "TENANT"
  backing_provider_name = "AWS"
  provider_region_name  = var.atlas_region
  provider_instance_size_name = "M0"

  # Enable daily snapshots
  backup_enabled = true

  # Basic advanced config
  pit_enabled = false

  lifecycle {
    prevent_destroy = false
  }
}

resource "mongodbatlas_database_user" "this" {
  project_id = mongodbatlas_project.this.id
  username   = var.db_username
  password   = var.db_password
  auth_database_name = "admin"

  roles {
    role_name     = "readWriteAnyDatabase"
    database_name = "admin"
  }

  roles {
    role_name     = "readWrite"
    database_name = "vaultbank"
  }

  scopes {
    name = mongodbatlas_cluster.this.name
    type = "CLUSTER"
  }
}

# Allow all IPs for development (narrow this in production)
resource "mongodbatlas_project_ip_access_list" "this" {
  project_id = mongodbatlas_project.this.id
  comment    = "Allow all IPs (dev mode)"
  ip_address = "0.0.0.0/0"
}

# Enable alert configuration for cluster health
resource "mongodbatlas_alert_configuration" "replica_set_primary" {
  project_id = mongodbatlas_project.this.id
  event_type_name = "REPLICATION_OPLOG_WINDOW_RUNNING_OUT"
  enabled         = true

  notification {
    type_name     = "GROUP"
    interval_min  = 60
    delay_min     = 0
    email_enabled = true
    sms_enabled   = false
  }

  matcher {
    field_name = "type_name"
    operator   = "EQUALS"
    value      = "REPLICA_SET"
  }
}