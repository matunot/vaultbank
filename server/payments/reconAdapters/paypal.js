/**
 * PayPal reconciliation adapter
 * --------------------------------
 * Fetches PayPal captured payments for a given date range using the
 * Reporting API (`/v1/reporting/transactions`). Falls back to mock
 * mode when no credentials are present.
 *
 * NOTE: the full PayPal reporting API needs an additional OAuth scope
 * (`/reports/transactions`) and the LIST endpoint. To keep this adapter
 * simple we use the Transactions Search endpoint which is widely
 * available on sandbox + live.
 */

async function fetchTransactions({ startAt, endAt }) {
    const clientId = process.env.PAYMENT_PROVIDER_PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYMENT_PROVIDER_PAYPAL_SECRET;
    if (!clientId || !clientSecret || clientId.startsWith('your_paypal')) {
        console.warn('[recon-paypal] mock mode -- returning []');
        return [];
    }
    const base = clientId.startsWith('EBX') || /live/i.test(clientSecret)
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    // OAuth token
    const auth = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const tokenResp = await fetch(base + '/v1/oauth2/token', {
        method: 'POST',
        headers: {
            Authorization: 'Basic ' + auth,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });
    if (!tokenResp.ok) {
        throw new Error('PayPal OAuth failed: ' + tokenResp.status);
    }
    const token = (await tokenResp.json()).access_token;
    if (!token) throw new Error('PayPal OAuth: no access_token');

    // Transaction search -- single page; we cap at the first 500
    const startIso = startAt.toISOString();
    const endIso = endAt.toISOString();
    const url = base + '/v1/reporting/transactions' +
        '?start_date=' + encodeURIComponent(startIso) +
        '&end_date=' + encodeURIComponent(endIso) +
        '&transaction_status=SUCCESS' +
        '&page_size=500';
    const r = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
    });
    if (!r.ok) {
        throw new Error('PayPal reporting fetch failed: ' + r.status);
    }
    const data = await r.json();
    const out = [];
    for (const tx of (data.transaction_details || [])) {
        const info = tx.transaction_info || {};
        if (info.transaction_status !== 'S') continue; // only success
        out.push({
            id: info.transaction_id,
            amount: Number(info.transaction_amount) || 0,
            currency: info.transaction_currency_code,
            status: info.transaction_status,
            created: info.transaction_initiation_date ? Math.floor(new Date(info.transaction_initiation_date).getTime() / 1000) : 0,
        });
    }
    return out;
}

module.exports = { fetchTransactions };
