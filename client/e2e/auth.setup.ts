import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STATE = path.join('e2e', '.auth', 'state.json');

/**
 * Authenticate once through the real API and persist the browser session.
 * Individual tests then start already signed in, which keeps the strict
 * 10-per-15-minute login limiter out of the way.
 */
setup('authenticate demo account', async ({ page, request, baseURL }) => {
  // Reuse a recent session so repeat local runs do not exhaust the intentional
  // 10-per-15-minute login limiter. Delete e2e/.auth/state.json to force a
  // fresh login.
  try {
    const ageMs = Date.now() - fs.statSync(STATE).mtimeMs;
    if (ageMs < 30 * 60 * 1000) return;
  } catch {
    /* no cached session yet */
  }

  const response = await request.post('/login', {
    data: { email: 'demo@vaultbank.com', password: 'password' },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.token).toBeTruthy();

  await page.goto(baseURL || '/');
  await page.evaluate(
    ({ token, user, account }) => {
      localStorage.setItem('vaultbank_token', token);
      if (user) localStorage.setItem('vaultbank_user', JSON.stringify(user));
      if (account) localStorage.setItem('vaultbank_account', JSON.stringify(account));
    },
    { token: body.token, user: body.user, account: body.account },
  );

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  await page.context().storageState({ path: STATE });
});
