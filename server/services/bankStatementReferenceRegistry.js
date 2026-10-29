'use strict';

const { db } = require('../config/database');
const ALLOWED_CURRENCIES = new Set(['INR', 'USD']);
const ALLOWED_SOURCES = new Set(['direct_upi_deposit', 'bank_deposit_instruction']);
let schemaPromise = null;
const backfilledSources = new Set();

/**
 * Global one-time-use registry for bank-statement references across native fiat
 * receive rails. Claims happen inside the SAME PostgreSQL transaction as ledger
 * credit. This module never posts a balance or treats a reference as settlement proof.
 */
async function ensureSchema() {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            if (typeof db.ensureConnection === 'function') await db.ensureConnection();
            await db.query(`
                CREATE TABLE IF NOT EXISTS vb_bank_settlement_references (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
                    bank_reference TEXT NOT NULL,
                    normalized_reference TEXT NOT NULL,
                    source_type TEXT NOT NULL CHECK (source_type IN ('direct_upi_deposit', 'bank_deposit_instruction')),
                    source_id UUID NOT NULL,
                    account_id UUID NOT NULL,
                    user_id UUID NOT NULL,
                    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
                    verified_by_admin_id UUID,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);
            await db.query('CREATE UNIQUE INDEX IF NOT EXISTS vb_bank_settlement_reference_uq ON vb_bank_settlement_references (normalized_reference)');
            await db.query('CREATE UNIQUE INDEX IF NOT EXISTS vb_bank_settlement_source_uq ON vb_bank_settlement_references (source_type, source_id)');
            await db.query('CREATE INDEX IF NOT EXISTS vb_bank_settlement_created_idx ON vb_bank_settlement_references (created_at DESC)');
        })().catch((error) => { schemaPromise = null; throw error; });
    }
    await schemaPromise;
}

const LEGACY_SOURCES = {
    bank_deposit_instructions: `
        INSERT INTO vb_bank_settlement_references
            (currency, bank_reference, normalized_reference, source_type, source_id, account_id, user_id, amount, verified_by_admin_id)
        SELECT UPPER(BTRIM(currency)), BTRIM(external_txn_ref), UPPER(BTRIM(external_txn_ref)),
               'bank_deposit_instruction', id, account_id, user_id, amount, verified_by_admin_id
          FROM bank_deposit_instructions
         WHERE status IN ('settled', 'settling')
           AND external_txn_ref IS NOT NULL AND BTRIM(external_txn_ref) <> ''
           AND UPPER(BTRIM(currency)) IN ('INR', 'USD')
        ON CONFLICT DO NOTHING
    `,
    direct_upi_deposit_intents: `
        INSERT INTO vb_bank_settlement_references
            (currency, bank_reference, normalized_reference, source_type, source_id, account_id, user_id, amount, verified_by_admin_id)
        SELECT 'INR', BTRIM(bank_utr), UPPER(BTRIM(bank_utr)), 'direct_upi_deposit',
               id, account_id, user_id, amount, verified_by_admin_id
          FROM direct_upi_deposit_intents
         WHERE status IN ('settled', 'settling') AND bank_utr IS NOT NULL AND BTRIM(bank_utr) <> ''
        ON CONFLICT DO NOTHING
    `,
};

async function backfill(tableName) {
    if (backfilledSources.has(tableName)) return;
    const exists = await db.query('SELECT to_regclass($1) IS NOT NULL AS present', ['public.' + tableName]);
    if (!exists.rows || !exists.rows[0] || exists.rows[0].present !== true) return;
    await db.query(LEGACY_SOURCES[tableName]);
    backfilledSources.add(tableName);
}

async function ensureBankSettlementReferenceRegistry() {
    await ensureSchema();
    // Retry a source later if its table did not exist when the other rail booted.
    await backfill('bank_deposit_instructions');
    await backfill('direct_upi_deposit_intents');
}

async function claimBankStatementReference(client, input) {
    if (!client || typeof client.query !== 'function') throw new TypeError('An open PostgreSQL transaction client is required.');
    const currency = String(input && input.currency || '').trim().toUpperCase();
    const bankReference = String(input && input.bankReference || '').trim();
    const normalizedReference = bankReference.toUpperCase();
    const sourceType = String(input && input.sourceType || '').trim();
    const sourceId = String(input && input.sourceId || '').trim();
    const accountId = String(input && input.accountId || '').trim();
    const userId = String(input && input.userId || '').trim();
    const adminId = String(input && input.adminId || '').trim();
    const amount = String(input && input.amount != null ? input.amount : '').trim();
    if (!ALLOWED_CURRENCIES.has(currency)) throw new Error('Unsupported bank-statement currency.');
    if (!/^[A-Za-z0-9/-]{6,120}$/.test(bankReference)) throw new Error('Invalid bank-statement reference.');
    if (!ALLOWED_SOURCES.has(sourceType)) throw new Error('Unsupported bank-settlement source.');
    if (!sourceId || !accountId || !userId || !adminId) throw new Error('Bank-settlement registry identity is incomplete.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error('Invalid bank-settlement amount.');

    return client.query(
        `INSERT INTO vb_bank_settlement_references
            (currency, bank_reference, normalized_reference, source_type, source_id, account_id, user_id, amount, verified_by_admin_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [currency, bankReference, normalizedReference, sourceType, sourceId, accountId, userId, amount, adminId]
    );
}

module.exports = { ensureBankSettlementReferenceRegistry, claimBankStatementReference };
