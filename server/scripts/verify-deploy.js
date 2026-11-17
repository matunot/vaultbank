#!/usr/bin/env node
/**
 * VaultBank deploy verification — public, safe, money-free probe.
 *
 * Usage: node scripts/verify-deploy.js [base-url]
 *        (default: the live single-origin deployment)
 *
 * Checks:
 *   1. GET  /health -> live API process
 *   2. GET  /ready  -> connected PostgreSQL database
 *   3. GET  /       -> customer SPA shell
 *   4. GET  /api/payments/readiness -> native bank-user rail state only
 *   5. GET  /api/direct-upi/availability -> new production UPI intents retired
 *   6. POST legacy Nium webhook -> 404 (route removed)
 *   7. POST legacy VB Pay merchant route -> 404 (merchant product removed)
 *
 * Exit: 0 all pass · 1 any failure.
 */

const base = String(process.argv[2] || 'https://vaultbank-md20.onrender.com').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 10000;
function fetchWithTimeout(url, options = {}) {
    return fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}
const results = [];
function mark(step, ok, note) {
    results.push({ step, ok, note });
    console.log((ok ? '[PASS] ' : '[FAIL] ') + step + (note ? ' — ' + note : ''));
}

async function main() {
    let ok = true;
    try {
        const h = await fetchWithTimeout(base + '/health');
        const body = await h.json();
        const healthOk = h.status === 200 && body.status === 'ok';
        mark('health', healthOk, 'HTTP ' + h.status + ' authProbe=' + body.authProbe + ' uptime=' + Math.round((body.uptime || 0) / 1000) + 's');
        if (!healthOk) ok = false;
    } catch (e) { mark('health', false, e.message); ok = false; }

    try {
        const r = await fetchWithTimeout(base + '/ready');
        const body = await r.json();
        const databaseOk = r.status === 200 && body.status === 'ready' && body.database === 'connected';
        mark('PostgreSQL readiness', databaseOk, 'HTTP ' + r.status + ' database=' + String(body.database || 'unknown'));
        if (!databaseOk) ok = false;
    } catch (e) { mark('PostgreSQL readiness', false, e.message); ok = false; }

    try {
        const s = await fetchWithTimeout(base + '/');
        const text = await s.text();
        const spaOk = s.status === 200 && /<\/html>/i.test(text);
        mark('SPA shell', spaOk, 'HTTP ' + s.status + ', ' + text.length + ' bytes');
        if (!spaOk) ok = false;
    } catch (e) { mark('SPA shell', false, e.message); ok = false; }

    // Public, money-free probe of VaultBank-native bank-user rail availability.
    try {
        const response = await fetchWithTimeout(base + '/api/payments/readiness');
        const body = await response.json();
        const inr = body && body.rails && body.rails.inr;
        const usd = body && body.rails && body.rails.usd;
        const shapeOk = response.status === 200 && body.success === true
            && body.nativeOnly === true && inr && usd && Array.isArray(body.currencies);
        const describe = (value, reason) => (value ? 'ready' : 'disabled') + (reason ? ' (' + reason + ')' : '');
        const note = shapeOk
            ? 'INR bank-receive-instructions=' + describe(inr.bankTransferInstructions)
                + '; USD bank-receive-instructions=' + describe(usd.bankTransferInstructions)
                + '; manual-bank-payout=' + describe(inr.directBankPayouts, inr.directBankPayoutsReason)
                + '; internal-transfers=' + String(!!inr.internalTransfers && !!usd.internalTransfers)
                + '; USD ACH automatic-transfer=' + String(!!usd.achAutomaticTransfer)
                + '; USD external-withdrawals=' + String(!!usd.externalWithdrawals)
            : 'HTTP ' + response.status + ' — native readiness payload unavailable';
        mark('native bank-user readiness', !!shapeOk, note);
        if (!shapeOk) ok = false;

        const nativeOnlyOk = !!shapeOk
            && inr.internalTransfers === true
            && usd.internalTransfers === true
            && inr.directBankPayoutsAutoTransfer === false
            && usd.achAutomaticTransfer === false
            && usd.externalWithdrawals === false;
        mark(
            'native money-movement safety',
            nativeOnlyOk,
            nativeOnlyOk
                ? 'same-currency internal transfers available; automatic ACH, automatic bank payouts, and USD external withdrawals off'
                : 'native bank-transfer safety invariant is violated or missing'
        );
        if (!nativeOnlyOk) ok = false;
    } catch (e) { mark('native bank-user readiness', false, e.message); ok = false; }

    // Production no longer creates UPI intents. Historical rows remain for admin reconciliation.
    try {
        const response = await fetchWithTimeout(base + '/api/direct-upi/availability');
        const body = await response.json();
        const retired = response.status === 200 && body.success === true
            && body.available === false && body.reason === 'retired' && body.autoCredit === false;
        mark('new production UPI intents retired', retired, 'HTTP ' + response.status + ' reason=' + String(body.reason || 'unknown'));
        if (!retired) ok = false;
    } catch (e) { mark('new production UPI intents retired', false, e.message); ok = false; }

    // Merchant checkout and external processor routes must no longer be mounted.
    const removedRoutes = [
        ['legacy Nium webhook route removed', '/api/providers/nium/webhook'],
        ['VB Pay merchant route removed', '/api/vbpay/merchant'],
    ];
    for (const [label, route] of removedRoutes) {
        try {
            const response = await fetchWithTimeout(base + route, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            const removed = response.status === 404;
            mark(label, removed, 'HTTP ' + response.status + (removed ? '' : ' — route should not be mounted'));
            if (!removed) ok = false;
        } catch (e) { mark(label, false, e.message); ok = false; }
    }

    console.log('');
    console.log('Deploy verification for ' + base + ': ' + results.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + r.step).join(' | '));
    process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('Probe crashed: ' + (e && e.message)); process.exit(1); });
