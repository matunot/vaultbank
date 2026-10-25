/**
 * Preserve the exact JSON bytes for signature-verified provider webhooks.
 *
 * express.json() consumes the request stream before the route runs, so a
 * route-level express.raw() would otherwise see an already-parsed object.
 * The verify hook keeps a Buffer copy for the Cashfree collections webhook
 * only; every other request stays unchanged.
 */
function captureRawBody(req, _res, buf) {
    if (!buf || !buf.length) return;
    // Express routes are case-insensitive and trailing-slash tolerant; capture
    // must be too, or a dashboard URL with a trailing slash fails every webhook.
    const path = String(req.originalUrl || '').split('?')[0].toLowerCase().replace(/\/+$/, '');
    if (path === '/api/collections/webhook/cashfree') {
        req.rawBody = Buffer.from(buf);
    }
}

module.exports = { captureRawBody };
