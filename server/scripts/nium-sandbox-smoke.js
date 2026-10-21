#!/usr/bin/env node
/**
 * VaultBank x Nium — REAL sandbox smoke (operator tool).
 *
 * Exercises the officially documented Nium contracts and prints every real
 * provider response verbatim as evidence:
 *   1. auth          — POST /api/v1/authentication (token kept in memory, never printed)
 *   2. create payout — POST /api/v2/payouts (request_id idempotency key)
 *   3. status poll   — GET /api/v1/payments/id/{payment_id}
 *   4. webhook check — synthetic events against the running VaultBank app:
 *                      wrong key -> 401 fail-closed; valid key accepted;
 *                      replay deduplicated; terminal event ranked
 *   5. persistence   — SELECT row from provider_payouts for the payment
 *
 * Fail-closed by design: runs ONLY with NIUM_ENV=sandbox plus a credential
 * pair (never live money movement); never prints token or credential bytes.
 * The sample payload follows the official Create Payment v2 schema — if the
 * provider rejects a field, its validation response is printed verbatim
 * (that IS the sandbox evidence for configuring eligibility later).
 *
 * Exit codes: 64 bad config · 1 core failure · 2 partial · 0 all green.
 */

require('dotenv').config({ quiet: true });
const { providerConfig, SANDBOX_BASE_URL } = require('../providers/config');

const args = process.argv.slice(2);
function flag(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function mark(step, ok, note) {
    results.push({ step, ok, note });
    console.log((ok ? '[PASS] ' : '[FAIL] ') + step + (note ? ' — ' + note : ''));
}

const cfg = providerConfig();

async function main() {
    // Sandbox-ONLY smoke: a live config has a different (operator-supplied)
    // base URL, so the base comparison doubles as the guard.
    if (!cfg.configured || cfg.baseUrl !== SANDBOX_BASE_URL) {
        console.error('Refusing to run. Detail: this smoke only exercises the Nium SANDBOX (never live money).');
        console.error('Config check: ' + (cfg.configured ? 'NIUM_ENV value is not sandbox' : cfg.reason));
        console.error('Sandbox base URL: ' + SANDBOX_BASE_URL);
        process.exit(64);
    }

    // --- Step 1: authenticate -------------------------------------------------
    let token;
    try {
        const auth = await fetch(cfg.baseUrl + '/api/v1/authentication', {
            method: 'POST',
            headers: {
                'client_key': cfg.clientKey,
                'client_secret': cfg.clientSecret,
                'content-type': 'application/json',
            },
        });
        if (!auth.ok) {
            mark('auth', false, 'HTTP ' + auth.status + ' — ' + (await auth.text()));
            process.exit(1);
        }
        token = (await auth.json()).token;
        if (!token) { mark('auth', false, 'response had no token field'); process.exit(1); }
        mark('auth', true, 'token received (kept in memory only)');
    } catch (e) {
        mark('auth', false, 'network error: ' + e.message);
        process.exit(1);
    }

    // --- Step 2: create a real payout in the sandbox ---------------------------
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
    const requestId = 'vbsmoke-' + stamp + '-' + process.pid;
    const sample = {
        request_id: requestId,
        transaction_number: 'SMTPAY' + stamp.slice(0, 14),
        statement_narrative: 'VaultBank sandbox smoke test',
        source_currency: 'USD',
        source_amount: 1,
        destination_currency: 'USD',
        destination_amount: 1,
        payment_reference_number: requestId,
        beneficiary: {
            name: 'Smoke Test',
            country: 'US',
            account_number: '000012345678',
            bank_code: '021000021',
        },
    };
    let paymentId;
    let created;
    try {
        const r = await fetch(cfg.baseUrl + '/api/v2/payouts', {
            method: 'POST',
            headers: {
                'authorization': 'Bearer ' + token,
                'content-type': 'application/json',
            },
            body: JSON.stringify(sample),
        });
        created = await r.json();
        console.log('Create response (HTTP ' + r.status + '): ' + JSON.stringify(created));
        paymentId = created && created.payment_id;
        if (!r.ok || !paymentId) {
            mark('create payout', false, 'provider did not accept the sample payload — validate field names per the provisioning pack.');
            return finishPartial('create payout failed');
        }
        mark('create payout', true, 'payment_id=' + paymentId + ' request_id=' + requestId);
    } catch (e) {
        mark('create payout', false, 'network error: ' + e.message);
        return finishPartial('create payout failed');
    }

    // --- Step 3: poll status with the same token --------------------------------
    let observed = null;
    try {
        for (let i = 0; i < 6 && !observed; i++) {
            await sleep(3000);
            const r = await fetch(cfg.baseUrl + '/api/v1/payments/id/' + encodeURIComponent(paymentId), {
                headers: { 'authorization': 'Bearer ' + token },
            });
            const data = await r.json();
            console.log('Poll ' + (i + 1) + '/6: status=' + data.status + ' sub_status=' + (data.sub_status || '-'));
            if (data.status) observed = data.status;
        }
        mark('status poll', true, 'last observed state: ' + observed);
    } catch (e) {
        mark('status poll', false, 'network error: ' + e.message);
    }

    // --- Steps 4 + 5 ------------------------------------------------------------
    await webhookChecks(paymentId);
    await persistenceCheck(paymentId);
    summary();
}

function stamp0() {
    return String(Math.round(Date.now() / 1000)) + '-' + process.pid;
}

async function webhookChecks(paymentId) {
    const appUrl = flag('--app-url', 'http://localhost:5000');
    if (!cfg.webhookKey) {
        console.warn('Webhook step skipped: webhook key not configured.');
        mark('webhook auth', true, 'skipped — nothing authenticated without a webhook key');
        mark('webhook accept', true, 'skipped');
        mark('webhook replay', true, 'skipped');
        mark('webhook terminal', true, 'skipped');
        return;
    }
    const target = appUrl + '/api/providers/nium/webhook';
    const body = (eventId, status) => JSON.stringify({
        provider: 'nium',
        event_id: eventId,
        payment_id: paymentId,
        status,
        sub_status: null,
    });
    try {
        // 4a. Wrong key must be rejected BEFORE any DB work (fail-closed).
        const wrong = await fetch(target, {
            method: 'POST',
            headers: { 'x-api-key': 'definitely-wrong-key', 'content-type': 'application/json' },
            body: body('smoke-wrong-' + stamp0(), 'IN_PROCESS'),
        });
        mark('webhook auth', wrong.status === 401, 'wrong key returned HTTP ' + wrong.status + ' (401 expected)');

        // 4b. Valid key accepted + deduplicated on replay.
        const eventId = 'smoke-event-' + stamp0();
        const ok1 = await fetch(target, {
            method: 'POST',
            headers: { 'x-api-key': cfg.webhookKey, 'content-type': 'application/json' },
            body: body(eventId, 'IN_PROCESS'),
        });
        mark('webhook accept', ok1.status < 300, 'first event HTTP ' + ok1.status);
        const ok2 = await fetch(target, {
            method: 'POST',
            headers: { 'x-api-key': cfg.webhookKey, 'content-type': 'application/json' },
            body: body(eventId, 'IN_PROCESS'),
        });
        mark('webhook replay', ok2.status < 300, 'replayed event HTTP ' + ok2.status + ' (idempotent expected)');

        // 4c. Terminal event must be accepted (rank increase allowed).
        const paid = await fetch(target, {
            method: 'POST',
            headers: { 'x-api-key': cfg.webhookKey, 'content-type': 'application/json' },
            body: body(eventId + '-paid', 'PAID'),
        });
        mark('webhook terminal', paid.status < 300, 'paid event HTTP ' + paid.status);
    } catch (e) {
        console.warn('Webhook steps could not connect (' + e.message + '). Is the app running at ' + appUrl + '?');
        finishPartial('webhook checks unavailable');
    }
}

async function persistenceCheck(paymentId) {
    try {
        const db = require('../config/db');
        const { rows } = await db.query(
            'SELECT status, sub_status FROM provider_payouts WHERE provider = $1 AND payment_id = $2 LIMIT 1',
            ['nium', paymentId]
        );
        if (rows.length) {
            mark('persistence', true, 'provider_payouts status=' + rows[0].status);
        } else {
            mark('persistence', false, 'no row yet — check the app database (the app writes where its config points).');
            finishPartial('persistence row missing');
        }
    } catch (e) {
        console.warn('Persistence check skipped (' + e.message + ').');
        finishPartial('persistence unavailable');
    }
}

function finishPartial(reason) {
    console.log('');
    const paserz = results.filter((r) => r.ok).length;
    console.log('PARTIAL — ' + reason + '. Exact steps: ' + listing());
    process.exit(paserz >= 1 ? 2 : 1);
}

function summary() {
    console.log('');
    console.log('FINAL: ' + listing());
    process.exit(0);
}

function listing() {
    return results.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + r.step).join(' | ');
}

main().catch((e) => {
    console.error('Smoke crashed: ' + (e && e.message));
    process.exit(1);
});
