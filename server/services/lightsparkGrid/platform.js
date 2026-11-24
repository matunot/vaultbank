'use strict';

const { GridError } = require('./errors');
const store = require('./store');

const CACHE_TTL_MS = 5 * 60 * 1000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new GridError('GRID_UNEXPECTED_RESPONSE', `Grid ${field} response was not an array.`);
  }
  return value;
}

/**
 * Capability discovery. Every currency, corridor, rail and agreement returned
 * here comes from a real Grid response; nothing is hardcoded or inferred from
 * VaultBank's own currency registry.
 */
function createPlatformService({ client, cache = store, now = () => Date.now() }) {
  function deriveCurrencyMeta(config, rateRows) {
    const allowedByConfig = new Set(
      requireArray(config?.supportedCurrencies || [], 'config.supportedCurrencies')
        .filter((entry) => isObject(entry)
          && Array.isArray(entry.enabledTransactionTypes)
          && (entry.enabledTransactionTypes.includes('OUTGOING') || entry.enabledTransactionTypes.includes('INCOMING')))
        .map((entry) => String(entry.currencyCode || '').toUpperCase())
        .filter(Boolean),
    );

    const currencies = new Map();
    for (const row of rateRows) {
      for (const key of ['sourceCurrency', 'destinationCurrency']) {
        const currency = row?.[key];
        if (!isObject(currency)) continue;
        const code = String(currency.code || '').toUpperCase();
        if (!code) continue;
        // The VaultBank ledger stores exactly two decimal places. Currencies
        // with any other precision must stay disabled until the ledger changes.
        if (Number(currency.decimals) !== 2) continue;
        if (allowedByConfig.size && !allowedByConfig.has(code)) continue;
        if (!currencies.has(code)) {
          currencies.set(code, {
            code,
            name: String(currency.name || code),
            symbol: String(currency.symbol || ''),
            decimals: 2,
          });
        }
      }
    }
    return [...currencies.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async function refreshCapabilities() {
    const configResponse = await client.request({ path: '/config', timeoutMs: 10000 });
    const config = configResponse?.data;
    if (!isObject(config)) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid config response was not an object.');
    }
    const currencyCodes = requireArray(config.supportedCurrencies || [], 'config.supportedCurrencies')
      .filter((entry) => isObject(entry) && entry.currencyCode)
      .map((entry) => String(entry.currencyCode).toUpperCase());

    const rateRows = [];
    for (const code of currencyCodes) {
      const response = await client.request({
        path: '/exchange-rates',
        query: { sourceCurrency: code },
        timeoutMs: 10000,
      });
      for (const row of requireArray(response?.data?.data || [], 'exchange-rates')) {
        if (isObject(row)) rateRows.push(row);
      }
    }

    const agreementsResponse = await client.request({ path: '/customers/agreements', timeoutMs: 10000 });
    const agreements = requireArray(agreementsResponse?.data?.data || [], 'agreements')
      .filter((entry) => isObject(entry) && entry.type && entry.version && entry.url)
      .map((entry) => ({ type: String(entry.type), version: String(entry.version), url: String(entry.url) }));

    const capabilities = {
      fetchedAt: new Date(now()).toISOString(),
      config: {
        id: config.id || null,
        webhookEndpoint: config.webhookEndpoint || null,
        isRegulatedFinancialInstitution: Boolean(config.isRegulatedFinancialInstitution),
      },
      supportedCurrencies: deriveCurrencyMeta(config, rateRows),
      agreements,
    };
    await cache.saveCapabilities({
      providerConfig: capabilities.config,
      supportedCurrencies: capabilities.supportedCurrencies,
      agreements: capabilities.agreements,
      fetchedAt: capabilities.fetchedAt,
    });
    return capabilities;
  }

  async function getCapabilities({ forceRefresh = false } = {}) {
    const cached = await cache.getCapabilities();
    const age = cached ? now() - Date.parse(cached.fetched_at) : Infinity;
    if (!forceRefresh && cached && Number.isFinite(age) && age < CACHE_TTL_MS) {
      return {
        fetchedAt: cached.fetched_at,
        config: cached.provider_config || {},
        supportedCurrencies: cached.supported_currencies || [],
        agreements: cached.agreements || [],
      };
    }
    return refreshCapabilities();
  }

  async function getCorridors(sourceCurrency, destinationCurrency) {
    const source = String(sourceCurrency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(source)) {
      throw new GridError('GRID_INVALID_CURRENCY', 'sourceCurrency must be a three-letter code.');
    }
    const query = { sourceCurrency: source };
    if (destinationCurrency) {
      const destination = String(destinationCurrency).toUpperCase();
      if (!/^[A-Z]{3}$/.test(destination)) {
        throw new GridError('GRID_INVALID_CURRENCY', 'destinationCurrency must be a three-letter code.');
      }
      query.destinationCurrency = destination;
    }
    const response = await client.request({ path: '/exchange-rates', query, timeoutMs: 10000 });
    const rows = requireArray(response?.data?.data || [], 'exchange-rates');
    return rows
      .filter((row) => isObject(row) && row.sourceCurrency && row.destinationCurrency)
      .filter((row) => Number(row.sourceCurrency?.decimals) === 2 && Number(row.destinationCurrency?.decimals) === 2)
      .map((row) => ({
        sourceCurrency: row.sourceCurrency,
        destinationCurrency: row.destinationCurrency,
        destinationPaymentRail: row.destinationPaymentRail || null,
        minSendingAmount: row.minSendingAmount ?? null,
        maxSendingAmount: row.maxSendingAmount ?? null,
        exchangeRate: row.exchangeRate ?? null,
        fees: row.fees || null,
        updatedAt: row.updatedAt || null,
        approximate: true,
      }));
  }

  return { getCapabilities, refreshCapabilities, getCorridors, deriveCurrencyMeta };
}

module.exports = { createPlatformService, CACHE_TTL_MS };
