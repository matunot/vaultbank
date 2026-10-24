-- Migration 010 -- Payout requests table + idempotency unique constraint
-- =====================================================================
-- Creates the payout_requests table with a database-enforced UNIQUE
-- constraint on (user_id, idempotency_key). Without this, two concurrent
-- HTTP requests with the same key could both pass the application-level
-- check and create two payout rows (and potentially call the provider twice).
--
-- SAFE to run: CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS
-- are both no-ops if the objects already exist. If duplicate
-- (user_id, idempotency_key) pairs exist in the data, the index creation
-- FAILS with a unique violation — the operator must inspect and resolve
-- manually; we never silently delete customer records.

CREATE TABLE IF NOT EXISTS payout_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    transfer_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT,
    bene_id TEXT NOT NULL,
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    destination_account_masked TEXT,
    destination_ifsc TEXT,
    status TEXT NOT NULL DEFAULT 'reserving'
        CHECK (status IN ('reserving','reserved','submitted','succeeded','failed_refunded','failed_unreserved','reconciliation_required')),
    provider_reference_id TEXT,
    utr TEXT,
    failure_reason TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Partial unique index: at most ONE payout per (user_id, idempotency_key).
-- NULL keys are allowed (they mean "no idempotency requested").
CREATE UNIQUE INDEX IF NOT EXISTS payout_idempotency_user_key
    ON payout_requests (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
