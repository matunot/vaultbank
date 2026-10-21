/**
 * Production chain-readiness probe — READ-ONLY.
 *
 * Proves the production settlement-rail facts the operator needs, through the
 * configured public RPC, without signing or sending anything and without ever
 * printing key material:
 *   1. Network identity: eth_chainId must equal the configured chainId.
 *   2. Token presence: the configured native USDC address must have contract
 *      code (eth_getCode length > 2).
 *   3. Hot wallet: derived from the configured key locally; prints ONLY the
 *      address, plus USDC / native balances.
 *   4. Nonce: latest vs pending — pending > latest means sends in flight.
 *
 * Usage: node scripts/probe-chain.js [network]      (default: the default net)
 * Exit: 0 ready (reads OK) · 3 chainId mismatch · 4 token missing · 5 signer
 * missing · 66 unknown network · 70 never reaches the RPC.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const chain = require('../payments/usdc-hotwallet');

async function main() {
    const network = process.argv[2] || chain.defaultNetwork();
    const cfg = chain.NETWORKS[network];
    if (!cfg) {
        console.error('UNKNOWN_NETWORK: ' + network + ' (known: ' + Object.keys(chain.NETWORKS).join(', ') + ')');
        return 66;
    }
    console.log('PROBE network=' + network + ' rpc=' + cfg.rpc + ' configuredChainId=' + cfg.chainId);

    // 3. Signer: derive locally from the configured key when it exists here;
    //    otherwise accept the wallet ADDRESS as argv (address mode — no key
    //    material is needed or accessed for read-only chain facts).
    const wallet = chain.getHotWallet();
    const explicit = process.argv[3];
    if (!wallet && !chain.isValidAddress(explicit)) {
        console.error('SIGNER_MISSING: hot-wallet key not configured locally (' + chain.configStatus() + ') and no valid address given as argv[3]');
        return 5;
    }
    const address = wallet ? wallet.address : explicit;
    console.log('HOT_WALLET address=' + address + (wallet ? '' : ' (address mode — key lives in the production env only)'));

    const rpcUrl = cfg.rpc;
    const call = async (method, params) => {
        const r = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }),
        });
        const data = await r.json();
        if (data.error) throw new Error(method + ' -> ' + (data.error.message || 'rpc error'));
        return data.result;
    };

    // 1. Network identity, live.
    const liveChainId = parseInt(await call('eth_chainId'), 16);
    if (liveChainId !== cfg.chainId) {
        console.error('CHAIN_ID_MISMATCH: node says ' + liveChainId + ' but config expects ' + cfg.chainId);
        return 3;
    }
    console.log('CHAIN_ID ok: ' + liveChainId);

    // 2. Token presence, live.
    const code = await call('eth_getCode', [cfg.tokens.usdc.address, 'latest']);
    const codeSize = (String(code).length - 2) / 2;
    if (!code || code === '0x') {
        console.error('TOKEN_MISSING: no contract code at configured USDC address');
        return 4;
    }
    console.log('USDC_TOKEN ok: ' + cfg.tokens.usdc.address + ' (' + codeSize + ' bytes code, ' + cfg.tokens.usdc.decimals + ' decimals)');

    // 3. Balances of the hot wallet (USDC + native gas).
    const balances = await chain.getHotWalletBalances(network, address);
    console.log('BALANCES usdc=' + balances.usdc + ' native=' + balances.native);

    // 4. Nonce / in-flight sends.
    const addr = address.toLowerCase();
    const [latestHex, pendingHex] = await Promise.all([
        call('eth_getTransactionCount', [addr, 'latest']),
        call('eth_getTransactionCount', [addr, 'pending']),
    ]);
    const latest = parseInt(latestHex, 16);
    const pending = parseInt(pendingHex, 16);
    console.log('NONCE latest=' + latest + ' pending=' + pending + (pending > latest ? '  (sends in flight: ' + (pending - latest) + ')' : '  (no in-flight sends)'));

    if (balances.native <= 0) console.log('NOTE: native gas balance 0 — outgoing transfers will fail at gas until funded.');
    if (balances.usdc <= 0) console.log('NOTE: USDC balance 0 — withdrawals/deposits for this wallet will 503 until funded.');
    console.log('PROBE_RESULT: PASS (read path verified end to end)');
    return 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => {
    console.error('PROBE_FAILED: ' + (e.message || e));
    process.exitCode = 70;
});
