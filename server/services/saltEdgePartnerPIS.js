'use strict';

const crypto = require('crypto');

const API_BASE = 'https://www.saltedge.com/api/partners/v1';
const CALLBACK_PUBLIC_KEYS = Object.freeze({
    '4.0': [
        '-----BEGIN PUBLIC KEY-----',
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzi1XL1b0XwUYVHj7/AR6',
        'Hr0YN34wH/bDOIub0nwt0s/s3tD+DPxNB85xpMEZrLikPW5PAKkQ/oC3OyPYxKOb',
        '8TNhzGmQhEfyCkbdRwxNZqRMRwuOc+N4sdBtQKPN8+XF3RIcRZAk25JGROtb1M2o',
        'd/Nb9QqdQwMjdk6W+Vdq5Sj25Tj2efJc8zmBJkNXR4WtW45p4XSdjSEjuVCSZjOy',
        '+N8/Od8MGixC99jYbiKm3RrVDJCgDi4YYnNRI0QgxZRpJKbQX/WeZiYOrbctG3m8',
        'l1/Hpkv3w1QHz/YFIshCOKwUL+xg1hLMaW4IH7XFHenE+JlUKdCqhcWyi7oIDkyr',
        '7wIDAQAB',
        '-----END PUBLIC KEY-----',
    ].join('\n'),
});

function env(name) {
    return String(process.env[name] || '').trim();
}

function enabled(name) {
    return env(name).toLowerCase() === 'true';
}

function normalizePrivateKey(value) {
    return String(value || '').replace(/\\n/g, '\n').trim();
}

function getConfig() {
    return {
        appId: env('VB_SALT_EDGE_PIS_APP_ID'),
        secret: env('VB_SALT_EDGE_PIS_SECRET'),
        privateKey: normalizePrivateKey(process.env.VB_SALT_EDGE_PIS_PRIVATE_KEY),
        callbackBaseUrl: env('VB_SALT_EDGE_PIS_CALLBACK_BASE_URL').replace(/\/+$/, ''),
        returnUrl: env('VB_SALT_EDGE_PIS_RETURN_URL'),
        enabled: enabled('VB_SALT_EDGE_PIS_ENABLED'),
        liveApproved: enabled('VB_SALT_EDGE_PIS_LIVE_APPROVED'),
    };
}

function readiness() {
    const cfg = getConfig();
    let reason = null;
    if (!cfg.enabled) reason = 'disabled-by-operator';
    else if (!cfg.liveApproved) reason = 'salt-edge-live-approval-not-confirmed';
    else if (!cfg.appId || !cfg.secret) reason = 'api-credentials-missing';
    else if (!cfg.privateKey) reason = 'request-signing-private-key-missing';
    else if (!isSafeCallbackBaseUrl(cfg.callbackBaseUrl) || !isSafeReturnUrl(cfg.returnUrl)) reason = 'callback-or-return-url-invalid';
    const currencies = reason ? [] : configuredCurrencies();
    if (!reason && currencies.length === 0) reason = 'receiving-account-not-configured';
    return {
        provider: 'salt-edge-partner-pis',
        mode: 'live-only',
        available: !reason,
        realMoney: !reason,
        reason,
        currencies: reason ? [] : currencies,
        callbacksConfigured: Boolean(cfg.callbackBaseUrl),
        signingConfigured: Boolean(cfg.privateKey),
    };
}

function makeError(code, message, status = 503) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function requireLiveConfig() {
    const cfg = getConfig();
    const ready = readiness();
    if (!ready.available) {
        throw makeError('SALT_EDGE_PIS_NOT_READY', 'Salt Edge live Payment Initiation is not fully enabled.', 503);
    }
    return cfg;
}

function signRequest(privateKey, expiresAt, method, url, bodyText) {
    const canonical = [String(expiresAt), String(method).toUpperCase(), String(url), String(bodyText || '')].join('|');
    return crypto.sign('RSA-SHA256', Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
}

async function request(method, path, body) {
    const cfg = requireLiveConfig();
    const url = new URL(path, API_BASE + '/').toString();
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    let signature;
    try {
        signature = signRequest(cfg.privateKey, expiresAt, method, url, bodyText);
    } catch (_) {
        throw makeError('SALT_EDGE_PIS_SIGNING_FAILED', 'Salt Edge request signing failed. Check the private key format and matching public key.', 503);
    }

    let response;
    try {
        response = await fetch(url, {
            method: String(method).toUpperCase(),
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'App-id': cfg.appId,
                Secret: cfg.secret,
                'Expires-at': String(expiresAt),
                Signature: signature,
            },
            body: bodyText || undefined,
            signal: AbortSignal.timeout(20000),
        });
    } catch (_) {
        throw makeError('SALT_EDGE_PIS_NETWORK_ERROR', 'Salt Edge could not be reached. No VaultBank balance was changed.', 502);
    }

    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
        const providerError = payload && (payload.error_class || payload.error && payload.error.error_class);
        const message = providerError ? 'Salt Edge rejected the request (' + String(providerError).slice(0, 80) + ').' : 'Salt Edge rejected the request.';
        throw makeError('SALT_EDGE_PIS_PROVIDER_ERROR', message, response.status >= 500 ? 502 : 400);
    }
    return payload;
}

function callbackUrl(kind) {
    const cfg = getConfig();
    if (!['success', 'fail', 'notify'].includes(kind) || !cfg.callbackBaseUrl) return null;
    return cfg.callbackBaseUrl + '/' + kind;
}

function verifyCallback(rawBody, signature, keyVersion, url) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
    const key = CALLBACK_PUBLIC_KEYS[String(keyVersion || '')];
    if (!key || !signature || !url) return false;
    try {
        const signed = Buffer.from(url + '|' + rawBody.toString('utf8'), 'utf8');
        return crypto.verify('RSA-SHA256', signed, key, Buffer.from(String(signature), 'base64'));
    } catch (_) {
        return false;
    }
}

function configuredCurrencies() {
    const { enabledCurrencies } = require('../config/currencies');
    return enabledCurrencies().filter((currency) => {
        const config = currencyConfig(currency);
        if (!config || !config.creditorName || !/^[A-Z]{2}$/.test(config.creditorCountryCode) || !config.templateIdentifier) return false;
        const extraDestinationFields = Object.keys(config.extraFields).filter((name) =>
            name.startsWith('creditor_')
            && !['creditor_name', 'creditor_country_code', 'creditor_address', 'creditor_street_name', 'creditor_building_number', 'creditor_post_code', 'creditor_town', 'creditor_region'].includes(name)
        );
        return Boolean(config.creditorIban || extraDestinationFields.length > 0);
    });
}

function currencyConfig(currency) {
    const code = String(currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return null;
    const prefix = 'VB_SALT_EDGE_PIS_' + code + '_';
    let extraFields = {};
    const extraText = env(prefix + 'EXTRA_FIELDS_JSON');
    if (extraText) {
        try {
            const parsed = JSON.parse(extraText);
            if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null;
            extraFields = parsed;
        } catch (_) {
            return null;
        }
    }
    return {
        currency: code,
        creditorIban: env(prefix + 'CREDITOR_IBAN').replace(/\s+/g, '').toUpperCase(),
        creditorName: env(prefix + 'CREDITOR_NAME'),
        creditorCountryCode: env(prefix + 'CREDITOR_COUNTRY_CODE').toUpperCase(),
        templateIdentifier: env(prefix + 'TEMPLATE_IDENTIFIER'),
        extraFields,
    };
}

function amountString(value) {
    const text = String(value == null ? '' : value).trim();
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    const normalized = String(Number(whole)) + '.' + fraction.padEnd(2, '0');
    if (!Number.isFinite(Number(normalized)) || Number(normalized) <= 0) return null;
    return normalized;
}

function isSafeHttpsUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:'
            && !['localhost', '127.0.0.1'].includes(parsed.hostname)
            && !parsed.username && !parsed.password && !parsed.hash;
    } catch (_) {
        return false;
    }
}

function isSafeCallbackBaseUrl(value) {
    if (!isSafeHttpsUrl(value)) return false;
    try {
        const parsed = new URL(value);
        const path = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
        return !parsed.search && path === '/api/salt-edge/pis/callbacks';
    } catch (_) {
        return false;
    }
}

function isSafeReturnUrl(value) {
    return isSafeHttpsUrl(value);
}

module.exports = {
    API_BASE,
    callbackUrl,
    currencyConfig,
    configuredCurrencies,
    getConfig,
    isSafeReturnUrl,
    makeError,
    amountString,
    readiness,
    request,
    requireLiveConfig,
    signRequest,
    verifyCallback,
};
