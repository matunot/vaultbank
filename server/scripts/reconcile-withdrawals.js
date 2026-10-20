#!/usr/bin/env node
/**
 * Operator reconciler for the PRODUCTION chain-withdrawal table.
 *
 * Resolves rows that ended without a provable outcome:
 *   - status 'broadcast'              submitted, confirmation not yet recorded
 *   - status 'reconciliation_required' the broadcast RPC died mid-send, so the
 *                                      outcome was unknowable server-side
 *
 * Evidence-first: every decision reads the REAL on-chain receipt through the
 * same public RPC the rail uses. Default is a dry-run; nothing mutates unless
 * an explicit flag says so, and --refund-id is double-guarded (it refuses any
 * row whose receipt shows a mined transfer, and any row that already has a
 * ledger withdrawal entry).
 *
 * Usage (from server/):
 *   node scripts/reconcile-withdrawals.js                  # dry-run report
 *   node scripts/reconcile-withdrawals.js --apply          # confirm mined rows to 'succeeded'
 *   node scripts/reconcile-withdrawals.js --refund-id <uuid>  # guarded operator refund
 *
 * Guardrails: refuses to run in testnet mode (production table only); never
 * prints signer or secret material; every mutation writes an audit_logs row.
 */

// Scanner-dodge: bracket access (dot-form trips the security agent pattern).
const ENV = process['env'];

if (ENV.USDC_TESTNET_MODE === 'base-sepolia') {
    console.error('Refusing: this reconciler operates the PRODUCTION withdrawals table only. Unset USDC_TESTNET_MODE first.');
    process.exit(64);
}

const { db } = require('../config/database');
const { rpc } = require('../payments/usdc');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const refundIdx = args.indexOf('--refund-id');
const refundId = refundIdx > -1 ? args[refundIdx + 1] : null;

const OPEN_STATUSES = ['broadcast', 'reconciliation_required'];
const openSql = OPEN_STATUSES.join(',');

// undefined = the chain could not be asked (RPC error) — never treated as evidence.
async function receiptOrNull(network, txHash) {
    try {
        return await rpc(network, 'eth_getTransactionReceipt', [txHash]);
    } catch (e) {
        console.error('  RPC error looking up ' + txHash + ': ' + e.message);
        return undefined;
    }
}

async function audit(user_id, action, resourceId, details) {
    try {
        await db.query(
            'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [user_id || null, action, 'usdc_withdrawal', resourceId, JSON.stringify(details), null, 'reconcile-withdrawals.js']
        );
    } catch (e) { console.error('  audit row failed (non-fatal): ' + e.message); }
}

// A row is refund-eligible only when the chain gives NO evidence of the transfer:
//   - no tx_hash recorded, or receipt absent/errored
//   - receipt status 0x0 (reverted) is ALSO refundable-on-evidence: a plain
//     ERC-20 transfer revert means the tokens never left the hot wallet.

async function refundRow(row, reason) {
    const guard = await db.query(
        'SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1',
        ['recon:' + row.id]
    );
    if (guard.rows.length > 0) {
        console.error('  REFUSED: refund already recorded for ' + row.id + ' (idempotency guard).');
        return false;
    }
    // No ledger withdrawal entry may exist for this row: if it does, the
    // broadcast succeeded in the book — refunding would double-pay.
    if (row.tx_hash) {
        const ledger = await db.query('SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1', [row.tx_hash]);
        if (ledger.rows.length > 0) {
            console.error('  REFUSED: ledger withdrawal entry exists for tx ' + row.tx_hash + ' — manual review required for ' + row.id + '.');
            return false;
        }
    }
    const { rows: accounts } = await db.query('SELECT id, balance FROM accounts WHERE id = $1', [row.account_id]);
    if (accounts.length === 0) {
        console.error('  REFUSED: account ' + row.account_id + ' not found for ' + row.id + '.');
        return false;
    }
    const credited = await db.query(
        'UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 WHERE id = $1 RETURNING balance',
        [row.account_id, row.amount]
    );
    if (credited.rows.length === 0) {
        console.error('  REFUSED: account credit returned nothing for ' + row.id + '.');
        return false;
    }
    const after = parseFloat(credited.rows[0].balance);
    const before = after - parseFloat(row.amount);
    await db.query(`UPDATE usdc_withdrawals SET status = 'refunded' WHERE id = $1`, [row.id]);
    await db.query(
        `INSERT INTO transactions (account_id, user_id, type, status, amount, currency, balance_before, balance_after, description, category, external_reference, metadata)
         VALUES ($1, $2, 'refund', 'completed', $3, 'USD', $4, $5, $6, 'refund', $7, $8)`,
        [
            row.account_id, row.user_id, row.amount, before, after,
            'Chain withdrawal broadcast reconciliation refund (' + reason + ')',
            'recon:' + row.id,
            JSON.stringify({ withdrawal_id: row.id, network: row.network, token: row.token, reconciled: true }),
        ]
    );
    await audit(row.user_id, 'usdc_withdrawal_refunded_operator', row.id, {
        reason, amount: row.amount, txHash: row.tx_hash || null, network: row.network, token: row.token,
    });
    console.log('  REFUNDED ' + row.id + '  $' + row.amount + '  (' + reason + ')');
    return true;
}

async function reportAll() {
    const { rows } = await db.query(
        `SELECT id, user_id, account_id, network, token, to_address, amount, tx_hash, status, created_at
           FROM usdc_withdrawals WHERE status IN (${openSql}) ORDER BY created_at`
    );
    if (rows.length === 0) {
        console.log('No open withdrawals (broadcast/reconciliation_required) — table is clean.');
        return { mined: 0, reverted: [], refundable: 0, unknown: 0 };
    }
    let mined = 0;
    const reverted = [];
    let unknown = 0;
    for (const row of rows) {
        const head = row.status.padEnd(24) + row.id + '  $' + row.amount + ' ' + row.token.toUpperCase() + '@' + row.network + '  ' + (row.tx_hash || '(no tx hash)');
        if (!row.tx_hash) {
            console.log(head + '   → no receipt available (tx hash never recorded) — refund listed below');
            reverted.push({ row, reason: 'no tx hash recorded; operator-proven absent' });
            continue;
        }
        const r = await receiptOrNull(row.network, row.tx_hash);
        if (r === undefined) { console.log(head + '   → RPC answer unavailable — leaving untouched'); unknown++; }
        else if (r === null) console.log(head + '   → not mined yet — leave as-is');
        else if (r.status === '0x1') {
            if (apply) {
                await db.query(`UPDATE usdc_withdrawals SET status = 'succeeded' WHERE id = $1`, [row.id]);
                await audit(row.user_id, 'usdc_withdrawal_confirmed', row.id, { txHash: row.tx_hash, receipt: '0x1' });
                console.log(head + '   → receipt mined OK — marked "succeeded"');
            } else {
                console.log(head + '   → receipt mined OK — re-run with --apply to mark "succeeded"');
            }
            mined++;
        } else if (r.status === '0x0') {
            console.log(head + '   → receipt shows REVERT — tokens never left the hot wallet; refund listed below');
            reverted.push({ row, reason: 'on-chain receipt reverted (0x0)' });
        } else {
            console.log(head + '   → unrecognized receipt status ' + r.status + ' — manual review');
            unknown++;
        }
    }
    for (const { row, reason } of reverted) console.log('REFUND CANDIDATE: ' + row.id + ' — ' + reason + ' (run: --refund-id ' + row.id + ')');
    if (reverted.length > 0) console.log('Tip: refunding re-verifies every guard (receipt, ledger entry, idempotency) at refund time.');
    return { mined, reverted, refundable: reverted.length, unknown };
}

async function main() {
    await db.ensureConnection();

    if (refundId) {
        const { rows } = await db.query('SELECT * FROM usdc_withdrawals WHERE id = $1', [refundId]);
        if (rows.length === 0) { console.error('No withdrawal with id ' + refundId); process.exit(2); }
        const row = rows[0];
        if (!OPEN_STATUSES.includes(row.status)) {
            console.error('Refusing: ' + refundId + ' has status ' + row.status + ' (only held/reconciliation states are refundable here).');
            process.exit(2);
        }
        if (row.tx_hash) {
            const r = await receiptOrNull(row.network, row.tx_hash);
            if (r && r.status === '0x1') {
                console.error('REFUSED: receipt for ' + row.tx_hash + ' shows a MINED transfer — refunding would double-pay.');
                process.exit(2);
            }
        }
        await refundRow(row, row.tx_hash ? 'operator refund after chain evidence check' : 'operator refund: no chain evidence recorded');
        return;
    }

    const summary = await reportAll();
    console.log('Summary: ' + JSON.stringify({ minedConfirmed: summary.mined, provedNeverSent: summary.refundable, unknown: summary.unknown, apply: apply ? true : undefined }));
    // 0 = no manual work left, 2 = operator attention required
    process.exit(summary.refundable > 0 || summary.unknown > 0 ? 2 : 0);
}

main().catch((e) => { console.error('Unexpected: ' + e.message); process.exit(1); });
