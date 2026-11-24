'use strict';

const { readConfig, describe } = require('../../config/lightsparkGrid');
const { createGridClient } = require('./client');
const store = require('./store');
const { createPlatformService } = require('./platform');
const { createCustomerService } = require('./customers');
const { createAccountsService } = require('./accounts');
const { createQuoteService } = require('./quotes');
const { createPaymentService } = require('./payments');
const { createWebhookService } = require('./webhooks');

/**
 * Composition root. Tests can inject a fake client/store; production uses the
 * validated config and the real database-backed store.
 */
function createGridServices({ env = process.env, logger = () => {}, overrides = {} } = {}) {
  const config = overrides.config || readConfig(env);
  const client = overrides.client || createGridClient({ config, logger });
  const data = overrides.data || store;

  const platform = createPlatformService({ client, cache: data });
  const customers = createCustomerService({ client, platform, config, data });
  const accounts = createAccountsService({ client, config, platform, data });
  const quotes = createQuoteService({ client, accounts, data });
  const payments = createPaymentService({ client, quotes, config, data, logger });
  const webhooks = createWebhookService({ config, data, payments, logger });

  return { config, client, data, platform, customers, accounts, quotes, payments, webhooks, describe: () => describe(config) };
}

let singleton = null;
let singletonKey = null;

function getGridServices(env = process.env) {
  const key = [
    env.LIGHTSPARK_GRID_ENABLED, env.LIGHTSPARK_GRID_MODE, env.LIGHTSPARK_GRID_API_BASE_URL,
    env.LIGHTSPARK_GRID_CLIENT_ID,
  ].join('|');
  if (!singleton || singletonKey !== key) {
    singleton = createGridServices({ env });
    singletonKey = key;
  }
  return singleton;
}

module.exports = { createGridServices, getGridServices };
