-- Migration 012 -- Global idempotency-key uniqueness
-- ====================================================
-- ONE (user_id, idempotency_key) must identify AT MOST ONE internal transfer,
-- across currencies. 009's UNIQUE(user_id, currency, idempotency_key) allowed
-- the same key to commit once in USD and once in INR.
--
-- Preflight: existing financial claims are NEVER deleted or rewritten. If
-- historical cross-currency duplicates exist, abort with a diagnostic naming
-- them; an operator resolves the data, then re-runs this migration.

DO $$
DECLARE
    dup_groups INTEGER;
    example RECORD;
BEGIN
    SELECT COUNT(*) INTO dup_groups FROM (
        SELECT 1
        FROM transfer_idempotency
        GROUP BY user_id, idempotency_key
        HAVING COUNT(*) > 1
    ) d;

    IF dup_groups > 0 THEN
        SELECT user_id,
               idempotency_key,
               COUNT(*) AS copies,
               string_agg(currency, ', ' ORDER BY currency) AS currencies
          INTO example
          FROM transfer_idempotency
         GROUP BY user_id, idempotency_key
        HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC, user_id
         LIMIT 1;

        RAISE EXCEPTION
            'Migration 012 preflight failed: % duplicate (user_id, idempotency_key) group(s) exist; example user_id=%, key="%", currencies=[%]. No financial rows were modified. Resolve the duplicates manually, then re-run.',
            dup_groups, example.user_id, example.idempotency_key, example.currencies
            USING HINT = 'Do not delete or rewrite financial records automatically.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_transfer_idempotency_user_key
    ON transfer_idempotency (user_id, idempotency_key);
