/**
 * VBR's only active connector is VaultBank's native internal account-transfer
 * descriptor. External collections and payout integrations are retired.
 *
 * This validator remains for internal connector contract tests; no merchant
 * payment gateway or provider adapter is mounted by VBR.
 */

const REQUIRED_RECEIVE_FUNCTIONS = ['provisionDetails'];
const REQUIRED_SEND_FUNCTIONS = ['requestTransfer', 'getTransferStatus'];
const REQUIRED_BASE_FUNCTIONS = ['configured', 'availability'];

/** Validates that a module satisfies the connector contract. Never throws — returns a list of issues. */
function validateConnector(conn, direction) {
    const issues = [];
    for (const fn of REQUIRED_BASE_FUNCTIONS) {
        if (typeof conn[fn] !== 'function') issues.push(`missing base function: ${fn}`);
    }
    if (typeof conn.id !== 'string' || !conn.id) issues.push('missing or empty id');
    if (!['send', 'receive', 'both', 'base-only'].includes(conn.direction)) issues.push(`invalid direction: ${conn.direction}`);
    if (!Array.isArray(conn.currencies)) issues.push('currencies must be an array');
    if (direction === 'receive' || direction === 'both') {
        for (const fn of REQUIRED_RECEIVE_FUNCTIONS) {
            if (typeof conn[fn] !== 'function') issues.push(`missing receive function: ${fn}`);
        }
    }
    if (direction === 'send' || direction === 'both') {
        for (const fn of REQUIRED_SEND_FUNCTIONS) {
            if (typeof conn[fn] !== 'function') issues.push(`missing send function: ${fn}`);
        }
    }
    return issues;
}

module.exports = { validateConnector };
