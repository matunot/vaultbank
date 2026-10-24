/**
 * Shared internal-transfer execution service.
 *
 * The SINGLE implementation of the atomic VaultBank internal transfer,
 * used by BOTH:
 *   - POST /api/account/transfer (the existing user-facing route)
 *   - POST /api/vbr/intents (the VBR native rail)
 *
 * Contract:
 *   1. ONE pooled-client BEGIN..COMMIT: idempotency claim + transfer record
 *      INSERT + guarded debit (available_balance) + credit + both ledger rows.
 *   2. No external calls inside the transaction.
 *   3. Returns { transferId, senderBalance, newSenderBalance, recipientBalance }
 *      on success; returns { error, code, message } on expected failure;
 *      throws on unexpected failure (ROLLBACK handled here).
 *   4. Amount is a string for PostgreSQL NUMERIC — no floating-point money.
 *   5. An optional onBeforeCommit(client, { transferId }) hook runs INSIDE
 *      the transaction just before COMMIT — the VBR core uses it to set the
 *      intent's final state atomically with the money, so the two can never
 *      disagree. If the hook throws, ROLLBACK undoes the transfer too.
 *
 * Validation (amount bounds, currency, recipient, self-transfer,
 * cross-currency) is the CALLER's responsibility — this function trusts
 * its inputs because both callers validate first.
 */

const { db, createNotification } = require('../config/database');

/**
 * Execute an atomic internal transfer.
 *
 * @param {Object} params
 * @param {string} params.userId - sender's user ID
 * @param {Object} params.senderAccount - resolved sender account row
 * @param {Object} params.recipientAccount - resolved recipient account row
 * @param {string} params.amount - the amount as a string (e.g., "100.00") for NUMERIC
 * @param {string} params.currency - "USD" or "INR"
 * @param {string} [params.description] - transfer description
 * @param {string|null} [params.idempotencyKey] - client-supplied idempotency key
 * @param {Function} [params.onBeforeCommit] - runs inside the transaction right before COMMIT
 * @param {string} [params.senderName] - sender's display name (user full_name) for the recipient's ledger counterparty
 * @returns {Promise<{transferId, senderBalance, newSenderBalance, recipientBalance, replay?}|{error, code, message}>}
 */
async function executeAtomicTransfer({ userId, senderAccount, recipientAccount, amount, currency, description, idempotencyKey, onBeforeCommit, senderName }) {
    const client = await db.getClient();
    let transferId = null;
    try {
        await client.query('BEGIN');

        // ── Idempotency claim (same as /api/account/transfer) ──
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
                return { error: 'in_progress', code: 'TRANSFER_IN_PROGRESS', message: 'A transfer with this key is still in progress.' };
            }
        }

        // ── Transfer record INSERT ──
        const trResult = await client.query(
            `INSERT INTO transfers (from_account_id, to_account_id, from_user_id, to_user_id,
                amount, currency, fee, transfer_type, status, description)
             VALUES ($1, $2, $3, $4, $5, $6, 0, 'internal', 'completed', $7)
             RETURNING id`,
            [senderAccount.id, recipientAccount.id, userId, recipientAccount.user_id,
             amount, currency, description || 'Internal transfer']
        );
        transferId = trResult.rows[0].id;

        // ── Link the idempotency claim to the transfer ──
        if (idempotencyKey) {
            await client.query(
                `UPDATE transfer_idempotency SET transfer_id = $1
                 WHERE user_id = $2 AND currency = $3 AND idempotency_key = $4`,
                [transferId, userId, currency, idempotencyKey]
            );
        }

        // ── Guarded debit on available_balance ──
        const debit = await client.query(
            `UPDATE accounts
             SET balance = balance - $2, available_balance = available_balance - $2
             WHERE id = $1 AND available_balance >= $2
             RETURNING (balance + $2) AS balance_before, balance AS balance_after`,
            [senderAccount.id, amount]
        );
        if (debit.rows.length === 0) {
            await client.query('ROLLBACK');
            return { error: 'insufficient_funds', code: 'INSUFFICIENT_FUNDS',
                    message: 'Insufficient available funds.',
                    availableBalance: parseFloat(senderAccount.available_balance) };
        }

        // ── Credit ──
        const credit = await client.query(
            `UPDATE accounts
             SET balance = balance + $2, available_balance = available_balance + $2
             WHERE id = $1
             RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
            [recipientAccount.id, amount]
        );
        if (credit.rows.length === 0) {
            await client.query('ROLLBACK');
            return { error: 'recipient_not_found', code: 'RECIPIENT_NOT_FOUND',
                    message: 'Recipient account not found.' };
        }

        // ── Ledger rows (INSIDE the transaction — same client) ──
        await client.query(
            `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                balance_before, balance_after, description, category, reference_id,
                counterparty_name, counterparty_account)
             VALUES ($1, $2, 'transfer_out', 'completed', $3, $4, $5, $6, $7, 'transfer', $8, $9, $10)`,
            [senderAccount.id, userId, -amount, currency,
             parseFloat(debit.rows[0].balance_before), parseFloat(debit.rows[0].balance_after),
             description || `Transfer to ${recipientAccount.account_number}`,
             transferId, recipientAccount.account_name, recipientAccount.account_number]
        );
        await client.query(
            `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                balance_before, balance_after, description, category, reference_id,
                counterparty_name, counterparty_account)
             VALUES ($1, $2, 'transfer_in', 'completed', $3, $4, $5, $6, $7, 'income', $8, $9, $10)`,
            [recipientAccount.id, recipientAccount.user_id, amount, currency,
             parseFloat(credit.rows[0].balance_before), parseFloat(credit.rows[0].balance_after),
             description || `Transfer from ${senderAccount.account_number}`,
             transferId, senderName || senderAccount.account_name, senderAccount.account_number]
        );

        // ── Caller hook: final intent state commits WITH the money ──
        if (onBeforeCommit) await onBeforeCommit(client, { transferId });

        // ── COMMIT: everything above is one atomic operation ──
        await client.query('COMMIT');

        return {
            transferId,
            senderBalance: parseFloat(debit.rows[0].balance_before),
            newSenderBalance: parseFloat(debit.rows[0].balance_after),
            recipientBalance: parseFloat(credit.rows[0].balance_after),
        };
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) { /* releasing anyway */ }
        throw e;
    } finally {
        client.release();
    }
}

/**
 * Post-commit notifications — failure-tolerant, never affect the result.
 */
async function notifyTransferCompletion({ userId, recipientAccount, senderAccount, amount, currency, newSenderBalance, recipientBalance }) {
    try {
        await createNotification(userId, {
            type: 'transaction', title: 'Transfer Sent',
            message: `${currency} ${amount} sent to ${recipientAccount.account_number}. Remaining balance: ${currency} ${newSenderBalance.toFixed(2)}`,
        });
        await createNotification(recipientAccount.user_id, {
            type: 'transaction', title: 'Transfer Received',
            message: `${currency} ${amount} received from ${senderAccount.account_number}. New balance: ${currency} ${recipientBalance.toFixed(2)}`,
        });
    } catch (notifErr) {
        console.warn('Transfer notification failure (transfer completed):', notifErr.message);
    }
}

module.exports = { executeAtomicTransfer, notifyTransferCompletion };
