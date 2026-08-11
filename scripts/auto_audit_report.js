/**
 * Auto Audit Report Script
 * This script can be executed via `node scripts/auto_audit_report.js`
 * It loads environment variables, invokes the generateAuditReport utility,
 * and logs the path of the generated CSV file with a celebratory emoji.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { generateAuditReport } = require('../server/utils/audit');

async function run() {
    try {
        const reportPath = await generateAuditReport();
        console.log('🎉 REPORT_GENERATED:', reportPath);
    } catch (err) {
        console.error('Error generating audit report:', err);
        process.exit(1);
    }
}

run();
