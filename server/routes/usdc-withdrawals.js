/**
 * VaultBank Chain — outbound crypto withdrawals. YOUR wallet, YOUR rail.
 *
 * POST /api/usdc/withdraw — send USDC/USDT to ANY wallet on Base/Polygon.
 * Signed + broadcast by the VaultBank hot wallet via public RPC. No processor.
 *
 * Env: USDC_HOT_WALLET_KEY (0x…64 hex). Without it: 503 + how-to.
 * Safety: atomic balance debit, daily per-user limit, idempotent records,
 * typed broadcast-failure taxonomy (provable pre-chain rejections auto-refund
 * while ambiguous broadcasts are HELD in reconciliation_required — never
 * auto-refunded), hot-wallet low-balance alerts to admins.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    db,
    isDemo,
    findAccountByUserId,
    createTransaction,
    createNotification,
} = require('../config/database');
const chain = require('../payments/usdc-hotwallet');
const testnet = require('../payments/usdc-testnet');
const { rpc: chainRpc } = require('../payments/usdc');

const DAILY_LIMIT = parseFloat(process.env.USDC_DAILY_LIMIT || '10000');

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    // TEST MODE keeps its own namespace — production tables are never touched.
    if (testnet.MODE) {
        await testnet.ensureTables(db);
        tablesReady = true;
        return;
    }
    await db.query(`
        CREATE TABLE IF NOT EXISTS usdc_withdrawals (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL,
            account_id UUID NOT NULL,
            network TEXT NOT NULL,
            token TEXT NOT NULL,
            to_address TEXT NOT NULL,
            amount NUMERIC(15,2) NOT NULL,
            tx_hash TEXT,
            status TEXT NOT NULL DEFAULT 'broadcast' CHECK (status IN ('broadcast','failed')),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    // Additive status widening (never destructive to data): 'succeeded'
    // (chain-confirmed via reconciler), 'refunded' (operator teardown after an
    // ambiguous broadcast), and 'reconciliation_required' (the RPC died
    // mid-broadcast — outcome unknowable, funds held for operator review).
    await db.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usdc_withdrawals_status_wide') THEN
                ALTER TABLE usdc_withdrawals DROP CONSTRAINT IF EXISTS usdc_withdrawals_status_check;
                ALTER TABLE usdc_withdrawals ADD CONSTRAINT usdc_withdrawals_status_wide
                    CHECK (status IN ('broadcast','succeeded','failed','refunded','reconciliation_required'));
            END IF;
        END $$;
    `);
    tablesReady = true;
}

// Audit trail for money-path decisions (never fatal; skipped in test mode —
// the sandbox namespace never touches production tables).
async function auditWithdrawal(action, req, userId, withdrawalId, details) {
    if (testnet.MODE) return;
    try {
        await db.query(
            'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [userId || null, action, 'usdc_withdrawal', withdrawalId, details || '{}', req.ip || null, (req.headers && req.headers['user-agent']) || null]
        );
    } catch (e) { console.error('audit log error:', e.message); }
}

// Route copy for the crypto 503s: precise hint when the configured value is
// present-but-invalid, plain how-to otherwise (compose-before-message).
const withdrawConfigMessage = () => chain.configHint()
    || chain.configHowTo();

// GET /api/usdc/withdraw-status — hot wallet config + balances
router.get('/api/usdc/withdraw-status', authenticateToken, async (req, res) => {
    try {
        const wallet = chain.getHotWallet();
        if (!wallet) {
            return res.json({
                success: true,
                configured: false,
                message: withdrawConfigMessage(),
            });
        }
        const base = await chain.getHotWalletBalances(chain.defaultNetwork(), wallet.address);
        res.json({
            success: true,
            configured: true,
            walletAddress: wallet.address,
            base,
            dailyLimit: DAILY_LIMIT,
            testnet: testnet.MODE || undefined,
        });
    } catch (error) {
        console.error('usdc withdraw-status error:', error.message);
        res.json({ success: true, configured: true, walletAddress: null, rpcError: error.message });
    }
});

// POST /api/usdc/withdraw — send USDC/USDT to any wallet
router.post('/api/usdc/withdraw', authenticateToken, async (req, res) => {
    const wallet = chain.getHotWallet();
    try {
        if (isDemo) return res.status(400).json({ success: false, message: 'Chain withdrawals need a live account.' });
        await ensureTables();
        if (!wallet) {
            return res.status(503).json({
                success: false,
                code: 'USDC_WITHDRAWALS_NOT_CONFIGURED',
                message: withdrawConfigMessage(),
            });
        }

        const network = String(req.body.network || chain.defaultNetwork()).toLowerCase();
        const token = String(req.body.token || 'usdc').toLowerCase();
        const toAddress = String(req.body.to || '').trim();
        const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;

        if (!chain.NETWORKS[network]) return res.status(400).json({ success: false, message: 'Unknown network. Use base or polygon.' });
        if (!chain.NETWORKS[network].tokens[token]) return res.status(400).json({ success: false, message: 'Unknown token. Use usdc or usdt.' });
        if (!chain.isValidAddress(toAddress)) return res.status(400).json({ success: false, message: 'Invalid destination wallet address.' });
        if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Invalid amount.' });

        // TEST MODE fails closed before any ledger interaction: the RPC must
        // really be Base Sepolia and the pinned contract must verify.
        if (testnet.MODE) {
            try {
                await testnet.verifyRuntime(chainRpc);
            } catch (e) {
                return res.status(503).json({ success: false, code: 'USDC_TESTNET_UNSAFE', message: e.message });
            }
        }

        // Daily per-user limit
        const wdTable = testnet.MODE ? testnet.T.withdrawals : 'usdc_withdrawals';
        const { rows: sent } = await db.query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM ${wdTable}
             WHERE user_id = $1 AND status IN ('broadcast','reconciliation_required')
              AND created_at >= CURRENT_DATE`,
            [req.user.id]
        );
        if (parseFloat(sent[0].total) + amount > DAILY_LIMIT) {
            return res.status(400).json({ success: false, message: 'Daily chain withdrawal limit exceeded (' + DAILY_LIMIT + ').', code: 'DAILY_LIMIT' });
        }

        // Atomic debit from the VaultBank balance. TEST MODE debits the user's
        // SANDBOX account — the real accounts table is unreachable in test mode.
        const account = testnet.MODE
            ? await testnet.getSandboxAccount(db, req.user.id)
            : await findAccountByUserId(req.user.id);
        if (!account) return res.status(404).json({ success: false, message: 'No VaultBank account found.' });
        const { rows: debited } = testnet.MODE
            ? await testnet.debit(db, account.id, amount)
            : await db.query(
                'UPDATE accounts SET balance = balance - $2, available_balance = available_balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance',
                [account.id, amount]
            );
        if (debited.length === 0) {
            return res.status(400).json({ success: false, message: 'Insufficient VaultBank balance.', code: 'INSUFFICIENT_FUNDS' });
        }
        const newBalance = parseFloat(debited[0].balance);

        // Record + broadcast
        const { rows: recRows } = await db.query(
            `INSERT INTO ${wdTable} (user_id, account_id, network, token, to_address, amount)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [req.user.id, account.id, network, token, toAddress.toLowerCase(), amount]
        );
        const withdrawalId = recRows[0].id;


        try {
            const units = BigInt(Math.round(amount * 1e6)); // 6 decimals
            const { txHash } = await chain.sendTokens(network, token, wallet.key, wallet.address, toAddress, units);

            // Persist the hash on the row first: support and the reconciler
            // need it even if the ledger write below dies mid-flight.
            await db.query(`UPDATE ${wdTable} SET tx_hash = $2 WHERE id = $1`, [withdrawalId, txHash]);

            const ledgerEntry = {
                account_id: account.id,
                user_id: req.user.id,
                type: 'withdrawal',
                status: 'completed',
                amount: -amount,
                currency: account.currency,
                balance_before: newBalance + amount,
                balance_after: newBalance,
                description: token.toUpperCase() + ' withdrawal (' + chain.NETWORKS[network].label + ') → ' + toAddress.slice(0, 10) + '…' + toAddress.slice(-6),
                category: 'expense',
                external_reference: txHash,
                metadata: { chain: true, network, token, withdrawal_id: withdrawalId, to: toAddress.toLowerCase() },
            };
            // TEST MODE records in the sandbox namespace — production ledger
            // untouched; sandbox notifications are skipped on purpose.
            // Non-fatal by design: the broadcast is already live on-chain, so
            // a failed ledger/notification write must never turn into a 5xx —
            // scripts/reconcile-withdrawals.js repairs the gap.
            try {
                if (testnet.MODE) {
                    await testnet.recordTransaction(db, ledgerEntry);
                } else {
                    await createTransaction(ledgerEntry);
                    await createNotification(req.user.id, {
                        type: 'transaction',
                        title: 'Chain withdrawal sent',
                        message: '$' + amount.toFixed(2) + ' ' + token.toUpperCase() + ' sent on ' + chain.NETWORKS[network].label + '. Track it: ' + chain.NETWORKS[network].explorer + '/tx/' + txHash,
                    });
                }
            } catch (ledgerErr) {
                console.error('Chain withdrawal ledger write failed (broadcast is live):', ledgerErr.message);
                await auditWithdrawal('usdc_withdrawal_ledger_gap', req, req.user.id, withdrawalId, JSON.stringify({ txHash, error: ledgerErr.message }));
            }

            await auditWithdrawal('usdc_withdrawal_broadcast', req, req.user.id, withdrawalId, JSON.stringify({ txHash, amount, network, token }));

            res.json({
                success: true,
                withdrawalId,
                txHash,
                explorerUrl: chain.NETWORKS[network].explorer + '/tx/' + txHash,
                balance: newBalance,
                testnet: testnet.MODE || undefined,
                message: '$' + amount.toFixed(2) + ' ' + token.toUpperCase() + ' sent to ' + toAddress.slice(0, 10) + '…' + toAddress.slice(-6) + ' on ' + chain.NETWORKS[network].label + '.',
            });
        } catch (broadcastError) {
            // Typed taxonomy from chain.sendTokens: only a PROVABLE rejection
            // (never submitted or provably rejected by the node) may auto-refund.
            const safe = !!broadcastError && (
                broadcastError.stage === 'pre_broadcast' || broadcastError.safe === true
            );

            if (safe) {
                // Auto-refund — the transfer provably never left. TEST MODE
                // refunds the sandbox account and marks the sandbox row failed.
                if (testnet.MODE) {
                    await testnet.credit(db, account.id, amount);
                    await db.query(`UPDATE ${testnet.T.withdrawals} SET status = 'failed' WHERE id = $1`, [withdrawalId]);
                } else {
                    await db.query('UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 WHERE id = $1', [account.id, amount]);
                    await db.query(`UPDATE ${wdTable} SET status = 'failed' WHERE id = $1`, [withdrawalId]);
                    await auditWithdrawal('usdc_withdrawal_refund', req, req.user.id, withdrawalId, JSON.stringify({ error: broadcastError.message, amount, network, token }));
                }
                console.error('Chain broadcast failed (safe):', broadcastError.message);
                return res.status(502).json({ success: false, code: 'BROADCAST_FAILED', message: 'Chain broadcast failed — balance refunded. ' + broadcastError.message });
            }

            // AMBIGUOUS: the RPC died mid-broadcast, answered garbage, or threw
            // an unknown error — the signed raw tx may already be on-chain.
            // Auto-refunding here risks a double payout, so the debit is HELD
            // in reconciliation_required for operator resolution.
            console.error('Chain broadcast AMBIGUOUS:', broadcastError.message);
            await db.query(`UPDATE ${wdTable} SET status = 'reconciliation_required' WHERE id = $1`, [withdrawalId]);
            if (!testnet.MODE) {
                await auditWithdrawal('usdc_withdrawal_reconciliation', req, req.user.id, withdrawalId, JSON.stringify({ error: broadcastError.message, amount, network, token }));
                try {
                    // Page the operators (production only — sandbox money is not page-worthy).
                    const { rows: admins } = await db.query("SELECT id FROM users WHERE role IN ('super_admin', 'admin')");
                    for (const a of admins) {
                        await createNotification(a.id, {
                            type: 'warning',
                            title: 'USDC withdrawal needs reconciliation',
                            message: 'Withdrawal ' + withdrawalId + ' ($' + amount.toFixed(2) + ' ' + token.toUpperCase() + ' on ' + chain.NETWORKS[network].label + ') ended ambiguous after broadcast: ' + broadcastError.message + ' Funds are held in reconciliation_required — resolve via scripts/reconcile-withdrawals.js.',
                        });
                    }
                } catch (e) { /* the row update already secured the money state */ }
            }
            return res.status(502).json({
                success: false,
                code: 'BROADCAST_RECONCILIATION',
                withdrawalId,
                message: 'Withdrawal broadcast outcome is unknown — funds are HELD (not refunded) while the transaction is reconciled. Reference: ' + withdrawalId,
            });
        }
    } catch (error) {
        console.error('usdc withdraw error:', error.message);
        res.status(500).json({ success: false, message: 'Withdrawal failed — no money moved.' });
    }
});

// Automation: hot-wallet low-balance alerts to admins every 30 min.
// (TEST MODE never pages production admins about play-money balances.)
async function monitorHotWallet() {
    try {
        if (testnet.MODE) return;
        const wallet = chain.getHotWallet();
        if (!wallet) return;
        const min = parseFloat(process.env.USDC_HOT_WALLET_MIN || '100');
        const b = await chain.getHotWalletBalances(chain.defaultNetwork(), wallet.address);
        if (b.usdc < min) {
            const { rows: admins } = await db.query("SELECT id FROM users WHERE role IN ('super_admin', 'admin')");
            for (const a of admins) {
                await createNotification(a.id, {
                    type: 'warning',
                    title: 'Hot wallet low on Base',
                    message: 'Hot wallet ' + wallet.address.slice(0, 10) + '… holds $' + b.usdc.toFixed(2) + ' USDC (min $' + min + '). Top it up to keep chain withdrawals flowing.',
                });
            }
        }
    } catch (e) { /* RPC may hiccup — best-effort */ }
}
function startHotWalletMonitor() {
    if (isDemo || testnet.MODE) return;
    setTimeout(() => { monitorHotWallet(); }, 20000);
    setInterval(() => { monitorHotWallet(); }, 30 * 60 * 1000);
    setTimeout(() => { monitorWithdrawalHolds(); }, 20000);
    setInterval(() => { monitorWithdrawalHolds(); }, 30 * 60 * 1000);
    console.log('HOT-WALLET + HELD-FUNDS MONITORS ARMED — low-balance and reconciliation alerts automatic');
}

// Automation: HELD-funds pager — flags every withdrawal row still sitting in
// reconciliation_required (chain withdrawals + provider payouts). The direct
// failure path already paged admins at hold time; this loop is the safety
// net for holds that happened while paging failed or the process was down.
// Alerts once per row per process lifetime (re-alerts after a restart).
// TEST MODE never pages — play-money holds are visible in the sandbox UI.
const alertedHolds = new Set();
async function monitorWithdrawalHolds() {
    try {
        if (testnet.MODE) return;
        const { rows: chainHolds } = await db.query(
            "SELECT id, amount, token, network FROM usdc_withdrawals WHERE status = 'reconciliation_required'"
        );
        const { rows: providerHolds } = await db.query(
            "SELECT provider, request_id FROM provider_payouts WHERE status = 'reconciliation_required'"
        );
        const chainFresh = chainHolds.filter((r) => !alertedHolds.has('w:' + r.id));
        const providerFresh = providerHolds.filter((r) => !alertedHolds.has('p:' + r.provider + ':' + r.request_id));
        if (!chainFresh.length && !providerFresh.length) return;
        chainFresh.forEach((r) => alertedHolds.add('w:' + r.id));
        providerFresh.forEach((r) => alertedHolds.add('p:' + r.provider + ':' + r.request_id));
        const parts = [];
        if (chainFresh.length) {
            parts.push(chainFresh.length + ' chain withdrawal(s) held: ' +
                chainFresh.map((r) => r.id + ' ($' + Number(r.amount).toFixed(2) + ' ' + r.token + '/' + r.network + ')').join(', '));
        }
        if (providerFresh.length) {
            parts.push(providerFresh.length + ' provider payout(s) held: ' +
                providerFresh.map((r) => r.provider + ':' + r.request_id).join(', '));
        }
        const message = parts.join('. ') + '. Funds are HELD in reconciliation_required — resolve chain holds via scripts/reconcile-withdrawals.js and provider holds via the payout queue.';
        const { rows: admins } = await db.query("SELECT id FROM users WHERE role IN ('super_admin', 'admin')");
        for (const a of admins) {
            await createNotification(a.id, {
                type: 'warning',
                title: 'Funds held for reconciliation',
                message,
            });
        }
    } catch (e) { /* best-effort pager — the route-level alert remains the primary */ }
}

module.exports = router;
module.exports.startHotWalletMonitor = startHotWalletMonitor;
module.exports.monitorWithdrawalHolds = monitorWithdrawalHolds;

