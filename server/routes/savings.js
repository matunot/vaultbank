'use strict';

/**
 * Native savings sub-accounts.
 *
 * Savings vaults are separate, zero-balance VaultBank ledger accounts. They
 * earn no promised interest and do not represent a separate external bank
 * account. Funding must already be verified before funds can be moved out.
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  db,
  isDemo,
  demoStore,
  createAccount,
  createAuditLog,
} = require('../config/database');
const { executeAtomicTransfer, notifyTransferCompletion } = require('../services/transferService');
const { ensureInrWalletIndex } = require('../services/inrWalletIndexService');

const CURRENCIES = new Set(['USD', 'INR']);
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,100}$/;
const AMOUNT_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

function serializeAccount(row) {
  return {
    id: row.id,
    accountNumber: row.account_number || row.accountNumber,
    accountType: row.account_type || row.accountType,
    accountName: row.account_name || row.accountName || 'Savings Account',
    balance: Number(row.balance || 0),
    availableBalance: Number(row.available_balance ?? row.availableBalance ?? row.balance ?? 0),
    heldBalance: Number(row.held_balance ?? row.heldBalance ?? 0),
    currency: String(row.currency || 'USD').toUpperCase(),
    status: row.status || 'active',
  };
}

function parseAmount(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!AMOUNT_RE.test(raw)) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return null;
  return amount.toFixed(2);
}

router.get('/api/savings/accounts', authenticateToken, async (req, res) => {
  try {
    let rows;
    if (isDemo) {
      rows = demoStore.accounts.filter((account) =>
        account.user_id === req.user.id &&
        String(account.account_type).toLowerCase() === 'savings' &&
        account.status === 'active'
      );
    } else {
      const result = await db.query(
        `SELECT id, user_id, account_number, account_type, account_name,
                currency, balance, available_balance, held_balance, status,
                interest_rate, opened_at
           FROM accounts
          WHERE user_id = $1 AND account_type = 'savings' AND status = 'active'
          ORDER BY created_at ASC`,
        [req.user.id]
      );
      rows = result.rows;
    }
    return res.status(200).json({
      success: true,
      accounts: rows.map(serializeAccount),
      currencies: ['USD', 'INR'],
      interestBearing: false,
    });
  } catch (error) {
    console.error('Savings accounts list failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load your savings accounts.' });
  }
});

router.post('/api/savings/accounts', authenticateToken, async (req, res) => {
  const currency = String((req.body && req.body.currency) || 'USD').trim().toUpperCase();
  if (!CURRENCIES.has(currency)) {
    return res.status(400).json({
      success: false,
      code: 'SAVINGS_CURRENCY_UNSUPPORTED',
      message: 'Savings vaults currently support USD and INR only.',
    });
  }

  try {
    if (currency === 'INR') {
      // The INR wallet's uniqueness guard must be scoped to non-savings
      // accounts before a savings vault in the same currency is created.
      await ensureInrWalletIndex();
    }
    const account = await createAccount(req.user.id, 'savings', currency);
    try {
      await createAuditLog({
        userId: req.user.id,
        action: 'savings_account_opened',
        resourceType: 'account',
        resourceId: account.id,
        details: { currency, accountType: 'savings', openingBalance: 0 },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      // Audit delivery must not turn a successfully opened zero-balance
      // account into an apparent failure and invite duplicate retries.
      console.warn('Savings account audit failed:', auditError.message);
    }
    return res.status(201).json({
      success: true,
      account: serializeAccount(account),
      message: `Your zero-balance ${currency} savings vault is open. No funds or interest were added.`,
    });
  } catch (error) {
    console.error('Savings account open failed:', error.message);
    return res.status(503).json({
      success: false,
      code: 'SAVINGS_ACCOUNT_UNAVAILABLE',
      message: 'Could not open a savings vault right now. No funds were moved.',
    });
  }
});

router.post('/api/savings/move', authenticateToken, async (req, res) => {
  const fromAccountId = String((req.body && req.body.fromAccountId) || '').trim();
  const toAccountId = String((req.body && req.body.toAccountId) || '').trim();
  const amount = parseAmount(req.body && req.body.amount);
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();

  if (!IDEMPOTENCY_RE.test(idempotencyKey)) {
    return res.status(400).json({
      success: false,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Provide an Idempotency-Key (8–100 safe characters) and reuse it for retries of this move.',
    });
  }
  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
    return res.status(400).json({
      success: false,
      code: 'SAVINGS_ACCOUNTS_INVALID',
      message: 'Choose two different VaultBank accounts you own.',
    });
  }
  if (amount == null) {
    return res.status(400).json({
      success: false,
      code: 'SAVINGS_AMOUNT_INVALID',
      message: 'Enter an amount greater than zero, up to 100,000, with at most two decimal places.',
    });
  }

  // This is a live-ledger money movement, not a demo balance adjustment.
  // Refuse in demo mode rather than presenting a mock savings transfer as real.
  if (isDemo) {
    return res.status(503).json({
      success: false,
      code: 'SAVINGS_REQUIRES_REAL_DATABASE',
      message: 'Savings transfers require the persistent PostgreSQL ledger.',
    });
  }

  try {
    const result = await db.query(
      `SELECT id, user_id, account_number, account_type, account_name, currency,
              balance, available_balance, held_balance, status
         FROM accounts
        WHERE user_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
      [req.user.id, [fromAccountId, toAccountId]]
    );
    const byId = new Map(result.rows.map((row) => [String(row.id), row]));
    const senderAccount = byId.get(fromAccountId);
    const recipientAccount = byId.get(toAccountId);

    if (!senderAccount || !recipientAccount) {
      return res.status(404).json({
        success: false,
        code: 'SAVINGS_ACCOUNT_NOT_FOUND',
        message: 'Both accounts must be active accounts belonging to you.',
      });
    }

    const currency = String(senderAccount.currency || '').toUpperCase();
    if (!CURRENCIES.has(currency) || currency !== String(recipientAccount.currency || '').toUpperCase()) {
      return res.status(400).json({
        success: false,
        code: 'SAVINGS_CURRENCY_MISMATCH',
        message: 'Moves between your accounts require the same supported currency. No FX conversion is performed.',
      });
    }
    if (String(senderAccount.account_type).toLowerCase() !== 'savings' &&
        String(recipientAccount.account_type).toLowerCase() !== 'savings') {
      return res.status(400).json({
        success: false,
        code: 'SAVINGS_ACCOUNT_REQUIRED',
        message: 'At least one of the two accounts must be a savings vault.',
      });
    }

    const movement = await executeAtomicTransfer({
      userId: req.user.id,
      senderAccount,
      recipientAccount,
      amount,
      currency,
      description: 'VaultBank savings vault move',
      idempotencyKey,
      senderName: req.user.full_name,
    });

    if (movement.replay) {
      return res.status(200).json({
        success: true,
        replay: true,
        transferId: movement.transferId,
        message: 'This savings move was already processed.',
      });
    }
    if (movement.ambiguous) {
      return res.status(409).json({
        success: false,
        code: movement.code || 'TRANSFER_OUTCOME_UNKNOWN',
        message: movement.message || 'The move outcome is unknown. Retry only with the SAME idempotency key.',
      });
    }
    if (movement.error) {
      const status = movement.code === 'SENDER_ACCOUNT_NOT_FOUND' ||
        movement.code === 'RECIPIENT_NOT_FOUND' ? 404 :
        movement.code === 'TRANSFER_IN_PROGRESS' ||
        movement.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 400;
      return res.status(status).json({
        success: false,
        code: movement.code || 'SAVINGS_MOVE_FAILED',
        message: movement.message || 'Savings move failed. No success is assumed.',
      });
    }

    try {
      await notifyTransferCompletion({
        userId: req.user.id,
        recipientAccount,
        senderAccount,
        amount,
        currency,
        newSenderBalance: movement.newSenderBalance,
        recipientBalance: movement.recipientBalance,
      });
    } catch (_) { /* notification delivery cannot reverse a committed move */ }
    try {
      await createAuditLog({
        userId: req.user.id,
        action: 'savings_account_move',
        resourceType: 'transfer',
        resourceId: movement.transferId,
        details: { fromAccountId, toAccountId, amount, currency },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (auditError) {
      console.warn('Savings move audit failed:', auditError.message);
    }

    return res.status(200).json({
      success: true,
      transferId: movement.transferId,
      amount: Number(amount),
      currency,
      fromAccount: {
        id: senderAccount.id,
        balance: movement.newSenderBalance,
      },
      toAccount: {
        id: recipientAccount.id,
        balance: movement.recipientBalance,
      },
      message: `Moved ${currency} ${amount} between your VaultBank accounts.`,
    });
  } catch (error) {
    console.error('Savings move failed:', error.message);
    return res.status(503).json({
      success: false,
      code: error.code || 'SAVINGS_MOVE_UNAVAILABLE',
      message: 'The savings move could not be confirmed. Check the account history before retrying, and reuse the same idempotency key.',
    });
  }
});

module.exports = router;
