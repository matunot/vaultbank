// Lightweight pub/sub bus: emitted whenever money moves (send, deposit, bill pay,
// Stripe webhook credit…). Every view that displays REAL backend data subscribes to this
// and refetches instantly — so the whole app stays live with zero page reloads.
type Listener = () => void;

const listeners = new Set<Listener>();
let version = 0;

export const refreshBus = {
  /** Subscribe to money-movement events. Returns an unsubscribe fn. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** Notify every subscriber that money moved (or alerts changed). */
  emit() {
    version++;
    listeners.forEach(fn => {
      try { fn(); } catch { /* subscriber errors must never break the bus */ }
    });
  },
  /** Monotonic version number — handy for dependency arrays. */
  get version() { return version; },
};