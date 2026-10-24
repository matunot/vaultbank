/**
 * VBR Internal Connector — the native VaultBank-to-VaultBank rail.
 *
 * A pure descriptor. The internal rail needs no external provider or
 * credentials, and it deliberately owns NO money movement: the VBR core
 * executes internal intents through the shared atomic pipeline
 * (services/transferService.js — the same implementation as
 * POST /api/account/transfer) and applies intent state transitions itself.
 *
 * Per the connector contract safety rules, a connector never posts to the
 * ledger and never changes an intent's state directly — so this module
 * intentionally has no execute/request functions. Any code that moves money
 * lives in exactly one place: the shared transfer service.
 */

const connector = {
    id: 'internal',
    direction: 'base-only', // native rail — not an external connector
    currencies: ['USD', 'INR'],
    configured: () => true, // always available
    availability: () => ({ available: true, reason: 'always available (VaultBank-to-VaultBank)', provider: 'vaultbank' }),
};

module.exports = connector;
