-- Migration to add audit_logs table for compliance audit trail
-- Ensure uuid-ossp extension is available for UUID generation
-- The extension is already created in the initial migration (001_init.sql).
-- Removing the CREATE EXTENSION statement here avoids syntax errors in migration runners that do not support it.

 CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    category TEXT NOT NULL,
    resource_id UUID,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for faster queries
 CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
 CREATE INDEX idx_audit_logs_category ON audit_logs(category);
 CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
