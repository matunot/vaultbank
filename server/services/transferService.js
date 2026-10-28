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
 *   4. A lost COMMIT acknowledgement never produces a definitive failure from
 *      one read. With an idempotency key, a fresh-connection INSERT with the
 *      SAME key waits on the unique constraint until the original transaction
 *      resolves: our INSERT succeeding proves it aborted, a conflicting claim
 *      plus the linked transfer proves it committed. Without a key, bounded
 *      re-reads can prove a commit but never an abort. Anything else returns
 *      { ambiguous: true, code: 'TRANSFER_OUTCOME_UNKNOWN' }.
 *      Callers must never report a definitive failure or retry with a
 *      different idempotency key.
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

const PROBE_LOCK_TIMEOUT = '5s';
const UNKEYED_READ_ATTEMPTS = 3;
const UNKEYED_READ_DELAY_MS = 200;

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
 * A SQLSTATE in the COMMIT response means the server processed the COMMIT and
 * rejected/aborted the transaction — a definitive non-commit. Connection-class
 * errors (08xxx) and server shutdown/crash (57P0x) carry no such proof.
 */
function isDefinitiveCommitRejection(err) {
    const code = err && typeof err.code === 'string' ? err.code : '';
    if (!/^[0-9A-Z]{5}$/.test(code)) return false;
    if (code.startsWith('08')) return false;
    if (code === '57P01' || code === '57P02' || code === '57P03') return false;
    return true;
}

async function readTransferOutcome(transferId) {
    try {
        const { rows } = await db.query(
            `SELECT t.id,
                    (SELECT balance_before FROM transactions WHERE reference_id = t.id AND type = 'transfer_out' LIMIT 1) AS out_before,
                    (SELECT balance_after  FROM transactions WHERE reference_id = t.id AND type = 'transfer_out' LIMIT 1) AS out_after,
                    (SELECT balance_after  FROM transactions WHERE reference_id = t.id AND type = 'transfer_in'  LIMIT 1) AS in_after
             FROM transfers t WHERE t.id = $1`,
            [transferId]
        );
        if (rows.length === 0) return { status: 'not_visible' };
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a lost COMMIT acknowledgement from authoritative records.
 *
 * Keyed transfer: the original transaction inserted the idempotency claim in
 * the SAME transaction as the money. Re-inserting the SAME key on a fresh
 * connection therefore SERIALIZES with the original:
 *   - our INSERT succeeds  → the original ended without committing (proof)
 *   - conflict + our transfer linked → committed (proof)
 *   - lock timeout / error → still unknown (never a definitive failure)
 *
 * Unkeyed transfer: there is no row to wait on. Bounded re-reads can prove a
 * commit; an absent row can never prove an abort, so it stays unknown.
 */
async function resolveTransferOutcome({ transferId, userId, currency, idempotencyKey }) {
    if (!idempotencyKey) {
        for (let attempt = 0; attempt < UNKEYED_READ_ATTEMPTS; attempt++) {
            const outcome = await readTransferOutcome(transferId);
            if (outcome.status === 'committed') return outcome;
            if (attempt < UNKEYED_READ_ATTEMPTS - 1) await sleep(UNKEYED_READ_DELAY_MS);
        }
        return { status: 'unknown' };
    }

    let probe = null;
    let open = false;
    try {
        probe = await db.getClient();
        await probe.query('BEGIN');
        open = true;
        await probe.query(`SET LOCAL lock_timeout = '${PROBE_LOCK_TIMEOUT}'`);

        // Waits for any in-flight transaction holding this exact claim.
        const claim = await probe.query(
            `INSERT INTO transfer_idempotency (user_id, currency, idempotency_key)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, currency, idempotency_key) DO NOTHING
             RETURNING id`,
            [userId, currency, idempotencyKey]
        );
        if (claim.rowCount > 0) {
            // No conflicting claim survived: the original aborted.
            await probe.query('ROLLBACK');
            open = false;
            return { status: 'not_committed' };
        }

        const { rows } = await probe.query(
            `SELECT ti.transfer_id,
                    t.id AS committed_transfer,
                    (SELECT balance_before FROM transactions WHERE reference_id = t.id AND type = 'transfer_out' LIMIT 1) AS out_before,
                    (SELECT balance_after  FROM transactions WHERE reference_id = t.id AND type = 'transfer_out' LIMIT 1) AS out_after,
                    (SELECT balance_after  FROM transactions WHERE reference_id = t.id AND type = 'transfer_in'  LIMIT 1) AS in_after
             FROM transfer_idempotency ti
             LEFT JOIN transfers t ON t.id = ti.transfer_id
             WHERE ti.user_id = $1 AND ti.currency = $2 AND ti.idempotency_key = $3
             LIMIT 1`,
            [userId, currency, idempotencyKey]
        );
        await probe.query('ROLLBACK');
        open = false;

        const row = rows[0];
        // A claim exists but not for OUR transfer: never guess.
        if (!row || row.transfer_id !== transferId || !row.committed_transfer) return { status: 'unknown' };
        return {
            status: 'committed',
            senderBalance: row.out_before == null ? null : parseFloat(row.out_before),
            newSenderBalance: row.out_after == null ? null : parseFloat(row.out_after),
            recipientBalance: row.in_after == null ? null : parseFloat(row.in_after),
        };
    } catch (_) {
        return { status: 'unknown' };
    } finally {
        if (probe) {
            if (open) { try { await probe.query('ROLLBACK'); } catch (_) { /* destroy below */ } }
            probe.release(true);
        }
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
            // One key may only ever mean ONE transfer across BOTH routes and
            // currencies. This advisory lock serializes same-key claims on
            // this user (needed on deployments where migration 012's global
            // unique index is not applied yet; 009 alone is per-currency).
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
                [userId, idempotencyKey]
            );

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

            // No conflict target: handles BOTH the 009 constraint and the
            // 012 global unique index, and never errors on an unmigrated DB.
            const claim = await client.query(
                `INSERT INTO transfer_idempotency (user_id, currency, idempotency_key)
                 VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING
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
                     WHERE ti.user_id = $1 AND ti.idempotency_key = $2
                     LIMIT 1`,
                    [userId, idempotencyKey]
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
        const { rows: outTransactionRows } = await client.query(
            `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                balance_before, balance_after, description, category, reference_id,
                counterparty_name, counterparty_account)
             VALUES ($1, $2, 'transfer_out', 'completed', $3, $4, $5, $6, $7, 'transfer', $8, $9, $10)
             RETURNING id`,
            [senderAccount.id, userId, -amount, currency,
             parseFloat(debit.rows[0].balance_before), parseFloat(debit.rows[0].balance_after),
             description || `Transfer to ${recipientAccount.account_number}`,
             transferId, recipientAccount.account_name, recipientAccount.account_number]
        );
        const { rows: inTransactionRows } = await client.query(
            `INSERT INTO transactions (account_id, user_id, type, status, amount, currency,
                balance_before, balance_after, description, category, reference_id,
                counterparty_name, counterparty_account)
             VALUES ($1, $2, 'transfer_in', 'completed', $3, $4, $5, $6, $7, 'income', $8, $9, $10)
             RETURNING id`,
            [recipientAccount.id, recipientAccount.user_id, amount, currency,
             parseFloat(credit.rows[0].balance_before), parseFloat(credit.rows[0].balance_after),
             description || `Transfer from ${senderAccount.account_number}`,
             transferId, senderName || senderAccount.account_name, senderAccount.account_number]
        );

        // VaultBank-owned double-entry journal: ledger postings commit in the SAME
        // PostgreSQL transaction as both account balance updates, transfer and
        // customer transaction history. This core has no payment-processor dependency.
        const postedAmount = String(amount);
        await client.query(
            `INSERT INTO ledger (transaction_id, account_id, user_id, entry_type, amount, balance_after, description)
             VALUES ($1, $2, $3, 'debit', $4, $5, $6)`,
            [outTransactionRows[0].id, senderAccount.id, userId, postedAmount,
             String(debit.rows[0].balance_after), description || `Transfer to ${recipientAccount.account_number}`]
        );
        await client.query(
            `INSERT INTO ledger (transaction_id, account_id, user_id, entry_type, amount, balance_after, description)
             VALUES ($1, $2, $3, 'credit', $4, $5, $6)`,
            [inTransactionRows[0].id, recipientAccount.id, recipientAccount.user_id, postedAmount,
             String(credit.rows[0].balance_after), description || `Transfer from ${senderAccount.account_number}`]
        );

        // Fail closed before COMMIT if the journal is incomplete or unbalanced.
        // Decimal arithmetic is converted to integer minor units for comparison.
        const toMinorUnits = (value) => {
            const normalized = String(value);
            const [whole, fraction = ''] = normalized.split('.');
            if (!/^\\d+$/.test(whole) || !/^\\d*$/.test(fraction) || fraction.length > 2) {
                throw new Error('CORE_LEDGER_INVALID_AMOUNT');
            }
            return (BigInt(whole) * 100n) + BigInt((fraction + '00').slice(0, 2));
        };
        const { rows: journalCheck } = await client.query(
            `SELECT COUNT(*)::int AS entry_count,
                    COUNT(*) FILTER (WHERE l.entry_type = 'debit')::int AS debit_count,
                    COUNT(*) FILTER (WHERE l.entry_type = 'credit')::int AS credit_count,
                    COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'debit'), 0)::text AS debit_total,
                    COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'credit'), 0)::text AS credit_total,
                    COUNT(DISTINCT t.currency)::int AS currency_count
             FROM ledger l
             JOIN transactions t ON t.id = l.transaction_id
             WHERE l.transaction_id = ANY($1::uuid[])`,
            [[outTransactionRows[0].id, inTransactionRows[0].id]]
        );
        const journal = journalCheck[0];
        if (!journal
            || journal.entry_count !== 2
            || journal.debit_count !== 1
            || journal.credit_count !== 1
            || journal.currency_count !== 1
            || toMinorUnits(journal.debit_total) !== toMinorUnits(postedAmount)
            || toMinorUnits(journal.credit_total) !== toMinorUnits(postedAmount)
            || toMinorUnits(journal.debit_total) !== toMinorUnits(journal.credit_total)) {
            throw new Error('CORE_LEDGER_UNBALANCED');
        }

        // ── Caller hook: final intent state commits WITH the money ──
        if (onBeforeCommit) await onBeforeCommit(client, { transferId });

        // ── COMMIT: everything above is one atomic operation ──
        try {
            await client.query('COMMIT');
        } catch (commitErr) {
            // The acknowledgement was lost — the transaction may still commit.
            // The connection's protocol state is unknown: destroy it, and never
            // report a definitive failure without proof.
            destroyClient = true;
            console.warn('Transfer COMMIT acknowledgement failed; resolving outcome:', commitErr.message);
            if (isDefinitiveCommitRejection(commitErr)) {
                return { error: 'commit_failed', code: 'COMMIT_FAILED',
                         message: 'The transfer was not committed.' };
            }
            const outcome = await resolveTransferOutcome({ transferId, userId, currency, idempotencyKey });
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
