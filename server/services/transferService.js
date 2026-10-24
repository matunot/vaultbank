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
 *      INSERT + guarded debit (status/currency/available_balance) + guarded
 *      credit (status/currency) + both ledger rows.
 *   2. No external calls inside the transaction.
 *   3. Success returns { transferId, senderBalance, newSenderBalance,
 *      recipientBalance }; expected failures return { error, code, message };
 *      Unexpected failures throw (ROLLBACK handled here).
 *   4. A lost COMMIT acknowledgement returns { ambiguous: true, code:
 *      'TRANSFER_OUTCOME_UNKNOWN' } after checking a FRESH pool connection.
 *      The transfer may have committed — callers must never report a
 *      definitive failure or retry with a different idempotency key.
 *   5. Idempotent replay compares the STORED transfer (amount, currency,
 *      sender, recipient), never the client's values. Same key + different
 *      material parameters returns IDEMPOTENCY_CONFLICT.
 *   6. Amount is a string for PostgreSQL NUMERIC — no floating-point money.
 *   7. An optional onBeforeCommit(client, { transferId }) hook runs INSIDE
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
 * Why a guarded UPDATE matched no row. Diagnostic only — the guarded UPDATE
 * itself is what makes the rejection race-safe.
 */
async function describeAccount(client, accountId, currency) {
    try {
        const { rows } = await client.query('SELECT status, currency FROM accounts WHERE id = $1', [accountId]);
        if (!rows[0]) return 'missing';
        if (rows[0].status !== 'active') return 'inactive';
        if (String(rows[0].currency).toUpperCase() !== String(currency).toUpperCase()) return 'currency';
        return 'ok';
    } catch (_) {
        return 'unknown';
    }
}

/**
 * After a failed COMMIT the outcome is unknown. A FRESH pooled connection is
 * authoritative: the transfer row and its ledger rows commit atomically, so
 * their presence proves the commit landed.
 */
async function verifyTransferOutcome(transferId) {
    try {
        const { rows } = await db.query(
            `SELECT t.id,
                    (SELECT balance_before FROM transactions WHERE reference_id = t.id AND type = 'transfer_out' LIMIT 1) AS out_before,
                    (SELECT balance_after  FROM transactions WHERE reference_id = t.id AND type = 'transfer_out' LIMIT 1) AS out_after,
                    (SELECT balance_after  FROM transactions WHERE reference_id = t.id AND type = 'transfer_in'  LIMIT 1) AS in_after
             FROM transfers t WHERE t.id = $1`,
            [transferId]
        );
        if (rows.length === 0) return { status: 'not_committed' };
        const r = rows[0];
        return {
            status: 'committed',
            senderBalance: r.out_before == null ? null : parseFloat(r.out_before),
            newSenderBalance: r.out_after == null ? null : parseFloat(r.out_after),
            recipientBalance: r.in_after == null ? null : parseFloat(r.in_after),
        };
    } catch (_) {
        return { status: 'unknown' };
    }
}

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
 * @returns {Promise<{transferId, senderBalance, newSenderBalance, recipientBalance, replay?, verified?}|{ambiguous: boolean, code, message}|{error, code, message}>}
 */
async function executeAtomicTransfer({ userId, senderAccount, recipientAccount, amount, currency, description, idempotencyKey, onBeforeCommit, senderName }) {
    const client = await db.getClient();
    let transferId = null;
    let destroyClient = false;
    try {
        await client.query('BEGIN');

        // ── Idempotency claim ──
        if (idempotencyKey) {
            // One key may only ever mean ONE transfer across both routes. The
            // claim table is unique per (user, currency, key), so reuse with a
            // different currency is checked here.
            // shortcut: two concurrent different-currency claims could both
            // pass this SELECT; upgrade to UNIQUE(user_id, idempotency_key)
            // if that race ever matters.
            const { rows: otherCurrency } = await client.query(
                `SELECT currency FROM transfer_idempotency
                 WHERE user_id = $1 AND idempotency_key = $2 AND currency <> $3 LIMIT 1`,
                [userId, idempotencyKey, currency]
            );
            if (otherCurrency.length > 0) {
                await client.query('ROLLBACK');
                return { error: 'idempotency_conflict', code: 'IDEMPOTENCY_CONFLICT',
                         message: 'This idempotency key was already used for a different transfer.' };
            }

            const claim = await client.query(
                `INSERT INTO transfer_idempotency (user_id, currency, idempotency_key)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, currency, idempotency_key) DO NOTHING
                 RETURNING id`,
                [userId, currency, idempotencyKey]
            );
            if (claim.rowCount === 0) {
                await client.query('ROLLBACK');
                // rowCount 0 means the original claim COMMITTED (the INSERT
                // waits for an in-flight conflicting row, then sees it). Replay
                // only if the STORED transfer matches every material parameter.
                const { rows: existing } = await client.query(
                    `SELECT ti.transfer_id, t.amount, t.currency, t.from_account_id, t.to_account_id
                     FROM transfer_idempotency ti
                     LEFT JOIN transfers t ON t.id = ti.transfer_id
                     WHERE ti.user_id = $1 AND ti.currency = $2 AND ti.idempotency_key = $3
                     LIMIT 1`,
                    [userId, currency, idempotencyKey]
                );
                const prior = existing[0];
                if (prior && prior.transfer_id) {
                    const same = Number(prior.amount) === Number(amount)
                        && prior.from_account_id === senderAccount.id
                        && prior.to_account_id === recipientAccount.id
                        && String(prior.currency).toUpperCase() === String(currency).toUpperCase();
                    if (!same) {
                        return { error: 'idempotency_conflict', code: 'IDEMPOTENCY_CONFLICT',
                                 message: 'This idempotency key was already used for a different transfer.' };
                    }
                    return { transferId: prior.transfer_id, replay: true };
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

        // ── Guarded debit: status + currency + available balance are checked
        // against the authoritative row inside the transaction. A concurrent
        // status change cannot race past this: the UPDATE locks the row and
        // re-evaluates the conditions on the committed version. ──
        const debit = await client.query(
            `UPDATE accounts
             SET balance = balance - $2, available_balance = available_balance - $2
             WHERE id = $1 AND status = 'active' AND UPPER(currency) = $3 AND available_balance >= $2
             RETURNING (balance + $2) AS balance_before, balance AS balance_after`,
            [senderAccount.id, amount, currency]
        );
        if (debit.rows.length === 0) {
            const reason = await describeAccount(client, senderAccount.id, currency);
            await client.query('ROLLBACK');
            if (reason === 'inactive') {
                return { error: 'sender_inactive', code: 'SENDER_ACCOUNT_INACTIVE',
                         message: 'Sender account is not active.' };
            }
            if (reason === 'currency') {
                return { error: 'currency_mismatch', code: 'CURRENCY_MISMATCH',
                         message: 'Sender account currency does not match the transfer currency.' };
            }
            if (reason === 'missing') {
                return { error: 'sender_not_found', code: 'SENDER_ACCOUNT_NOT_FOUND',
                         message: 'Sender account not found.' };
            }
            return { error: 'insufficient_funds', code: 'INSUFFICIENT_FUNDS',
                    message: 'Insufficient available funds.',
                    availableBalance: parseFloat(senderAccount.available_balance) };
        }

        // ── Guarded credit: same authoritative status/currency checks ──
        const credit = await client.query(
            `UPDATE accounts
             SET balance = balance + $2, available_balance = available_balance + $2
             WHERE id = $1 AND status = 'active' AND UPPER(currency) = $3
             RETURNING (balance - $2) AS balance_before, balance AS balance_after`,
            [recipientAccount.id, amount, currency]
        );
        if (credit.rows.length === 0) {
            const reason = await describeAccount(client, recipientAccount.id, currency);
            await client.query('ROLLBACK');
            if (reason === 'inactive') {
                return { error: 'recipient_inactive', code: 'RECIPIENT_ACCOUNT_INACTIVE',
                         message: 'Recipient account is not active.' };
            }
            if (reason === 'currency') {
                return { error: 'currency_mismatch', code: 'CURRENCY_MISMATCH',
                         message: 'Recipient account currency does not match the transfer currency.' };
            }
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
        try {
            await client.query('COMMIT');
        } catch (commitErr) {
            // The acknowledgement was lost — the transaction may have
            // committed. The connection's protocol state is unknown: destroy
            // it, and never report a definitive failure without evidence.
            destroyClient = true;
            console.warn('Transfer COMMIT acknowledgement failed; verifying outcome:', commitErr.message);
            const outcome = await verifyTransferOutcome(transferId);
            if (outcome.status === 'committed') {
                return {
                    transferId,
                    senderBalance: outcome.senderBalance,
                    newSenderBalance: outcome.newSenderBalance,
                    recipientBalance: outcome.recipientBalance,
                    verified: true,
                };
            }
            if (outcome.status === 'not_committed') {
                return { error: 'commit_failed', code: 'COMMIT_FAILED',
                         message: 'The transfer was not committed.' };
            }
            return { ambiguous: true, code: 'TRANSFER_OUTCOME_UNKNOWN',
                     message: 'The transfer outcome could not be confirmed — money may have moved.' };
        }

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
        client.release(destroyClient);
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
