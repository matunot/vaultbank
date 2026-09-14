/**
 * VaultBank USDC/USDT Deposit Routes — receive-only, non-custodial, zero signup.
 *
 * - GET  /api/usdc/deposit-address?network=base|polygon|ethereum&token=usdc|usdt → per-user address + QR
 * - POST /api/usdc/check {network?} → scan chains (BOTH tokens), credit confirmed transfers
 *
 * The deposit address is xpub-derived and token-independent — the SAME address
 * receives USDC and USDT on a given network. "check" scans every supported
 * token on the network and credits whatever confirms.
 *
 * Setup: operator pastes an account-level XPUB into USDC_XPUB (public key
 * only — generates addresses, can NEVER spend). Without it: 503 + how-to.
 * On-chain funds stay parked until swept with the offline xpriv (a later,
 * explicitly-authorized step — sweeping code does not exist in this repo).
 *
 * Credits are idempotent on txHash:logIndex and use atomic increments.
 */

const express = require('express');
const router = express.Router();
const qrcode = require('qrcode');
const { authenticateToken } = require('../middleware/auth');
const {
    findAccountByUserId,
    createTransaction,
    createNotification,
    db,
} = require('../config/database');
const { NETWORKS, TOKEN_DECIMALS, deriveDepositAddress, scanDeposits } = require('../payments/usdc');

const SUPPORTED_TOKENS = Object.keys(TOKEN_DECIMALS); // ['usdc', 'usdt']

let tablesReady = false;
async function ensureTables() {
    if (tablesReady) return;
    await db.ensureConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS usdc_deposits (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL,
            account_id UUID NOT NULL,
            network TEXT NOT NULL,
            address TEXT NOT NULL,
            addr_index INTEGER NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE (address, network)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS usdc_scan_state (
            network TEXT PRIMARY KEY,
            last_block BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    // Migration: address uniqueness must be per (address, network) — global
    // UNIQUE(address) silently dropped the 2nd network's row, so deposits on
    // that network never credited.
    await db.query(`
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usdc_deposits_address_key') THEN
                ALTER TABLE usdc_deposits DROP CONSTRAINT usdc_deposits_address_key;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usdc_deposits_address_network_key') THEN
                ALTER TABLE usdc_deposits ADD CONSTRAINT usdc_deposits_address_network_key UNIQUE (address, network);
            END IF;
        END $$;
    `);
    tablesReady = true;
}

const getXpub = () => {
    const x = process.env.USDC_XPUB;
    return x && x.startsWith('xpub') ? x.trim() : null;
};

// ============================================================================
// GET /api/usdc/deposit-address — your personal deposit address (per network)
// The SAME address receives USDC and USDT on that network.
// ============================================================================
router.get('/api/usdc/deposit-address', authenticateToken, async (req, res) => {
    try {
        const network = String(req.query.network || 'base').toLowerCase();
        const token = String(req.query.token || 'usdc').toLowerCase();
        if (!NETWORKS[network]) {
            return res.status(400).json({ success: false, message: 'Unknown network. Use base, polygon or ethereum.' });
        }
        if (!NETWORKS[network][token]) {
            return res.status(400).json({ success: false, message: `${token.toUpperCase()} is not supported on ${NETWORKS[network].label}.` });
        }
        const xpub = getXpub();
        if (!xpub) {
            return res.status(503).json({ success: false, code: 'USDC_NOT_CONFIGURED', message: 'USDC deposits are not enabled yet.' });
        }
        await ensureTables();
        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'Account not found.' });
        }
        let row = (await db.query(
            'SELECT address FROM usdc_deposits WHERE user_id = $1 AND network = $2 LIMIT 1',
            [req.user.id, network]
        )).rows[0];
        if (!row) {
            const n = await db.query('SELECT COUNT(*) AS n FROM usdc_deposits WHERE network = $1', [network]);
            const index = parseInt(n.rows[0].n || '0', 10);
            const address = deriveDepositAddress(xpub, index);
            await db.query(
                'INSERT INTO usdc_deposits (user_id, account_id, network, address, addr_index) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (address, network) DO NOTHING',
                [req.user.id, account.id, network, address, index]
            );
            row = { address };
        }
        let qr = null;
        try {
            qr = await qrcode.toDataURL(row.address, { width: 256, margin: 2 });
        } catch (e) { /* address still usable without QR */ }
        return res.status(200).json({
            success: true,
            address: row.address,
            network,
            token: token.toUpperCase(),
            qr,
            note: `Send only ${token.toUpperCase()} on ` + NETWORKS[network].label + ' to this address. Funds credit after 12 confirmations.',
        });
    } catch (error) {
        console.error('USDC address error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to get deposit address.' });
    }
});

// ============================================================================
// POST /api/usdc/check — scan for new deposits, credit confirmed ones
// ============================================================================
router.post('/api/usdc/check', authenticateToken, async (req, res) => {
    try {
        const networks = req.body && req.body.network
            ? [String(req.body.network).toLowerCase()]
            : Object.keys(NETWORKS);
        for (const n of networks) {
            if (!NETWORKS[n]) {
                return res.status(400).json({ success: false, message: 'Unknown network. Use base, polygon or ethereum.' });
            }
        }
        if (!getXpub()) {
            return res.status(503).json({ success: false, code: 'USDC_NOT_CONFIGURED', message: 'USDC deposits are not enabled yet.' });
        }
        await ensureTables();
        const credited = [];
        for (const network of networks) {
            const mine = await db.query(
                'SELECT address, account_id FROM usdc_deposits WHERE user_id = $1 AND network = $2',
                [req.user.id, network]
            );
            if (mine.rows.length === 0) continue;
            const byAddr = new Map(mine.rows.map((r) => [r.address.toLowerCase(), r.account_id]));
            const st = await db.query('SELECT last_block FROM usdc_scan_state WHERE network = $1', [network]);
            let fromBlock = st.rows[0] ? parseInt(st.rows[0].last_block, 10) : 0;
            if (!fromBlock) {
                // First scan: bound the backfill so public RPCs stay happy.
                const latest = await currentHead(network);
                fromBlock = Math.max(0, latest - 2000);
            }
            let latestBlock = null;
            for (const token of SUPPORTED_TOKENS) {
                if (!NETWORKS[network][token]) continue;
                const { transfers, latest } = await scanDeposits(network, [...byAddr.keys()], fromBlock, token);
                latestBlock = latestBlock === null ? latest : Math.max(latestBlock, latest);
                for (const t of transfers) {
                    const accountId = byAddr.get(t.to);
                    if (!accountId) continue;
                    const ref = `${t.txHash}:${t.logIndex}`;
                    const dup = await db.query('SELECT id FROM transactions WHERE external_reference = $1 LIMIT 1', [ref]);
                    if (dup.rows.length > 0) continue;
                    const label = token.toUpperCase();
                    // ponytail: atomic increment — concurrent checks can't double-credit
                    const upd = await db.query(
                        'UPDATE accounts SET balance = balance + $2, available_balance = available_balance + $2 WHERE id = $1 RETURNING balance',
                        [accountId, t.amount]
                    );
                    if (upd.rows.length === 0) continue;
                    const newBalance = parseFloat(upd.rows[0].balance);
                    await createTransaction({
                        account_id: accountId,
                        user_id: req.user.id,
                        type: 'deposit',
                        status: 'completed',
                        amount: t.amount,
                        currency: 'USD',
                        balance_before: newBalance - t.amount,
                        balance_after: newBalance,
                        description: `${label} deposit - $${t.amount.toFixed(2)} (${NETWORKS[network].label})`,
                        category: 'income',
                        external_reference: ref,
                        metadata: { provider: token, network, tx_hash: t.txHash },
                    });
                    await createNotification(req.user.id, {
                        type: 'transaction',
                        title: `${label} Deposit Confirmed`,
                        message: `$${t.amount.toFixed(2)} ${label} received on ${NETWORKS[network].label}. New balance: $${newBalance.toFixed(2)}`,
                    });
                    credited.push({ amount: t.amount, txHash: t.txHash, network, token: label });
                }
            }
            if (latestBlock !== null) {
                await db.query(
                    `INSERT INTO usdc_scan_state (network, last_block) VALUES ($1, $2)
                     ON CONFLICT (network) DO UPDATE SET last_block = GREATEST(usdc_scan_state.last_block, $2), updated_at = NOW()`,
                    [network, latestBlock]
                );
            }
        }
        return res.status(200).json({ success: true, credited });
    } catch (error) {
        console.error('USDC check error:', error.message);
        return res.status(500).json({ success: false, message: 'USDC scan failed. Try again in a minute.' });
    }
});

async function currentHead(network) {
    const { NETWORKS: N } = require('../payments/usdc');
    const r = await fetch(N[network].rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    const data = await r.json();
    return parseInt(data.result, 16);
}

module.exports = router;
