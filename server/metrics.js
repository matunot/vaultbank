/**
 * Prometheus metrics setup for VaultBank.
 * This module defines and exports metric objects that can be used throughout the server.
 */
const client = require('prom-client');

// Collect default metrics (process, OS, etc.)
client.collectDefaultMetrics();

// Counter for total number of transfer operations
const totalTransfers = new client.Counter({
    name: 'vaultbank_total_transfers',
    help: 'Total number of transfer operations',
});

// Counter for total volume transferred (sum of amounts). No labels needed for now.
const totalTransferVolume = new client.Counter({
    name: 'vaultbank_total_transfer_volume',
    help: 'Total volume transferred across all transfers',
});

// Counter for number of anomalous transfers detected
const anomalyTransfers = new client.Counter({
    name: 'vaultbank_anomaly_transfers',
    help: 'Number of transfers flagged as anomalies',
});

// Gauge for number of active users (demo store length)
const activeUsers = new client.Gauge({
    name: 'vaultbank_active_users',
    help: 'Number of active users in the system',
});

// Gauge for total balance across all users
const totalBalance = new client.Gauge({
    name: 'vaultbank_total_balance',
    help: 'Total balance across all users',
});

/**
 * Helper to update active users gauge based on current demo store.
 * @param {number} count - Number of active users.
 */
function setActiveUsers(count) {
    activeUsers.set(count);
}

/**
 * Helper to update total balance gauge.
 * @param {number} amount - Total balance amount.
 */
function setTotalBalance(amount) {
    totalBalance.set(amount);
}

module.exports = {
    client,
    totalTransfers,
    totalTransferVolume,
    activeUsers,
    totalBalance,
    setActiveUsers,
    setTotalBalance,
    anomalyTransfers,
};
