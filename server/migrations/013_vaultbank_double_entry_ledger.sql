-- Migration 013 — VaultBank-owned double-entry journal
-- This is VaultBank's internal accounting/audit layer. It does not initiate
-- external bank transfers and does not assert that opening balances are
-- externally reconciled.
--
-- The migration takes a brief account-table write lock while capturing the
-- one-time opening snapshot. The app's runtime migration runner applies this
-- file transactionally and records it in _migrations.

CREATE TABLE IF NOT EXISTS vb_ledger_bootstrap (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    cutover_at TIMESTAMPTZ,
    opening_balance_reconciled BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO vb_ledger_bootstrap (singleton_id) VALUES (1)
ON CONFLICT (singleton_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS vb_ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    system_code TEXT,
    currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
    account_type TEXT NOT NULL CHECK (account_type IN (
        'customer_liability', 'settlement_asset', 'payout_payable', 'opening_balance_offset'
    )),
    label TEXT NOT NULL,
    verified_available_balance NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (verified_available_balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (account_id IS NOT NULL AND system_code IS NULL AND account_type = 'customer_liability')
        OR
        (account_id IS NULL AND system_code IS NOT NULL AND account_type <> 'customer_liability')
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS vb_ledger_customer_account_uq
    ON vb_ledger_accounts (account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vb_ledger_system_code_currency_uq
    ON vb_ledger_accounts (system_code, currency) WHERE system_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS vb_ledger_journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'opening_balance', 'internal_transfer', 'deposit_settled',
        'bank_deposit_settled', 'deposit_reversed', 'payout_reserved', 'payout_settled', 'payout_refund'
    )),
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
    description TEXT NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    state TEXT NOT NULL DEFAULT 'posted' CHECK (state = 'posted'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_type, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS vb_ledger_journals_source_idx
    ON vb_ledger_journals (source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vb_ledger_journals_currency_created_idx
    ON vb_ledger_journals (currency, created_at DESC);

CREATE TABLE IF NOT EXISTS vb_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id UUID NOT NULL REFERENCES vb_ledger_journals(id) ON DELETE CASCADE,
    ledger_account_id UUID NOT NULL REFERENCES vb_ledger_accounts(id) ON DELETE RESTRICT,
    side TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
    amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vb_ledger_entries_journal_idx
    ON vb_ledger_entries (journal_id);
CREATE INDEX IF NOT EXISTS vb_ledger_entries_account_idx
    ON vb_ledger_entries (ledger_account_id, created_at DESC);

CREATE OR REPLACE FUNCTION vb_ledger_assert_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_journal_id UUID;
    v_currency TEXT;
    v_state TEXT;
    v_count BIGINT;
    v_account_count BIGINT;
    v_debits NUMERIC(20,2);
    v_credits NUMERIC(20,2);
    v_currency_mismatch BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'vb_ledger_journals' THEN
        IF TG_OP = 'DELETE' THEN
            v_journal_id := OLD.id;
        ELSE
            v_journal_id := NEW.id;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_journal_id := OLD.journal_id;
        ELSE
            v_journal_id := NEW.journal_id;
        END IF;
    END IF;

    SELECT currency, state INTO v_currency, v_state
      FROM vb_ledger_journals WHERE id = v_journal_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*),
           COUNT(DISTINCT e.ledger_account_id),
           COALESCE(SUM(e.amount) FILTER (WHERE e.side = 'debit'), 0),
           COALESCE(SUM(e.amount) FILTER (WHERE e.side = 'credit'), 0),
           COALESCE(BOOL_OR(la.currency <> v_currency), FALSE)
      INTO v_count, v_account_count, v_debits, v_credits, v_currency_mismatch
      FROM vb_ledger_entries e
      JOIN vb_ledger_accounts la ON la.id = e.ledger_account_id
     WHERE e.journal_id = v_journal_id;

    IF v_state = 'posted' AND (
        v_count < 2 OR v_account_count < 2 OR
        v_debits <> v_credits OR v_currency_mismatch
    ) THEN
        RAISE EXCEPTION 'VB_LEDGER_JOURNAL_UNBALANCED: journal % must contain at least two same-currency entries with equal debits and credits', v_journal_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgname = 'vb_ledger_journal_balance_deferred'
           AND tgrelid = 'vb_ledger_journals'::regclass
           AND NOT tgisinternal
    ) THEN
        CREATE CONSTRAINT TRIGGER vb_ledger_journal_balance_deferred
        AFTER INSERT OR UPDATE ON vb_ledger_journals
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION vb_ledger_assert_balanced();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgname = 'vb_ledger_entry_balance_deferred'
           AND tgrelid = 'vb_ledger_entries'::regclass
           AND NOT tgisinternal
    ) THEN
        CREATE CONSTRAINT TRIGGER vb_ledger_entry_balance_deferred
        AFTER INSERT OR UPDATE OR DELETE ON vb_ledger_entries
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION vb_ledger_assert_balanced();
    END IF;
END;
$$;

-- Atomic cutover: capture current account balances once, explicitly marked as
-- needing independent bank-statement reconciliation. These entries provide a
-- traceable opening point; they do not prove that corresponding bank reserves
-- exist. External payouts must continue to follow their current independent
-- settlement verification gates.
LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM accounts WHERE balance < 0 AND UPPER(currency) IN ('INR', 'USD')) THEN
        RAISE EXCEPTION 'VaultBank ledger cutover refused: negative account balance requires investigation';
    END IF;
END;
$$;

INSERT INTO vb_ledger_accounts (account_id, system_code, currency, account_type, label)
SELECT a.id, NULL, UPPER(a.currency), 'customer_liability', 'Customer account balance'
  FROM accounts a
 WHERE UPPER(a.currency) IN ('INR', 'USD')
   AND (SELECT cutover_at FROM vb_ledger_bootstrap WHERE singleton_id = 1) IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO vb_ledger_accounts (account_id, system_code, currency, account_type, label)
SELECT NULL, 'OPENING_BALANCE_OFFSET', UPPER(a.currency), 'opening_balance_offset',
       'Unreconciled ledger cutover offset'
  FROM accounts a
 WHERE UPPER(a.currency) IN ('INR', 'USD')
   AND (SELECT cutover_at FROM vb_ledger_bootstrap WHERE singleton_id = 1) IS NULL
GROUP BY UPPER(a.currency)
ON CONFLICT DO NOTHING;

INSERT INTO vb_ledger_journals
    (event_type, source_type, source_id, currency, description, metadata)
SELECT 'opening_balance', 'account', a.id::text, UPPER(a.currency),
       'Initial VaultBank ledger cutover balance — independent reconciliation required',
       jsonb_build_object('cutover', 'v1', 'openingBalanceReconciled', false)
  FROM accounts a
 WHERE UPPER(a.currency) IN ('INR', 'USD')
   AND a.balance > 0
   AND (SELECT cutover_at FROM vb_ledger_bootstrap WHERE singleton_id = 1) IS NULL
ON CONFLICT (event_type, source_type, source_id) DO NOTHING;

INSERT INTO vb_ledger_entries (journal_id, ledger_account_id, side, amount)
SELECT j.id, offset_account.id, 'debit', a.balance
  FROM vb_ledger_journals j
  JOIN accounts a ON a.id::text = j.source_id
  JOIN vb_ledger_accounts offset_account
    ON offset_account.system_code = 'OPENING_BALANCE_OFFSET'
   AND offset_account.currency = j.currency
 WHERE j.event_type = 'opening_balance'
   AND j.source_type = 'account'
   AND (SELECT cutover_at FROM vb_ledger_bootstrap WHERE singleton_id = 1) IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO vb_ledger_entries (journal_id, ledger_account_id, side, amount)
SELECT j.id, customer_account.id, 'credit', a.balance
  FROM vb_ledger_journals j
  JOIN accounts a ON a.id::text = j.source_id
  JOIN vb_ledger_accounts customer_account ON customer_account.account_id = a.id
 WHERE j.event_type = 'opening_balance'
   AND j.source_type = 'account'
   AND (SELECT cutover_at FROM vb_ledger_bootstrap WHERE singleton_id = 1) IS NULL
ON CONFLICT DO NOTHING;

UPDATE vb_ledger_bootstrap
   SET cutover_at = NOW()
 WHERE singleton_id = 1 AND cutover_at IS NULL;
