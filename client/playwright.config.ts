import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke suite for the real built app.
 *
 * Requires a running backend that also serves client/dist, e.g.
 *   cd server && node index.js
 * Override the target with E2E_BASE_URL. Login uses the demo account that the
 * server seeds in demo mode; it is never used against production data.
 *
 * The auth setup performs at most one API login per run. The login limiter
 * (10 per 15 min per IP) is intentional, so restart a local server between
 * rapid repeat runs rather than weakening it.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'mobile-chrome',
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        storageState: 'e2e/.auth/state.json',
      },
    },
  ],
});
