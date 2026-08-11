/**
 * Stripe reconciliation adapter
 * ---------------------------------
 * Fetches Stripe charges for a given date range. In live mode we use
 * the Stripe SDK; in mock mode we return an empty list and log a warning
 * so dev environments don't hit the network.
 *
 * Date filtering uses `created[gte]` and `created[lt]` with Unix
 * timestamps so Stripe can filter server-side (cheaper than fetching
 * everything).
 */

let stripeSdk = null;
function getSdk() {
    if (stripeSdk !== null) return stripeSdk;
    const key = process.env.PAYMENT_PROVIDER_STRIPE_SECRET;
    if (!key || key.startsWith('sk_test_your') || key.startsWith('replace')) {
        stripeSdk = false;
        return false;
    }
    try {
        const Stripe = require('stripe');
        stripeSdk = new Stripe(key, { apiVersion: '2023-10-16' });
        return stripeSdk;
    } catch (err) {
        console.warn('[recon-stripe] SDK unavailable:', err.message);
        stripeSdk = false;
        return false;
    }
}

async function fetchTransactions({ startAt, endAt }) {
    const sdk = getSdk();
    if (!sdk) {
        console.warn('[recon-stripe] mock mode -- returning [] (no provider tx to compare against)');
        return [];
    }
    const out = [];
    let starting_after = undefined;
    // Stripe hard-caps list endpoints at 100 per page; loop.
    for (let i = 0; i < 50; i += 1) {
        const params = {
            limit: 100,
            created: { gte: Math.floor(startAt.getTime() / 1000), lt: Math.floor(endAt.getTime() / 1000) },
        };
        if (starting_after) params.starting_after = starting_after;
        const page = await sdk.charges.list(params);
        for (const ch of page.data) {
            out.push({
                id: ch.id,
                amount: (ch.amount || 0) / 100, // Stripe returns amount in smallest unit
                currency: ch.currency,
                status: ch.status,
                created: ch.created,
            });
        }
        if (!page.has_more) break;
        starting_after = page.data[page.data.length - 1].id;
    }
    return out;
}

module.exports = { fetchTransactions };
