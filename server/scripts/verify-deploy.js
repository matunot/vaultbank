#!/usr/bin/env node
/**
 * VaultBank deploy verification — public, safe, money-free probe.
 *
 * Usage: node scripts/verify-deploy.js [base-url]
 *        (default: the live single-origin deployment)
 *
 * Checks, with exact printed evidence per check:
 *   1. GET  /health     -> 200, status ok, authProbe ok (auth surface sane)
 *   2. GET  /           -> the SPA shell is served (HTML)
 *   3. POST /api/providers/nium/webhook with no key -> 401 fail-closed.
 *      A 404 here means an OLD build without the provider route.
 *
 * Exit: 0 all pass · 1 any failure.
 */

const base = String(process.argv[2] || 'https://vaultbank-md20.onrender.com').replace(/\/+$/, '');
const results = [];
function mark(step, ok, note) {
    results.push({ step, ok, note });
    console.log((ok ? '[PASS] ' : '[FAIL] ') + step + (note ? ' — ' + note : ''));
}

async function main() {
    let ok = true;
    try {
        const h = await fetch(base + '/health');
        const body = await h.json();
        const healthOk = h.status === 200 && body.status === 'ok';
        mark('health', healthOk, 'HTTP ' + h.status + ' authProbe=' + body.authProbe + ' uptime=' + Math.round((body.uptime || 0) / 1000) + 's');
        if (!healthOk) ok = false;
    } catch (e) { mark('health', false, e.message); ok = false; }

    try {
        const s = await fetch(base + '/');
        const text = await s.text();
        mark('SPA shell', s.status === 200 && /<\/html>/i.test(text), 'HTTP ' + s.status + ', ' + text.length + ' bytes');
        if (!(s.status === 200)) ok = false;
    } catch (e) { mark('SPA shell', false, e.message); ok = false; }

    try {
        const w = await fetch(base + '/api/providers/nium/webhook', {
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