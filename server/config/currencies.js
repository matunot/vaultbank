'use strict';

/**
 * VaultBank currency registry — the single source of truth for which
 * currencies the ledger can denominate and which ones are operationally
 * enabled for customers.
 *
 * Only USD and INR are enabled by default because those are the only
 * currencies with a funded, verifiable path today. Additional currencies
 * become usable only when an operator both enables multi-currency
 * (`VB_MULTICURRENCY_ENABLED=true`) and configures a real receiving account
 * for that currency (`VB_BANK_RECEIVING_<CODE>_*`). Enabling a currency never
 * creates a balance, an exchange rate, or a settlement rail.
 *
 * Foreign exchange is intentionally absent. This registry only describes
 * denomination; it must never be used to convert between currencies.
 */

const DEFINITIONS = {
    USD: { code: 'USD', name: 'US Dollar', symbol: '$', region: 'US', minorUnits: 2, core: true, receiving: true, manualPayout: false },
    INR: { code: 'INR', name: 'Indian Rupee', symbol: '\u20B9', region: 'IN', minorUnits: 2, core: true, receiving: true, manualPayout: true },
    AED: { code: 'AED', name: 'UAE Dirham', symbol: '\u062F.\u0625', region: 'AE', minorUnits: 2, core: false, receiving: true, manualPayout: false },
    GBP: { code: 'GBP', name: 'Pound Sterling', symbol: '\u00A3', region: 'GB', minorUnits: 2, core: false, receiving: true, manualPayout: false },
    EUR: { code: 'EUR', name: 'Euro', symbol: '\u20AC', region: 'EU', minorUnits: 2, core: false, receiving: true, manualPayout: false },
    CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', region: 'CA', minorUnits: 2, core: false, receiving: true, manualPayout: false },
    AUD: { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', region: 'AU', minorUnits: 2, core: false, receiving: true, manualPayout: false },
    SGD: { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', region: 'SG', minorUnits: 2, core: false, receiving: true, manualPayout: false },
    NZD: { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', region: 'NZ', minorUnits: 2, core: false, receiving: true, manualPayout: false },
    CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', region: 'CH', minorUnits: 2, core: false, receiving: true, manualPayout: false },
    HKD: { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', region: 'HK', minorUnits: 2, core: false, receiving: true, manualPayout: false },
};

for (const definition of Object.values(DEFINITIONS)) Object.freeze(definition);
Object.freeze(DEFINITIONS);

const CODES = Object.freeze(Object.keys(DEFINITIONS));
const SQL_CURRENCY_LIST = CODES.map((code) => `'${code}'`).join(', ');

function normalizeCurrency(value) {
    return String(value == null ? '' : value).trim().toUpperCase();
}

function multiCurrencyEnabled(env = process.env) {
    return String(env.VB_MULTICURRENCY_ENABLED || '').trim().toLowerCase() === 'true';
}

function getCurrency(value) {
    return DEFINITIONS[normalizeCurrency(value)] || null;
}

function isKnownCurrency(value) {
    return !!getCurrency(value);
}

/** A currency the ledger may store at all (schema-level allowlist). */
function isSupportedCurrency(value) {
    return isKnownCurrency(value);
}

/** A currency a customer may actually hold and transfer today. */
function isCurrencyEnabled(value, env = process.env) {
    const definition = getCurrency(value);
    if (!definition) return false;
    return definition.core || multiCurrencyEnabled(env);
}

function enabledCurrencies(env = process.env) {
    return CODES.filter((code) => isCurrencyEnabled(code, env));
}

function knownCurrencies() {
    return CODES.slice();
}

/**
 * Public, secret-free description of every currency. `bankReceiving` is a
 * capability flag, not a promise: an operator must still configure and verify
 * a real receiving account before any instruction can be created.
 */
function describeCurrencies(env = process.env) {
    return CODES.map((code) => {
        const definition = DEFINITIONS[code];
        const enabled = isCurrencyEnabled(code, env);
        return {
            code,
            name: definition.name,
            symbol: definition.symbol,
            region: definition.region,
            minorUnits: definition.minorUnits,
            enabled,
            internalTransfers: enabled,
            bankReceiving: enabled && definition.receiving,
            manualPayout: enabled && definition.manualPayout,
            fx: false,
        };
    });
}

function currencyError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertEnabledCurrency(value) {
    const code = normalizeCurrency(value);
    if (!isKnownCurrency(code)) {
        throw currencyError('VB_CURRENCY_UNKNOWN', `Currency ${code || '(none)'} is not in the VaultBank currency registry.`);
    }
    if (!isCurrencyEnabled(code)) {
        throw currencyError('VB_CURRENCY_DISABLED', `Currency ${code} is registered but not enabled by the operator.`);
    }
    return code;
}

module.exports = {
    CURRENCIES: DEFINITIONS,
    CODES,
    SQL_CURRENCY_LIST,
    normalizeCurrency,
    multiCurrencyEnabled,
    getCurrency,
    isKnownCurrency,
    isSupportedCurrency,
    isCurrencyEnabled,
    enabledCurrencies,
    knownCurrencies,
    describeCurrencies,
    assertEnabledCurrency,
};
