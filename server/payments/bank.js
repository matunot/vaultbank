/**
 * Bank Transfer Payment Adapter
 *
 * Handles bank transfers (ACH, NEFT, RTGS, wire transfers).
 * In production, integrates with banking APIs like Plaid, Dwolla,
 * or direct bank integrations. Currently uses mock mode for demo.
 *
 * Environment variables:
 *   BANK_TRANSFER_PROVIDER - Bank transfer provider (plaid | dwolla | mock)
 *   BANK_TRANSFER_API_KEY  - Provider API key
 *   BANK_TRANSFER_SECRET   - Provider secret
 */

const { v4: uuidv4 } = require('uuid');
const { demoStore } = require('../config/database');

// In-memory store for bank transfers
const bankTransfers = new Map();

// Bank transfer types
const TRANSFER_TYPES = {
    ACH: 'ach',           // US Automated Clearing House
    WIRE: 'wire',         // Wire transfer
    NEFT: 'neft',         // India National Electronic Funds Transfer
    RTGS: 'rtgs',         // India Real Time Gross Settlement
    IMPS: 'imps',         // India Immediate Payment Service
    SEPA: 'sepa',         // EU Single Euro Payments Area
    SWIFT: 'swift'        // International wire transfer
};

/**
 * Create a bank transfer
 * @param {Object} payload
 * @param {number} payload.amount - Transfer amount
 * @param {string} payload.currency - Currency code
 * @param {string} payload.recipientAccount - Recipient account number
 * @param {string} payload.recipientName - Recipient name
 * @param {string} payload.routingNumber - Bank routing number (ABA, IFSC, etc.)
 * @param {string} payload.transferType - Transfer type (ach, wire, neft, etc.)
 * @param {string} payload.userId - User identifier
 * @param {string} payload.description - Transfer description
 * @returns {Promise<Object>} Transfer result
 */
async function createPaymentIntent(payload) {
    const {
        amount,
        currency = 'USD',
        recipientAccount,
        recipientName,
        routingNumber,
        transferType = TRANSFER_TYPES.ACH,
        userId,
        description = 'Bank Transfer'
    } = payload;

    const transferId = `VB-BNK-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const referenceNumber = generateReferenceNumber(transferType);

    // Validate required fields
    if (!recipientAccount) {
        throw new Error('Recipient account number is required');
    }

    // Determine processing time based on transfer type
    const processingTime = getProcessingTime(transferType);

    // Calculate estimated completion
    const estimatedCompletion = new Date();
    estimatedCompletion.setHours(estimatedCompletion.getHours() + processingTime.hours);

    const transfer = {
        id: transferId,
        provider: 'bank',
        type: transferType,
        amount: parseFloat(amount),
        currency,
        recipientAccount: maskAccountNumber(recipientAccount),
        recipientName: recipientName || 'Unknown',
        routingNumber: routingNumber ? maskRoutingNumber(routingNumber) : null,
        fromUserId: userId,
        description,
        reference: referenceNumber,
        status: 'processing',
        estimatedCompletion: estimatedCompletion.toISOString(),
        createdAt: new Date().toISOString(),
        metadata: {
            originalAccount: recipientAccount,
            originalRouting: routingNumber
        }
    };

    bankTransfers.set(transferId, transfer);

    // Record audit log
    if (demoStore.auditLogs) {
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: 'bank_transfer_initiated',
            category: 'financial',
            resourceId: transferId,
            details: JSON.stringify({
                amount: transfer.amount,
                currency,
                transferType,
                referenceNumber
            }),
            timestamp: new Date().toISOString()
        });
    }

    return {
        provider: 'bank',
        providerId: transferId,
        reference: referenceNumber,
        status: 'processing',
        amount: transfer.amount,
        currency,
        estimatedCompletion: estimatedCompletion.toISOString(),
        processingTimeHours: processingTime.hours,
        transferType,
        message: `Bank transfer initiated. ${processingTime.message}`
    };
}

/**
 * Get transfer status
 * @param {string} providerId - Transfer ID
 * @returns {Promise<Object>} { status, details }
 */
async function getStatus(providerId) {
    const transfer = bankTransfers.get(providerId);
    if (!transfer) {
        return { status: 'not_found', details: null };
    }

    // Simulate status progression
    const created = new Date(transfer.createdAt);
    const now = new Date();
    const hoursElapsed = (now - created) / (1000 * 60 * 60);

    if (transfer.status === 'processing') {
        if (hoursElapsed > 24) {
            transfer.status = 'completed';
            transfer.completedAt = new Date().toISOString();
        } else if (hoursElapsed > 4) {
            transfer.status = 'sent';
        }
    }

    return {
        status: transfer.status,
        details: transfer
    };
}

/**
 * Generate reference number based on transfer type
 * @param {string} transferType
 * @returns {string}
 */
function generateReferenceNumber(transferType) {
    const prefix = {
        ach: 'ACH',
        wire: 'WIR',
        neft: 'NFT',
        rtgs: 'RTG',
        imps: 'IMP',
        sepa: 'SEP',
        swift: 'SWF'
    }[transferType] || 'TRF';

    return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

/**
 * Get processing time for transfer type
 * @param {string} transferType
 * @returns {Object} { hours, message }
 */
function getProcessingTime(transferType) {
    const times = {
        ach: { hours: 72, message: 'ACH transfers typically take 1-3 business days.' },
        wire: { hours: 24, message: 'Wire transfers typically complete within 24 hours.' },
        neft: { hours: 2, message: 'NEFT transfers process in batches every 30 minutes.' },
        rtgs: { hours: 1, message: 'RTGS transfers are processed in real-time.' },
        imps: { hours: 0.5, message: 'IMPS transfers are instant.' },
        sepa: { hours: 24, message: 'SEPA transfers take 1 business day.' },
        swift: { hours: 72, message: 'SWIFT transfers take 1-3 business days.' }
    };
    return times[transferType] || { hours: 48, message: 'Transfer processing time varies.' };
}

/**
 * Mask account number for display
 * @param {string} accountNumber
 * @returns {string}
 */
function maskAccountNumber(accountNumber) {
    if (!accountNumber || accountNumber.length < 4) return '****';
    return '****' + accountNumber.slice(-4);
}

/**
 * Mask routing number for display
 * @param {string} routingNumber
 * @returns {string}
 */
function maskRoutingNumber(routingNumber) {
    if (!routingNumber || routingNumber.length < 4) return '****';
    return '****' + routingNumber.slice(-4);
}

/**
 * Verify bank transfer webhook
 * @param {Object} req - Express request
 * @returns {Object} { event, verified }
 */
function verifyWebhook(req) {
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // In production, verify provider signature
    return {
        event,
        verified: true,
        mock: true
    };
}

module.exports = {
    createPaymentIntent,
    getStatus,
    verifyWebhook,
    TRANSFER_TYPES
};