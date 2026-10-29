'use strict';

/**
 * Public, secret-free currency availability.
 *
 * This endpoint never exposes bank account details, customer data, or
 * credentials. It tells a client which denominations the ledger supports, which
 * ones an operator has enabled, and whether an incoming bank rail is actually
 * configured for that currency. `fx: false` is deliberate: VaultBank does not
 * convert between currencies.
 */

const express = require('express');
const router = express.Router();
const { describeCurrencies } = require('../config/currencies');
const { receivingStatus } = require('../services/bankReceivingConfig');

router.get('/api/currencies', (req, res) => {
    const receiving = new Map(receivingStatus().map((entry) => [entry.currency, entry]));
    const currencies = describeCurrencies().map((currency) => {
        const rail = receiving.get(currency.code) || { enabled: false, reason: 'receiving-account-not-configured' };
        return {
            code: currency.code,
            name: currency.name,
            symbol: currency.symbol,
            region: currency.region,
            minorUnits: currency.minorUnits,
            enabled: currency.enabled,
            internalTransfers: currency.internalTransfers,
            receivingCapability: currency.bankReceiving,
            bankReceivingConfigured: currency.bankReceiving && rail.enabled === true,
            receivingVerification: 'manual-bank-statement',
            manualPayout: currency.manualPayout,
            manualPayoutAutoTransfer: false,
            fx: false,
        };
    });

    res.status(200).json({
        success: true,
        fx: false,
        settlement: 'manual-verification',
        currencies,
    });
});

module.exports = router;
