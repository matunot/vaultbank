'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { findAccountByUserId } = require('../config/database');
const bankDeposits = require('./bank-deposits');
const bankReceiving = require('../services/bankReceivingConfig');
const directBankPayouts = require('./direct-bank-payouts');
const usdAchPayouts = require('./usd-ach-payouts');
const { enabledCurrencies } = require('../config/currencies');
const saltEdgePIS = require('../services/saltEdgePartnerPIS');

function nativeReadiness() {
    const usdReceiving = bankDeposits.receivingConfig('USD');
    const inrReceiving = bankDeposits.receivingConfig('INR');
    const directPayout = directBankPayouts.readiness();
    const ach = usdAchPayouts.readiness();

    return {
        success: true,
        nativeOnly: true,
        rails: {
            usd: {
                bankTransferInstructions: !!(usdReceiving && usdReceiving.enabled),
                internalTransfers: true,
                externalWithdrawals: false,
                achFileExport: !!ach.available,
                achCustomerAccessEnabled: ach.customerAccessEnabled === true,
                achFileExportReason: ach.reason || null,
                achAutomaticTransfer: false,
            },
            inr: {
                bankTransferInstructions: !!(inrReceiving && inrReceiving.enabled),
                directBankPayouts: !!directPayout.available,
                directBankPayoutsAutoTransfer: false,
                directBankPayoutsCustomerAccessEnabled: directPayout.customerAccessEnabled === true,
                directBankPayoutsReason: directPayout.reason || null,
                internalTransfers: true,
            },
        },
        currencies: enabledCurrencies(),
        currencyRails: bankReceiving.receivingStatus(),
        providers: { saltEdgePartnerPIS: saltEdgePIS.readiness() },
    };
}

// Public, non-secret readiness for VaultBank-native bank rails only.
router.get('/api/payments/readiness', (_req, res) => {
    try {
        return res.status(200).json(nativeReadiness());
    } catch (error) {
        console.error('Native banking readiness error:', error.message);
        return res.status(200).json({ success: true, nativeOnly: true, rails: null, error: 'readiness-unavailable' });
    }
});

// Admin view exposes configuration state only; it never probes a merchant gateway.
router.get('/api/payments/admin/readiness', authenticateToken, requireAdmin, (_req, res) => {
    try {
        const readiness = nativeReadiness();
        return res.status(200).json({
            success: true,
            nativeOnly: true,
            rails: readiness.rails,
            currencyRails: readiness.currencyRails,
        });
    } catch (error) {
        console.error('Admin native banking readiness error:', error.message);
        return res.status(502).json({ success: false, message: 'Banking readiness could not be loaded.' });
    }
});

// Compatibility endpoint: only native account transfers and configured bank
// receiving instructions are advertised. No card, wallet-provider or gateway
// checkout options are returned.
router.get('/api/payments/methods', authenticateToken, (req, res) => {
    const currency = String(req.query.currency || 'USD').toUpperCase();
    const receiving = bankDeposits.receivingConfig(currency);
    const methods = [
        { id: 'vaultbank_account_transfer', label: 'VaultBank account transfer', type: 'internal' },
    ];
    if (receiving && receiving.enabled) {
        methods.push({ id: 'bank_transfer', label: 'Bank transfer', type: 'bank' });
    }
    if (saltEdgePIS.readiness().available) {
        methods.push({ id: 'salt_edge_bank_payment', label: 'Pay from bank', type: 'open_banking', provider: 'salt-edge-partner-pis' });
    }
    return res.status(200).json({ success: true, methods });
});

// Compatibility balance endpoint reads the real account only. It never falls
// back to an in-memory/demo wallet.
router.get('/api/payments/wallet/balance', authenticateToken, async (req, res) => {
    try {
        const account = await findAccountByUserId(req.user.id);
        if (!account) return res.status(404).json({ success: false, message: 'No account found.' });
        return res.status(200).json({
            success: true,
            balance: account.balance,
            currency: account.currency,
            accountId: account.id,
        });
    } catch (error) {
        console.error('Native account balance lookup failed:', error.message);
        return res.status(500).json({ success: false, message: 'Could not load the account balance.' });
    }
});

module.exports = router;
