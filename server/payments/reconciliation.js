/**
 * Reconciliation engine (Sprint 2)
 * --------------------------------
 * For a given provider + date range, fetch the provider's transaction
 * list, compare it against our `payments` table, and write one row per
 * provider transaction into `reconciliations` with status matched /
 * mismatch / missing / unknown.
 *
 * Design notes
 *   * Pure functions for `compare()` and the per-row classification
 *     (`classify()`). The side-effecting `runReconciliation()` is the
 *     thin shell that calls them and persists results.
 *   * The provider fetchers live in `server/payments/reconAdapters/`
 *     and are loaded lazily; this keeps the cold-start cost low and
 *     lets us mock each adapter in tests.
 *   * In demo / no-DB mode the engine still works: the run is logged,
 *     counted, and returned, but nothing is written. This is what
 *     `--dry-run` does in any environment.
 *   * If the provider API call fails, the run is marked `error` in
 *     `reconciliation_runs` so ops can spot it.
 */

const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');

const STATUSES = {
    MATCHED: 'matched',
    MISMATCH: 'mismatch',
    MISSING: 'missing',
    UNKNOWN: 'unknown',
};

/**
 * Pure function: classify one provider transaction against a lookup
 * of known ledger payments.
 *
 * @param {Object} tx  provider transaction { id, amount, currency }
 * @param {Map<string, Object>} ledgerByProviderId  provider_id -> payment row
 * @returns {{ status: string, payment: Object|null, ledgerAmount: number|null, reason: string }}
 */
function classify(tx, ledgerByProviderId) {
    const ledgerRow = ledgerByProviderId.get(String(tx.id));
    if (!ledgerRow) {
        return {
            status: STATUSES.MISSING,
            payment: null,
            ledgerAmount: null,
            reason: 'No matching ledger row for this provider transaction',
        };
    }
    const txAmount = Number(tx.amount);
    const ledgerAmount = Number(ledgerRow.amount);
    if (txAmount !== ledgerAmount) {
        return {
            status: STATUSES.MISMATCH,
            payment: ledgerRow,
            ledgerAmount,
            reason: 'Amount differs: provider=' + txAmount + ' ledger=' + ledgerAmount,
        };
    }
    return {
        status: STATUSES.MATCHED,
        payment: ledgerRow,
        ledgerAmount,
        reason: '',
    };
}

/**
 * Pure function: take a list of provider txs + a list of ledger rows
 * and produce the full reconciliation result set.
 */
function compare(providerTxs, ledgerRows) {
    const byId = new Map();
    for (const r of ledgerRows) byId.set(String(r.provider_id), r);
    return providerTxs.map((tx) => ({
        provider_id: String(tx.id),
        ...classify(tx, byId),
        amount: Number(tx.amount),
        currency: tx.currency || null,
        raw: tx,
    }));
}

/**
 * Fetch ledger rows for the given (provider, provider_ids).
 * Returns [] in demo mode (no DB).
 */
async function findLedgerPayments(provider, providerIds) {
    if (!providerIds.length) return [];
    try {
        const { rows } = await query(
            'SELECT id, provider, provider_id, amount, currency, status FROM payments WHERE provider = $1 AND provider_id = ANY($2::text[])',
            [provider, providerIds]
        );
        return rows || [];
    } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[reconciliation] findLedgerPayments skipped:', err.message);
        } else {
            console.error('[reconciliation] findLedgerPayments failed:', err.message);
        }
        return [];
    }
}

/**
 * Persist one run's results. No-op in demo mode or when dryRun=true.
 * Returns the run_id (or null if not persisted).
 */
async function persistRun(run, rows, dryRun) {
    if (dryRun) return null;
    const counts = countByStatus(rows);
    try {
        const { rows: created } = await query(
            'INSERT INTO reconciliation_runs (id, provider, start_at, end_at, matched_count, mismatch_count, missing_count, unknown_count, dry_run, finished_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now()) RETURNING id',
            [
                run.id,
                run.provider,
                run.startAt,
                run.endAt,
                counts.matched,
                counts.mismatch,
                counts.missing,
                counts.unknown,
                false,
            ]
        );
        const runId = created[0] ? created[0].id : run.id;
        for (const r of rows) {
            await query(
                'INSERT INTO reconciliations (provider, provider_id, payment_id, status, amount, ledger_amount, currency, raw, run_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (provider, provider_id, run_id) DO NOTHING',
                [
                    run.provider,
                    r.provider_id,
                    r.payment ? r.payment.id : null,
                    r.status,
                    r.amount,
                    r.ledgerAmount,
                    r.currency,
                    JSON.stringify(r.raw || {}),
                    runId,
                ]
            );
        }
        return runId;
    } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[reconciliation] persistRun skipped:', err.message);
        } else {
            console.error('[reconciliation] persistRun failed:', err.message);
        }
        return null;
    }
}

function countByStatus(rows) {
    const c = { matched: 0, mismatch: 0, missing: 0, unknown: 0 };
    for (const r of rows) {
        if (c[r.status] !== undefined) c[r.status] += 1;
    }
    return c;
}

/**
 * Run reconciliation for one provider. Returns the run summary.
 *
 * @param {Object} options
 * @param {string} options.provider            'stripe' | 'razorpay' | 'paypal'
 * @param {Date|string} options.startAt        inclusive lower bound
 * @param {Date|string} options.endAt          exclusive upper bound
 * @param {boolean} [options.dryRun]           do not persist; default false
 * @returns {Promise<Object>}  { runId, provider, total, counts, rows }
 */
async function runReconciliation({ provider, startAt, endAt, dryRun = false }) {
    if (!provider) throw new Error('provider is required');
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (isNaN(start) || isNaN(end)) {
        throw new Error('startAt and endAt must be valid dates');
    }
    if (end <= start) {
        throw new Error('endAt must be after startAt');
    }

    const run = {
        id: uuidv4(),
        provider,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
    };

    // Lazy-load the provider adapter
    const adapterPath = './reconAdapters/' + provider;
    let fetcher;
    try {
        fetcher = require(adapterPath);
    } catch (err) {
        throw new Error('Unknown provider or adapter not implemented: ' + provider);
    }

    let providerTxs = [];
    let providerError = null;
    try {
        providerTxs = await fetcher.fetchTransactions({ startAt: start, endAt: end });
    } catch (err) {
        providerError = err && err.message ? err.message : String(err);
    }

    if (providerError) {
        // Record the failed run so ops can see it
        try {
            await query(
                'INSERT INTO reconciliation_runs (id, provider, start_at, end_at, dry_run, finished_at, error) VALUES ($1, $2, $3, $4, $5, now(), $6)',
                [run.id, provider, run.startAt, run.endAt, dryRun, providerError]
            );
        } catch (_) {
            /* demo mode */
        }
        return {
            runId: run.id,
            provider,
            error: providerError,
            total: 0,
            counts: { matched: 0, mismatch: 0, missing: 0, unknown: 0 },
            rows: [],
            dryRun,
        };
    }

    const providerIds = providerTxs.map((t) => String(t.id));
    const ledgerRows = await findLedgerPayments(provider, providerIds);
    const results = compare(providerTxs, ledgerRows);
    const runId = await persistRun(run, results, dryRun);

    return {
        runId: runId || run.id,
        provider,
        startAt: run.startAt,
        endAt: run.endAt,
        total: results.length,
        counts: countByStatus(results),
        rows: results,
        dryRun,
    };
}

module.exports = {
    runReconciliation,
    compare,
    classify,
    countByStatus,
    findLedgerPayments,
    STATUSES,
};
