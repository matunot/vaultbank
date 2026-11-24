-- Lightspark Grid (Payouts & B2B) durable records.
-- All provider identifiers and financial evidence are stored here; balances
-- remain exclusively in the VaultBank double-entry ledger.

CREATE TABLE IF NOT EXISTS grid_provider_customers (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    provider_customer_id TEXT NOT NULL UNIQUE,
    customer_type TEXT NOT NULL,
    status TEXT,
    kyc_status TEXT,
    region TEXT,
    currencies TEXT[] NOT NULL DEFAULT '{}',
    consents JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grid_internal_accounts (
    provider_account_id TEXT PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    currency TEXT NOT NULL,
    status TEXT,
    type TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS grid_internal_accounts_user_currency_idx
    ON grid_internal_accounts (user_id, currency);

CREATE TABLE IF NOT EXISTS grid_beneficiaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider_external_account_id TEXT NOT NULL UNIQUE,
    currency TEXT NOT NULL,
    account_type TEXT NOT NULL,
    beneficiary_name TEXT NOT NULL,
    details_encrypted TEXT NOT NULL,
    destination_fingerprint TEXT NOT NULL,
    details_masked TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, destination_fingerprint)
);
CREATE INDEX IF NOT EXISTS grid_beneficiaries_user_idx ON grid_beneficiaries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grid_quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    beneficiary_id UUID REFERENCES grid_beneficiaries(id) ON DELETE SET NULL,
    provider_quote_id TEXT NOT NULL UNIQUE,
    provider_transaction_id TEXT,
    source_account_id TEXT NOT NULL,
    destination_account_id TEXT NOT NULL,
    sending_currency TEXT NOT NULL,
    receiving_currency TEXT NOT NULL,
    sending_amount_minor BIGINT NOT NULL,
    receiving_amount_minor BIGINT NOT NULL,
    exchange_rate TEXT NOT NULL,
    fees JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS grid_quotes_user_idx ON grid_quotes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grid_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    quote_id UUID NOT NULL REFERENCES grid_quotes(id) ON DELETE RESTRICT,
    provider_transaction_id TEXT UNIQUE,
    provider_quote_id TEXT NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    reservation_source_id TEXT NOT NULL UNIQUE,
    amount NUMERIC(15,2) NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserving'
        CHECK (status IN ('reserving','reserved','executing','processing','completed','failed','refunded','reconciliation_required')),
    failure_reason TEXT,
    settlement_reference TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS grid_payments_user_idx ON grid_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS grid_payments_stuck_idx ON grid_payments (status, created_at);

CREATE TABLE IF NOT EXISTS grid_webhook_deliveries (
    provider_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    raw_body_sha256 TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'received',
    error TEXT
);

CREATE TABLE IF NOT EXISTS grid_reconciliation_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID REFERENCES grid_payments(id) ON DELETE SET NULL,
    provider_transaction_id TEXT,
    source TEXT NOT NULL,
    observed_status TEXT,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolution TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS grid_reconciliation_payment_idx
    ON grid_reconciliation_records (payment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS grid_capabilities (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider_config JSONB NOT NULL,
    supported_currencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    agreements JSONB NOT NULL DEFAULT '[]'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL
);
