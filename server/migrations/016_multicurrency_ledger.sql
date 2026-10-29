-- 016_multicurrency_ledger.sql
--
-- Widen the schema-level currency allowlist from INR/USD to every currency in
-- `server/config/currencies.js`. This is a DENOMINATION change only:
--
--   * no balance is created or converted,
--   * no exchange rate is introduced (FX stays disabled),
--   * no external settlement rail is enabled.
--
-- A registered currency still cannot be held or transferred until an operator
-- enables multi-currency (`VB_MULTICURRENCY_ENABLED=true`) and, for incoming
-- bank transfers, configures a real receiving account for that currency.
--
-- Idempotent: safe to re-run on every deploy.

ALTER TABLE vb_ledger_accounts DROP CONSTRAINT IF EXISTS vb_ledger_accounts_currency_check;
ALTER TABLE vb_ledger_accounts
    ADD CONSTRAINT vb_ledger_accounts_currency_check
    CHECK (currency IN ('USD', 'INR', 'AED', 'GBP', 'EUR', 'CAD', 'AUD', 'SGD', 'NZD', 'CHF', 'HKD'));

ALTER TABLE vb_ledger_journals DROP CONSTRAINT IF EXISTS vb_ledger_journals_currency_check;
ALTER TABLE vb_ledger_journals
    ADD CONSTRAINT vb_ledger_journals_currency_check
    CHECK (currency IN ('USD', 'INR', 'AED', 'GBP', 'EUR', 'CAD', 'AUD', 'SGD', 'NZD', 'CHF', 'HKD'));

-- payment_intents is created by the VBR runtime, so it may not exist yet when
-- this migration runs on a fresh database.
DO $$
BEGIN
    IF to_regclass('public.payment_intents') IS NOT NULL THEN
        ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS payment_intents_currency_check;
        ALTER TABLE payment_intents
            ADD CONSTRAINT payment_intents_currency_check
            CHECK (currency IN ('USD', 'INR', 'AED', 'GBP', 'EUR', 'CAD', 'AUD', 'SGD', 'NZD', 'CHF', 'HKD'));
    END IF;
END $$;
