-- ============================================================
-- VaultBank 008 — CREDIT ENGINE SCHEMA
-- Real credit line + credit card behavior + VaultBank Credit Score
-- ============================================================

CREATE TABLE IF NOT EXISTS credit_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    credit_limit NUMERIC(15,2) NOT NULL DEFAULT 0,
    balance_owed NUMERIC(15,2) NOT NULL DEFAULT 0,
    apr NUMERIC(5,2) NOT NULL DEFAULT 19.99,          -- annual percentage rate (%)
    credit_score INTEGER NOT NULL DEFAULT 0,           -- 300-850, VaultBank score
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed','review')),
    autopay BOOLEAN NOT NULL DEFAULT true,
    last_autopay_date DATE,
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    credit_account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('draw','repayment','interest','fee')),
    amount NUMERIC(15,2) NOT NULL,
    balance_owed_after NUMERIC(15,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_account ON credit_ledger(credit_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at DESC);
