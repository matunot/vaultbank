'use strict';

/**
 * Sandbox-only integration smoke test for Lightspark Grid.
 *
 * This is engineering verification, NOT proof of real settlement. It makes no
 * money movement and prints no credentials. It is skipped unless the
 * integration is explicitly enabled in sandbox mode.
 *
 *   cd server
 *   node scripts/lightspark-grid-sandbox-smoke.js
 *   node scripts/lightspark-grid-sandbox-smoke.js --send-webhook
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { readConfig, describe } = require('../config/lightsparkGrid');
const { createGridClient } = require('../services/lightsparkGrid/client');

async function main() {
  const config = readConfig();
  if (!config.enabled || config.mode !== 'sandbox') {
    console.log(JSON.stringify({
      status: 'SKIPPED',
      reason: config.mode !== 'sandbox'
        ? 'Grid is not configured for sandbox mode'
        : 'Grid is not enabled or is missing required configuration',
      config: describe(config),
    }, null, 2));
    return;
  }

  const client = createGridClient({
    config,
    logger: (entry) => console.log(JSON.stringify({ event: entry.event, status: entry.status, durationMs: entry.durationMs })),
  });

  const configResult = await client.request({ path: '/config', timeoutMs: 12000 });
  const agreementsResult = await client.request({ path: '/customers/agreements', timeoutMs: 12000 });
  const ratesResult = await client.request({
    path: '/exchange-rates', query: { sourceCurrency: 'USD' }, timeoutMs: 12000,
  });

  const providerConfig = configResult.data || {};
  const agreements = Array.isArray(agreementsResult.data?.data) ? agreementsResult.data.data : [];
  const corridors = Array.isArray(ratesResult.data?.data) ? ratesResult.data.data : [];

  const output = {
    status: 'PASS',
    mode: config.mode,
    platformId: providerConfig.id || null,
    webhookEndpoint: providerConfig.webhookEndpoint || null,
    supportedCurrencyCodes: (providerConfig.supportedCurrencies || [])
      .map((entry) => entry && entry.currencyCode).filter(Boolean),
    agreementTypes: agreements.map((entry) => entry && entry.type).filter(Boolean),
    agreementVersions: agreements.map((entry) => entry && `${entry.type}:${entry.version}`).filter(Boolean),
    corridorCount: corridors.length,
    sampleCorridors: corridors.slice(0, 5).map((entry) => ({
      source: entry.sourceCurrency?.code,
      destination: entry.destinationCurrency?.code,
      rail: entry.destinationPaymentRail || null,
    })),
    webhookTestSent: false,
    proofOfSettlement: false,
  };

  if (process.argv.includes('--send-webhook')) {
    const testResult = await client.request({ method: 'POST', path: '/webhooks/test', timeoutMs: 12000 });
    output.webhookTestSent = true;
    output.webhookTestStatus = testResult.status;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: 'FAIL',
    code: error?.code || 'UNKNOWN',
    httpStatus: error?.status || null,
    message: String(error?.message || 'Sandbox smoke test failed').slice(0, 300),
  }, null, 2));
  process.exit(1);
});
