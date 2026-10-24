-- Migration 011 -- VBR payment intents table
-- ===========================================
-- The VaultBank Rail (VBR) core: a provider-neutral payment intent that
-- tracks every payment across its lifecycle. Each intent is a stable record
-- with a state machine, idempotency key, currency, amount (NUMERIC — never
-- floating-point), and links to the underlying transfer.
--
-- SAFE to run: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS payment_intents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL,
    idempotency_key TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('send', 'receive')),
    method TEXT NOT NULL CHECK (method IN ('internal', 'collections', 'payouts')),
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
    state TEXT NOT NULL DEFAULT 'created'
        CHECK (state IN ('created', 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'reconciliation_required')),
    counterparty TEXT,
    metadata JSONB DEFAULT '{}',
    transfer_id UUID REFERENCES transfers(id),
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- DB-enforced idempotency: at most ONE intent per (user_id, idempotency_key).
-- NULL keys are allowed (they mean "no idempotency requested").
CREATE UNIQUE INDEX IF NOT EXISTS payment_intent_idempotency_key
    ON payment_intents (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Fast lookup by state for reconciliation scans.
CREATE INDEX IF NOT EXISTS ix_payment_intents_state
    ON payment_intents (state, updated_at DESC)
    WHERE state NOT IN ('succeeded', 'failed', 'cancelled');
