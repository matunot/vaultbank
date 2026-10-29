/**
 * VBR Payment State Machine — the single authority on legal state transitions.
 *
 * States:
 *   created                → intent accepted, not yet routed to a connector
 *   pending                → routed to a connector, awaiting confirmation
 *   processing             → connector accepted, waiting for settlement
 *   succeeded              → terminal — money moved and ledger posted
 *   failed                 → terminal — money NOT moved, no ledger entries
 *   cancelled              → terminal — user cancelled before settlement
 *   reconciliation_required → ambiguous — funds may have moved; operator review
 *
 * Legal transitions (centralized — no route or connector can skip validation):
 *   created      → pending, cancelled, failed, succeeded, reconciliation_required
 *     (created → succeeded: the synchronous internal rail settles inside
 *      the create request — money and intent state commit atomically)
 *     (created → reconciliation_required: the COMMIT acknowledgement was
 *      lost AND the persisted intent could not be read — outcome unknown)
 *   pending      → processing, cancelled, failed, reconciliation_required
 *   processing   → succeeded, failed, reconciliation_required
 *   succeeded    → (terminal)
 *   failed       → (terminal)
 *   cancelled    → (terminal)
 *   reconciliation_required → succeeded, failed
 */

const STATES = Object.freeze({
    CREATED: 'created',
    PENDING: 'pending',
    PROCESSING: 'processing',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    RECONCILIATION_REQUIRED: 'reconciliation_required',
});

const LEGAL_TRANSITIONS = Object.freeze({
    // succeeded is reachable from created: the internal rail is synchronous.
    // reconciliation_required is reachable from created when a commit
    // acknowledgement is lost and the persisted intent is unreadable.
    [STATES.CREATED]: [STATES.PENDING, STATES.CANCELLED, STATES.FAILED, STATES.SUCCEEDED, STATES.RECONCILIATION_REQUIRED],
    [STATES.PENDING]: [STATES.PROCESSING, STATES.CANCELLED, STATES.FAILED, STATES.RECONCILIATION_REQUIRED],
    [STATES.PROCESSING]: [STATES.SUCCEEDED, STATES.FAILED, STATES.RECONCILIATION_REQUIRED],
    [STATES.SUCCEEDED]: [],
    [STATES.FAILED]: [],
    [STATES.CANCELLED]: [],
    [STATES.RECONCILIATION_REQUIRED]: [STATES.SUCCEEDED, STATES.FAILED],
});

const TERMINAL_STATES = Object.freeze([STATES.SUCCEEDED, STATES.FAILED, STATES.CANCELLED]);

const { enabledCurrencies, isCurrencyEnabled } = require('../config/currencies');

/**
 * Currencies the VBR orchestration layer may touch right now. This is a live
 * view of the registry (USD + INR always, additional currencies only when an
 * operator enables multi-currency), never a hardcoded pair.
 */
function supportedCurrencies() {
    return enabledCurrencies();
}

/** Returns true if `from → to` is a legal transition. */
function canTransition(from, to) {
    const legal = LEGAL_TRANSITIONS[from] || [];
    return legal.includes(to);
}

/** Returns true if the state is terminal (no further transitions). */
function isTerminal(state) {
    return TERMINAL_STATES.includes(state);
}

/** Throws if the transition is illegal — the single validation gate. */
function assertTransition(from, to) {
    if (!canTransition(from, to)) {
        throw new Error(`Illegal state transition: ${from} -> ${to}`);
    }
}

/** Validates a currency is explicitly supported and currently enabled. */
function isCurrencySupported(currency) {
    return isCurrencyEnabled(currency);
}

module.exports = { STATES, LEGAL_TRANSITIONS, TERMINAL_STATES, supportedCurrencies, canTransition, isTerminal, assertTransition, isCurrencySupported };
