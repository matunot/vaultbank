-- VaultTag directory for direct person-to-person UPI intents.
-- The table stores user-submitted recipient routing details only. It is not
-- a PSP/TPAP registration, UPI handle allocation, bank account verification,
-- stored-value wallet, payment instruction, or settlement record.
CREATE TABLE IF NOT EXISTS vb_upi_p2p_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    handle TEXT NOT NULL,
    vpa TEXT NOT NULL,
    payee_name TEXT NOT NULL,
    is_listed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vb_upi_p2p_handle_format
        CHECK (handle ~ '^[a-z0-9][a-z0-9._-]{2,23}$'),
    CONSTRAINT vb_upi_p2p_vpa_format
        CHECK (vpa ~ '^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,64}$'),
    CONSTRAINT vb_upi_p2p_payee_name_length
        CHECK (char_length(payee_name) BETWEEN 2 AND 70)
);
CREATE UNIQUE INDEX IF NOT EXISTS vb_upi_p2p_handle_ci_uq
    ON vb_upi_p2p_profiles (LOWER(handle));
CREATE INDEX IF NOT EXISTS vb_upi_p2p_listed_idx
    ON vb_upi_p2p_profiles (is_listed, LOWER(handle));
