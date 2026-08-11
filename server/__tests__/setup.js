// Shared Jest setup. Forces NODE_ENV to 'test' so the safety and
// flag modules take their non-production branches in unit tests.
process.env.NODE_ENV = 'test';
// Clear any leftover SENTRY_DSN so the no-op branch in metrics
// capture is exercised.
delete process.env.SENTRY_DSN;
