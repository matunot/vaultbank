-- Migration 009 -- Transfer idempotency table
-- ============================================
-- Database-enforced idempotency for internal transfers. The UNIQUE constraint
-- on (user_id, currency, idempotency_key) makes concurrent duplicate requests
-- impossible: one INSERT wins, the other gets rowCount 0 and returns a replay.
--
-- The transfer_id column links the idempotency claim to the completed
-- transfer's UUID (the primary key of the transfers table), so a retried
-- request can return the original transfer's authoritative result.
CREATE TABLE IF NOT EXISTS transfer_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    currency TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    transfer_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, currency, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_transfer_idempotency_lookup
    ON transfer_idempotency (user_id, currency, idempotency_key)
    WHERE transfer_id IS NOT NULL;
