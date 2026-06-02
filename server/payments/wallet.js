/**
 * Internal Wallet Payment Adapter
 *
 * Handles instant internal transfers between VaultBank accounts.
 * This is a ledger-only transfer with no external provider.
 * Also used for email-based transfers.
 */

const { v4: uuidv4 } = require('uuid');
const { demoStore } = require('../config/database');

// In-memory store for wallet transfers
const walletTransfers = new Map();

/**
 * Create an internal wallet transfer
 * @param {Object} payload
 * @param {number} payload.amount - Transfer amount
 * @param {string} payload.currency - Currency code
 * @param {string} payload.to - Recipient identifier (accountId, email, or phone)
 * @param {string} payload.fromAccountId - Sender account ID
 * @param {string} payload.userId - User identifier
 * @param {string} payload.description - Transfer description
 * @param {string} payload.transferType - wallet | email
 * @returns {Promise<Object>} Transfer result
 */
async function createPaymentIntent(payload) {
    const {
        amount,
        currency = 'USD',
        to,
        fromAccountId,
        userId,
        description = 'Wallet Transfer',
        transferType = 'wallet'
    } = payload;

    const transferId = `VB-WAL-${Date.now()}-${uuidv4().slice(0, 8)}`;

    // Validate amount
    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
        throw new Error('Invalid transfer amount');
    }

    // Find sender account
    const senderAccount = demoStore.accounts?.find(a =>
        a.id === fromAccountId || a.userId === userId
    );

    // Check balance (in demo mode, allow overdraft up to $10,000)
    const senderBalance = senderAccount?.balance || 10000;
    if (transferAmount > senderBalance + 10000) {
        throw new Error('Insufficient balance');
    }

    // Find recipient account
    let recipientAccount = null;
    if (to) {
        recipientAccount = demoStore.accounts?.find(a =>
            a.id === to || a.email === to || a.phone === to
        );
    }

    const transfer = {
        id: transferId,
        provider: 'wallet',
        type: transferType,
        amount: transferAmount,
        currency,
        fromAccountId: fromAccountId || senderAccount?.id,
        fromUserId: userId,
        to: to,
        toAccountId: recipientAccount?.id,
        toUserId: recipientAccount?.userId,
        description,
        status: 'completed', // Internal transfers are instant
        reference: transferId,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
    };

    // Update sender balance
    if (senderAccount) {
        senderAccount.balance = (senderAccount.balance || 0) - transferAmount;
    }

    // Update recipient balance
    if (recipientAccount) {
        recipientAccount.balance = (recipientAccount.balance || 0) + transferAmount;
    }

    // Record in audit log
    if (demoStore.auditLogs) {
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: `${transferType}_transfer_completed`,
            category: 'financial',
            resourceId: transferId,
            details: JSON.stringify({
                amount: transferAmount,
                currency,
                to,
                fromAccountId: fromAccountId || senderAccount?.id
            }),
            timestamp: new Date().toISOString()
        });
    }

    walletTransfers.set(transferId, transfer);

    return {
        provider: 'wallet',
        providerId: transferId,
        reference: transferId,
        status: 'completed',
        amount: transferAmount,
        currency,
        fromBalance: senderAccount?.balance,
        toBalance: recipientAccount?.balance,
        recipientFound: !!recipientAccount,
        message: recipientAccount
            ? 'Transfer completed successfully'
            : 'Transfer queued - recipient will be notified via email'
    };
}

/**
 * Get transfer status
 * @param {string} providerId - Transfer ID
 * @returns {Promise<Object>} { status, details }
 */
async function getStatus(providerId) {
    const transfer = walletTransfers.get(providerId);
    if (!transfer) {
        return { status: 'not_found', details: null };
    }

    return {
        status: transfer.status,
        details: transfer
    };
}

/**
 * Get user's wallet balance
 * @param {string} userId - User identifier
 * @returns {Object} { balance, currency }
 */
function getBalance(userId) {
    const account = demoStore.accounts?.find(a => a.userId === userId);
    return {
        balance: account?.balance || 1000,
        currency: account?.currency || 'USD',
        accountId: account?.id
    };
}

/**
 * Get transfer history for a user
 * @param {string} userId - User identifier
 * @returns {Array} List of transfers
 */
function getHistory(userId) {
    return Array.from(walletTransfers.values())
        .filter(t => t.fromUserId === userId || t.toUserId === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
    createPaymentIntent,
    getStatus,
    getBalance,
    getHistory
};