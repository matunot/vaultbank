#!/usr/bin/env node
// CLI: run a reconciliation for one provider over a date range.
//
// Usage:
//   node server/scripts/run-reconciliation.js --provider stripe --start 2026-06-01 --end 2026-06-02 [--dry-run]
//
// Exit codes: 0=ok, 2=mismatches/missing, 3=provider error

const path = require('path');
const root = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(root, '.env') });
const recon = require('../payments/reconciliation');
const metrics = require('../metrics/payments');

function parseArgs(argv) {
    const out = { dryRun: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--provider') out.provider = argv[++i];
        else if (a === '--start') out.start = argv[++i];
        else if (a === '--end') out.end = argv[++i];
        else if (a === '--dry-run') out.dryRun = true;
        else if (a === '--help' || a === '-h') out.help = true;
    }
    return out;
}

function usage() {
    console.log('Usage: node server/scripts/run-reconciliation.js --provider <name> --start <ISO> --end <ISO> [--dry-run]');
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help || !args.provider || !args.start || !args.end) { usage(); process.exit(args.help ? 0 : 64); }
    const startAt = new Date(args.start);
    const endAt = new Date(args.end);
    if (isNaN(startAt) || isNaN(endAt) || endAt <= startAt) {
        console.error('Invalid dates: --end must be after --start'); process.exit(64);
    }
    console.log('Starting', JSON.stringify({ provider: args.provider, startAt: startAt.toISOString(), endAt: endAt.toISOString(), dryRun: args.dryRun }));
    let result;
    try {
        result = await recon.runReconciliation({ provider: args.provider, startAt, endAt, dryRun: args.dryRun });
    } catch (err) { console.error('Run failed:', err.message); process.exit(3); }
    if (result.error) { console.error('Provider error:', result.error); process.exit(3); }
    metrics.recordReconciliationMismatches(args.provider, 'mismatch', result.counts.mismatch);
    metrics.recordReconciliationMismatches(args.provider, 'missing', result.counts.missing);
    metrics.recordReconciliationMismatches(args.provider, 'matched', result.counts.matched);
    console.log('Finished', JSON.stringify({ runId: result.runId, provider: result.provider, total: result.total, counts: result.counts, dryRun: result.dryRun }));
    const interesting = result.rows.filter(r => r.status === 'mismatch' || r.status === 'missing').slice(0, 20);
    if (interesting.length) {
        console.log('Top non-matched:');
        for (const r of interesting) console.log('  ' + r.status.padEnd(8) + ' id=' + r.provider_id + ' amt=' + r.amount + ' ledger=' + (r.ledgerAmount || '-'));
    }
    process.exit(result.counts.mismatch > 0 || result.counts.missing > 0 ? 2 : 0);
}
main().catch(err => { console.error('Unexpected:', err); process.exit(1); });