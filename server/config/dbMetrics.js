/**
 * Privacy-safe database timing metrics.
 *
 * Only the SQL operation and table name are retained — never parameter values,
 * user identifiers, amounts or full query text. Slow queries are logged so
 * production latency regressions are visible without leaking financial data.
 */
const logger = require('../logger');

const MAX_SAMPLES = 500;
const SLOW_QUERY_MS = 250;

const samples = [];

function extractOperation(sql) {
    const cleaned = String(sql || '').replace(/\s+/g, ' ').trim();
    const match = cleaned.match(/^([A-Za-z]+)/);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
}

function extractTable(sql) {
    const cleaned = String(sql || '');
    const patterns = [
        /\bFROM\s+"?([A-Za-z0-9_]+)"?/i,
        /\bINTO\s+"?([A-Za-z0-9_]+)"?/i,
        /\bUPDATE\s+"?([A-Za-z0-9_]+)"?/i,
        /\bJOIN\s+"?([A-Za-z0-9_]+)"?/i,
    ];
    for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match) return match[1].toLowerCase();
    }
    return '';
}

function recordDbQuery(sql, durationMs, ok) {
    const sample = {
        op: extractOperation(sql),
        table: extractTable(sql),
        ms: Math.max(0, durationMs),
        ok: ok !== false,
        at: Date.now(),
    };
    samples.push(sample);
    if (samples.length > MAX_SAMPLES) samples.shift();

    if (sample.ms >= SLOW_QUERY_MS) {
        logger.warn('db_slow_query %s %s %dms', sample.op, sample.table || 'unknown', Math.round(sample.ms), {
            operation: sample.op,
            table: sample.table || 'unknown',
            durationMs: Math.round(sample.ms),
            ok: sample.ok,
        });
    }
}

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
}

function getDbTimingStats() {
    const buckets = new Map();
    for (const sample of samples) {
        const key = `${sample.op} ${sample.table || 'unknown'}`.trim();
        const entry = buckets.get(key) || { values: [], errors: 0 };
        entry.values.push(sample.ms);
        if (!sample.ok) entry.errors += 1;
        buckets.set(key, entry);
    }
    return Array.from(buckets.entries())
        .map(([key, { values, errors }]) => {
            const sorted = values.slice().sort((a, b) => a - b);
            return {
                key,
                count: sorted.length,
                errors,
                p50: Math.round(percentile(sorted, 50)),
                p95: Math.round(percentile(sorted, 95)),
                p99: Math.round(percentile(sorted, 99)),
            };
        })
        .sort((a, b) => b.p95 - a.p95);
}

function resetDbTimingStats() {
    samples.length = 0;
}

module.exports = {
    recordDbQuery,
    getDbTimingStats,
    resetDbTimingStats,
    SLOW_QUERY_MS,
};
