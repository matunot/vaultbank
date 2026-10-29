#!/usr/bin/env node
/**
 * VaultBank deploy verification — public, safe, money-free probe.
 *
 * Usage: node scripts/verify-deploy.js [base-url]
 *        (default: the live single-origin deployment)
 *
 * Checks, with exact printed evidence per check:
 *   1. GET  /health     -> 200, status ok, authProbe ok (liveness)
 *   2. GET  /ready      -> 200, database connected (PostgreSQL readiness)
 *   3. GET  /           -> the SPA shell is served (HTML)
 *   4. GET  /api/payments/readiness -> truthful, non-secret rail state.
 *   5. POST /api/providers/nium/webhook without credentials -> 401 fail-closed.
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
        mark('SPA shell', s.status === 200 && /<\/html>/i.test(text), 'HTTP ' + s.status + ', ' + text.length + ' bytes');
        if (!(s.status === 200)) ok = false;
    } catch (e) { mark('SPA shell', false, e.message); ok = false; }

    // Public, money-free probe of VaultBank-native rail availability.
    // Print only booleans and non-secret reason codes; never VPA, bank details, or credentials.
    try {
        const response = await fetchWithTimeout(base + '/api/payments/readiness');
        const body = await response.json();
        const inr = body && body.rails && body.rails.inr;
        const usd = body && body.rails && body.rails.usd;
        const shapeOk = response.status === 200 && body.success === true && inr && usd && Array.isArray(body.currencies);
        const describe = (value, reason) => (value ? 'ready' : 'disabled') + (reason ? ' (' + reason + ')' : '');
        const note = shapeOk
            ? 'INR direct-UPI=' + describe(inr.directUpi, inr.directUpiReason)
                + '; manual-bank-payout=' + describe(inr.directBankPayouts, inr.directBankPayoutsReason)
                + '; internal-transfers=' + String(!!inr.internalTransfers)
                + '; USD external-withdrawals=' + String(!!usd.externalWithdrawals)
            : 'HTTP ' + response.status + ' — readiness payload unavailable';
        mark('native money-rail readiness', !!shapeOk, note);
        if (!shapeOk) ok = false;

        // Production must stay native-only. Old provider credentials or flags
        // must not reactivate third-party collections/payouts, auto-credit, or
        // USD external withdrawals.
        const nativeOnlyOk = !!shapeOk
            && body.nativeOnly === true
            && inr.collections === false
            && inr.payouts === false
            && inr.directUpiAutoCredit === false
            && inr.directBankPayoutsAutoTransfer === false
            && usd.externalWithdrawals === false;
        mark(
            'production native-only safety',
            nativeOnlyOk,
            nativeOnlyOk
                ? 'legacy collections/payouts disabled; UPI auto-credit and automatic bank transfer off; USD external withdrawals off'
                : 'production native-only invariant is violated or missing'
        );
        if (!nativeOnlyOk) ok = false;
    } catch (e) { mark('native money-rail readiness', false, e.message); ok = false; }

    try {
        const w = await fetchWithTimeout(base + '/api/providers/nium/webhook', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        const failClosed = w.status === 401;
        const note = 'HTTP ' + w.status + (failClosed ? '' : ' — 404 would mean an old build; 200 would be a security bug');
        mark('provider webhook fail-closed', failClosed, note);
        if (!failClosed) ok = false;
    } catch (e) { mark('provider webhook fail-closed', false, e.message); ok = false; }

    console.log('');
    console.log('Deploy verification for ' + base + ': ' + results.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + r.step).join(' | '));
    process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('Probe crashed: ' + (e && e.message)); process.exit(1); });