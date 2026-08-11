/**
 * Razorpay reconciliation adapter
 * ---------------------------------
 * Fetches Razorpay payments for a given date range. Uses the SDK's
 * `payments.all()` with `from` / `to` ISO timestamps. Falls back to
 * mock mode when no real key is configured.
 */

let razorpaySdk = null;
function getSdk() {
    if (razorpaySdk !== null) return razorpaySdk;
    const keyId = process.env.PAYMENT_PROVIDER_RAZORPAY_KEY;
    const keySecret = process.env.PAYMENT_PROVIDER_RAZORPAY_SECRET;
    if (!keyId || !keySecret || keyId.startsWith('rzp_test_your')) {
        razorpaySdk = false;
        return false;
    }
    try {
        const Razorpay = require('razorpay');
        razorpaySdk = new Razorpay({ key_id: keyId, key_secret: keySecret });
        return razorpaySdk;
    } catch (err) {
        console.warn('[recon-razorpay] SDK unavailable:', err.message);
        razorpaySdk = false;
        return false;
    }
}

async function fetchTransactions({ startAt, endAt }) {
    const sdk = getSdk();
    if (!sdk) {
        console.warn('[recon-razorpay] mock mode -- returning []');
        return [];
    }
    const out = [];
    let count = 0;
    const from = Math.floor(startAt.getTime() / 1000);
    const to = Math.floor(endAt.getTime() / 1000);
    // The SDK's payments.all() doesn't filter by date, so we filter
    // client-side after the page is returned.
    while (count < 5000) {
        const page = await sdk.payments.all({ count: 100, skip: count });
        if (!page.items || !page.items.length) break;
        for (const p of page.items) {
            const created = p.created_at ? Math.floor(p.created_at) : 0;
            if (created < from) continue;
            if (created >= to) continue;
            out.push({
                id: p.id,
                amount: (p.amount || 0) / 100, // paise -> INR
                currency: p.currency,
                status: p.status,
                created,
            });
        }
        if (page.items.length < 100) break;
        count += page.items.length;
    }
    return out;
}

module.exports = { fetchTransactions };
