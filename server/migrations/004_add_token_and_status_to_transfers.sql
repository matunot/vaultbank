 -- Migration to add token and status columns to transfers table for tokenized transfers
 ALTER TABLE transfers
 ADD COLUMN token TEXT UNIQUE,
 ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';

 -- Index on token for fast lookup
 CREATE INDEX IF NOT EXISTS idx_transfers_token ON transfers(token);