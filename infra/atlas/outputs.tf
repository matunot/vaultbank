output "cluster_connection_string" {
  description = "MongoDB Atlas SRV connection string"
  value       = "mongodb+srv://${var.db_username}:${var.db_password}@${mongodbatlas_cluster.this.connection_strings[0].standard_srv}/vaultbank?retryWrites=true&w=majority"
  sensitive   = true
}

output "cluster_host" {
  description = "Cluster hostname (without credentials)"
  value       = mongodbatlas_cluster.this.connection_strings[0].standard_srv
}

output "project_id" {
  description = "Atlas project ID"
  value       = mongodbatlas_project.this.id
}

output "cluster_state" {
  description = "Current state of the cluster"
  value       = mongodbatlas_cluster.this.state_name
}