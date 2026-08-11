#!/usr/bin/env node

/**
 * Helper script to run the production‑safety validation locally or in CI.
 *
 * It loads environment variables from the repository root `.env` file (using
 * `dotenv`) and then invokes the `validateProductionConfig` function from the
 * `server/payments/safety` module. If any required production payment secrets are
 * missing or still contain placeholder fragments, the script prints the errors
 * and exits with a non‑zero status code (1). Otherwise it prints a success
 * message and exits with 0.
 */

// Load environment variables from the root .env file. The script lives in
// `scripts/`, so we need to go one level up to find the .env file.
require('dotenv').config({ path: '../.env' });

// Import the safety validation module.
const safety = require('../server/payments/safety');

try {
  // Run the validation in silent mode so it returns an object instead of
  // throwing. We will handle the result ourselves.
  const result = safety.validateProductionConfig({ silent: true });

  if (result.ok) {
    console.log('Production‑safety check passed.');
    process.exit(0);
  } else {
    console.error('Production‑safety check failed:');
    // Print each error on its own line for readability.
    result.errors.forEach((e) => console.error(' -', e));
    process.exit(1);
  }
} catch (err) {
  // In case the safety module throws for unexpected reasons, log the error
  // and exit with a failure code.
  console.error('Error during safety check:', err);
  process.exit(1);
}
