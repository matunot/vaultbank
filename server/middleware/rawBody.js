/**
 * Preserve the exact JSON bytes for signature-verified provider webhooks.
 *
 * express.json() consumes the request stream before a route runs, so a
 * route-level express.raw() would otherwise see an already-parsed object.
 * Never use the parsed/sanitized body to verify a provider signature.
 */
function captureRawBody(req, _res, buf) {
    if (!buf || !buf.length) return;
    const path = String(req.originalUrl || '').split('?')[0].toLowerCase().replace(/\/+$/, '');
    if (
        path === '/api/collections/webhook/cashfree'
        || path === '/api/webhooks/lightspark/grid'
        || path === '/api/webhooks/modern-treasury'
    ) {
        req.rawBody = Buffer.from(buf);
    }
}

module.exports = { captureRawBody };
