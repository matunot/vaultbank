-- Migration 005 -- Sprint 1
-- -------------------------
-- Adds the provider-event ledger, settlements table, and idempotency
-- tracking. The existing `transfers` + `ledger` tables stay as the
-- money-movement source of truth. The new tables are the source of
-- truth for provider events and reconciliation.
--
-- Run with:
--   psql "$DATABASE_URL" -f server/migrations/005_add_payments_settlements_idempotency.sql
-- gen_random_uuid() is provided by pgcrypto on PG < 13 and built-in on 13+
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Provider-event ledger -----------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider varchar(32) NOT NULL,
    -- stripe | razorpay | paypal | upi | googlepay | wallet | bank
    provider_id varchar(128) NOT NULL,
    -- e.g. pi_..., order_..., capture id
    from_account_id varchar(128),
    to_identifier varchar(255) NOT NULL,
    -- email / phone / upi id / paypal id
    amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
    currency varchar(3) NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'pending',
    -- pending | requires_action | succeeded | failed | refunded | expired
    method varchar(32),
    -- stripe_card | googlepay | upi | razorpay | paypal | bank | wallet
    user_id uuid,
    idempotency_key varchar(255),
    client_secret text,
    -- Stripe clientSecret for client-side confirm
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_id ON payments (provider, provider_id);
CREATE INDEX IF NOT EXISTS ix_payments_user_id ON payments (user_id);
CREATE INDEX IF NOT EXISTS ix_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS ix_payments_created_at ON payments (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payments_idempotency ON payments (idempotency_key)
WHERE idempotency_key IS NOT NULL;
-- Settlements table ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    provider varchar(32) NOT NULL,
    provider_settlement_id varchar(128),
    settled_at timestamptz,
    amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
    currency varchar(3) NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'pending',
    -- pending | in_transit | paid | failed
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_settlements_payment_id ON settlements (payment_id);
CREATE INDEX IF NOT EXISTS ix_settlements_settled_at ON settlements (settled_at DESC);
CREATE INDEX IF NOT EXISTS ix_settlements_status ON settlements (status);
-- Webhook events table (provider_event_id dedup) ----------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider varchar(32) NOT NULL,
    -- stripe | razorpay | paypal
    provider_event_id varchar(255) NOT NULL,
    -- evt_... / event id / transmission id
    event_type varchar(128),
    payload jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    status varchar(32) NOT NULL DEFAULT 'received',
    -- received | processed | failed
    error text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_provider_event ON webhook_events (provider, provider_event_id);
CREATE INDEX IF NOT EXISTS ix_webhook_events_received_at ON webhook_events (received_at DESC);
-- Idempotency keys table (durable cross-process dedup) ----------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key varchar(255) PRIMARY KEY,
    method varchar(8) NOT NULL,
    path varchar(512) NOT NULL,
    user_id uuid,
    response_status integer,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_idempotency_keys_expires ON idempotency_keys (expires_at);
-- Auto-update updated_at on payments ---------------------------------------
CREATE OR REPLACE FUNCTION payments_set_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at = now();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at BEFORE
UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_set_updated_at();