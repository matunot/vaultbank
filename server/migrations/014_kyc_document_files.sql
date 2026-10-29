-- KYC document bytes live in PostgreSQL, not on the application filesystem.
-- Render replaces the container disk on every deploy; a disk-only upload would
-- lose identity documents between customer submission and human review.
CREATE TABLE IF NOT EXISTS kyc_document_files (
    document_id UUID PRIMARY KEY REFERENCES kyc_documents(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
    content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
