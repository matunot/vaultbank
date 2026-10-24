/**
 * VBR Internal Connector — VaultBank-to-VaultBank transfers.
 *
 * The always-available native rail: no external provider, no credentials,
 * no configuration needed. Delegates to the existing atomic transfer
 * pipeline in routes/accounts.js (BEGIN..COMMIT with guarded debit/credit,
 * available_balance enforcement, DB-enforced idempotency).
 *
 * The VBR intent is a tracking record that links to the transfer via
 * transfer_id — the actual money movement goes through the same code path
 * users already trust.
 */

const { STATES } = require('../states');
const { db } = require('../../config/database');

const connector = {
    id: 'internal',
    direction: 'base-only', // native rail — not an external connector
    currencies: ['USD', 'INR'],
    configured: () => true, // always available
    availability: () => ({ available: true, reason: 'always available (VaultBank-to-VaultBank)', provider: 'vaultbank' }),

    /**
     * Execute an internal transfer atomically. Called by the VBR core after
     * the intent is created and validated. Delegates to the same pooled-client
     * BEGIN..COMMIT pipeline as /api/account/transfer.
     *
     * Returns { transferId } on success. Throws on failure (ROLLBACK is
     * handled by the transfer pipeline itself).
     */
    executeTransfer: async ({ userId, fromAccountId, toAccountId, amount, currency, description, idempotencyKey }) => {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Idempotency claim (same as /api/account/transfer)
            if (idempotencyKey) {
                const claim = await client.query(
                    `INSERT INTO transfer_idempotency (user_id, currency, idempotency_key)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, currency, idempotency_key) DO NOTHING
                     RETURNING id`,
                    [userId, currency, idempotencyKey]
                );
                if (claim.rowCount === 0) {
                    await client.query('ROLLBACK');
                    const { rows: existing } = await client.query(
                        `SELECT ti.transfer_id FROM transfer_idempotency ti
                         WHERE ti.user_id = $1 AND ti.currency = $2 AND ti.idempotency_key = $3
                         AND ti.transfer_id IS NOT NULL LIMIT 1`,
                        [userId, currency, idempotencyKey]
                    );
                    if (existing.length > 0) {
                        return { transferId: existing[0].transfer_id, replay: true };
                    }
                    return { error: 'in_progress' };
                }
            }

            // Transfer record
            const { rows: trRows } = await client.query(
                `INSERT INTO transfers (from_account_id, to_account_id, from_user_id, to_user_id, amount, currency, fee, transfer_type, status, description)
                 VALUES ($1, $2, $3, $4, $5, $6, 0, 'internal', 'completed', $7)
                 RETURNING id`,
                [fromAccountId, toAccountId, userId, null, amount, currency, description || 'VBR internal transfer']
            );
            const transferId = trRows[0].id;

            // Link the idempotency claim
            if (idempotencyKey) {
                await client.query(
                    `UPDATE transfer_idempotency SET transfer_id = $1
                     WHERE user_id = $2 AND currency = $3 AND idempotency_key = $4`,
                    [transferId, userId, currency, idempotencyKey]
                );
            }

            // Guarded debit on available_balance
            const debit = await client.query(
                `UPDATE accounts
                 SET balance = balance - $2, available_balance = available_balance - $2
                 WHERE id = $1 AND available_balance >= $2
                 RETURNING (balance + $2) AS balance_before, balance AS balance_after`,
                [fromAccountId, amount]
            );
            if (!debit.rows.length) {
                await client.query('ROLLBACK');
                return { error: 'insufficient_funds' };
            }

            // Credit
            const credit = await client.query(
                `UPDATE accounts
                 SET balance = balance + $2, available_balance = available_balance + $2
                 WHERE id = $1
                 RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
                [toAccountId, amount]
            );
            if (!credit.rows.length) {
                await client.query('ROLLBACK');
                return { error: 'recipient_not_found' };
            }

            // Ledger rows (INSIDE the transaction — same client)
            await client.query(
                `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                    balance_before, balance_after, description, category, reference_id)
                 VALUES ($1, $2, 'transfer_out', 'completed', $3, $4, $5, $6, $7, 'transfer', $8)`,
                [fromAccountId, userId, -amount, currency,
                 parseFloat(debit.rows[0].balance_before), parseFloat(debit.rows[0].balance_after),
                 description || 'VBR transfer', transferId]
            );
            await client.query(
                `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                    balance_before, balance_after, description, category, reference_id)
                 VALUES ($1, $2, 'transfer_in', 'completed', $3, $4, $5, $6, $7, 'income', $8)`,
                [toAccountId, userId, amount, currency,
                 parseFloat(credit.rows[0].balance_before), parseFloat(credit.rows[0].balance_after),
                 description || 'VBR transfer', transferId]
            );

            await client.query('COMMIT');
            return { transferId };
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        } finally {
            client.release();
        }
    },
};

module.exports = connector;
