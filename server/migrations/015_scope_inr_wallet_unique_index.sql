-- The INR wallet is one non-savings account per customer. Savings vaults are
-- separate ledger accounts in the same currency and must not collide with the
-- wallet's uniqueness guard.
DROP INDEX IF EXISTS accounts_one_inr_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_inr_per_user
    ON accounts (user_id)
    WHERE currency = 'INR' AND account_type <> 'savings';
