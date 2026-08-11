-- Migration 006 -- Sprint 2
-- -------------------------
-- Adds two small operational tables for the Sprint 2 deliverables:
--   1. reconciliations   -- nightly comparison of provider tx vs ledger
--   2. feature_flags     -- DB-backed canary percentage flags
--
-- Both tables are pure bookkeeping; the existing payments / transfers /
-- ledger tables are unchanged.
-- ============================================================================
-- Reconciliations table
-- ============================================================================
-- One row per provider transaction we saw during a reconciliation run.
-- status values:
--   matched  -- the provider transaction matched a payment row in our ledger
--   mismatch -- the provider transaction exists in our ledger but the amount
--               (or other field) differs
--   missing  -- the provider transaction has no corresponding ledger row
--   unknown  -- the ledger row exists but we could not find the provider tx
--               (e.g. our ledger has the row but the provider has not
--               settled it yet)
CREATE TABLE IF NOT EXISTS reconciliations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider varchar(32) NOT NULL,
    provider_id varchar(128) NOT NULL,
    -- e.g. txn id, ch id, capture id
    payment_id uuid,
    -- nullable; linked when matched
    status varchar(16) NOT NULL,
    amount numeric(14, 2),
    ledger_amount numeric(14, 2),
    currency varchar(3),
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    run_id uuid,
    -- groups rows from one run
    created_at timestamptz NOT NULL DEFAULT now()
);
-- One row per (provider, provider_id, run_id) -- a tx can only be
-- reconciled once per run, even if the run is retried.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliations_run ON reconciliations (provider, provider_id, run_id);
CREATE INDEX IF NOT EXISTS ix_reconciliations_status_created ON reconciliations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_reconciliations_payment ON reconciliations (payment_id);
-- ============================================================================
-- Reconciliation runs (one row per CLI / cron invocation)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider varchar(32) NOT NULL,
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    matched_count integer NOT NULL DEFAULT 0,
    mismatch_count integer NOT NULL DEFAULT 0,
    missing_count integer NOT NULL DEFAULT 0,
    unknown_count integer NOT NULL DEFAULT 0,
    dry_run boolean NOT NULL DEFAULT false,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    error text
);
CREATE INDEX IF NOT EXISTS ix_reconciliation_runs_started ON reconciliation_runs (provider, started_at DESC);
-- ============================================================================
-- Feature flags table
-- ============================================================================
-- key          -- the flag name (e.g. 'payments.live_providers_percent')
-- percentage   -- 0..100; the share of requests routed to live mode
-- updated_at   -- last admin write; read cache refreshes every 30s
-- updated_by   -- who flipped it (free text; for audit)
-- description  -- human-readable hint shown in /api/admin/flags
CREATE TABLE IF NOT EXISTS feature_flags (
    key varchar(64) PRIMARY KEY,
    percentage integer NOT NULL DEFAULT 0 CHECK (
        percentage BETWEEN 0 AND 100
    ),
    enabled boolean NOT NULL DEFAULT true,
    description text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(128)
);
-- Seed the default canary flag at 0% so the first deploy to production
-- is safe by default.
INSERT INTO feature_flags (key, percentage, enabled, description)
VALUES (
        'payments.live_providers_percent',
        0,
        true,
        'Percentage of payment requests routed to live PSPs (0-100).'
    ) ON CONFLICT (key) DO NOTHING;