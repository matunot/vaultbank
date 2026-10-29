'use strict';

/**
 * Currency-scoped bank receiving configuration.
 *
 * A receiving account is "configured" only when an operator has enabled bank
 * deposits and supplied a complete account description for that exact
 * currency. Details are never shared across currencies: an INR instruction can
 * never resolve to USD bank details (or vice versa), and an unconfigured
 * currency reports itself unavailable instead of falling back to another one.
 */

const { isCurrencyEnabled, knownCurrencies, normalizeCurrency, getCurrency } = require('../config/currencies');

const EXPIRY_HOURS = 168;
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 100000;
const MAX_OPEN = 3;

const RECEIVING_CURRENCIES = knownCurrencies().filter((code) => getCurrency(code).receiving);

function env(environment, key) {
    return String((environment && environment[key]) || '').trim();
}

function configuredReceivingCurrency(currency, environment = process.env) {
    const selected = normalizeCurrency(currency);
    const enabledFlag = env(environment, 'VB_BANK_DEPOSIT_ENABLED') === 'true';
    const base = {
        enabled: false,
        bankName: null,
        holder: null,
        details: null,
        currency: selected || null,
        verification: 'manual',
        reason: 'receiving-account-not-configured',
        expiryHours: EXPIRY_HOURS,
        minAmount: MIN_AMOUNT,
        maxAmount: MAX_AMOUNT,
        maxOpen: MAX_OPEN,
    };
    if (!RECEIVING_CURRENCIES.includes(selected)) return { ...base, reason: 'unsupported-ledger-currency' };
    if (!enabledFlag) return { ...base, reason: 'disabled-by-operator' };
    if (!isCurrencyEnabled(selected, environment)) return { ...base, reason: 'currency-not-enabled' };

    const prefix = 'VB_BANK_RECEIVING_' + selected + '_';
    const specificBank = env(environment, prefix + 'BANK_NAME');
    const specificHolder = env(environment, prefix + 'HOLDER');
    const specificDetails = env(environment, prefix + 'DETAILS');
    if (specificBank || specificHolder || specificDetails) {
        const configured = !!(specificBank && specificHolder && specificDetails);
        return {
            ...base,
            enabled: configured,
            bankName: configured ? specificBank : null,
            holder: configured ? specificHolder : null,
            details: configured ? specificDetails : null,
            reason: configured ? null : 'receiving-account-not-configured',
        };
    }

    // Backward compatibility: the legacy generic variables describe exactly
    // one currency and must never answer for a different one.
    const legacyCurrency = normalizeCurrency(environment.VB_BANK_RECEIVING_CURRENCY || 'USD');
    if (legacyCurrency !== selected) return base;
    const bankName = env(environment, 'VB_BANK_RECEIVING_BANK_NAME');
    const holder = env(environment, 'VB_BANK_RECEIVING_HOLDER');
    const details = env(environment, 'VB_BANK_RECEIVING_DETAILS');
    const configured = !!(bankName && holder && details);
    return {
        ...base,
        enabled: configured,
        bankName: configured ? bankName : null,
        holder: configured ? holder : null,
        details: configured ? details : null,
        reason: configured ? null : 'receiving-account-not-configured',
    };
}

function receivingCurrencies(environment = process.env) {
    return RECEIVING_CURRENCIES.filter((code) => configuredReceivingCurrency(code, environment).enabled);
}

function receivingConfig(currency, environment = process.env) {
    const currencies = receivingCurrencies(environment);
    if (currency != null && String(currency).trim()) {
        return { ...configuredReceivingCurrency(currency, environment), currencies };
    }
    const legacyCurrency = normalizeCurrency(environment.VB_BANK_RECEIVING_CURRENCY || 'USD');
    const preferred = currencies.includes(legacyCurrency) ? legacyCurrency : (currencies[0] || (RECEIVING_CURRENCIES.includes(legacyCurrency) ? legacyCurrency : 'USD'));
    return { ...configuredReceivingCurrency(preferred, environment), currencies };
}

/** Secret-free availability summary for readiness endpoints. */
function receivingStatus(environment = process.env) {
    return RECEIVING_CURRENCIES.map((code) => {
        const config = configuredReceivingCurrency(code, environment);
        return {
            currency: code,
            enabled: config.enabled,
            verification: 'manual-bank-statement',
            reason: config.reason,
        };
    });
}

module.exports = {
    EXPIRY_HOURS,
    MIN_AMOUNT,
    MAX_AMOUNT,
    MAX_OPEN,
    RECEIVING_CURRENCIES,
    configuredReceivingCurrency,
    receivingCurrencies,
    receivingConfig,
    receivingStatus,
};
