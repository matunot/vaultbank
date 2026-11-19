import { test, expect, type Page } from '@playwright/test';

const DEMO_ACCOUNT = 'demo@vaultbank.com';
const DEMO_PASSWORD = 'password';

/** Start from the shared authenticated session (no extra login round trip). */
async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toContainText(/Demo/);
  await expect(page.getByText('Live balance')).toBeVisible();
}

test.describe('signed-out entry', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login page is usable and labelled', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    await expect(page.locator('#login-account')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Access Private Account' })).toBeEnabled();

    const widths = await page.evaluate(() => ({
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner + 1);
  });

  test('sign in loads real account + ledger exactly once', async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/') || url.pathname === '/login') {
        apiCalls.push(`${request.method()} ${url.pathname}`);
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('#login-account').fill(DEMO_ACCOUNT);
    await page.locator('#login-password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Access Private Account' }).click();

    await expect(page.locator('h1')).toContainText(/Demo/);
    await expect(page.getByText('Live balance')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Activity' })).toBeVisible();

    // Dashboard bootstrap: one account read + one ledger read (the old hook
    // fired three overlapping requests including a separate balance call).
    expect(apiCalls.filter((call) => call === 'GET /api/account')).toHaveLength(1);
    expect(apiCalls.filter((call) => call.startsWith('GET /api/account/transactions'))).toHaveLength(1);
    expect(apiCalls).not.toContain('GET /api/account/balance');
  });
});

test.describe('signed-in dashboard', () => {
  test('desktop sidebar does not consume the phone viewport', async ({ page }) => {
    await openDashboard(page);

    const asideWidth = await page.locator('aside').evaluate((el) => el.getBoundingClientRect().width);
    expect(asideWidth).toBe(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Ledger rows render inside the balance card instead of clipping it.
    const cardOverflow = await page.locator('.hero-tilt').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(cardOverflow).toBeLessThanOrEqual(1);
  });

  test('bottom navigation switches sections and the More sheet closes with Escape', async ({ page }) => {
    await openDashboard(page);

    const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(nav).toBeVisible();
    const navBox = await nav.boundingBox();
    expect(navBox?.y ?? 0).toBeGreaterThan(600);

    await nav.getByRole('button', { name: 'Payments' }).click();
    await expect(page.getByRole('main')).toContainText(/Payments/i);

    await nav.getByRole('button', { name: 'Home' }).click();
    await expect(page.locator('h1')).toContainText(/Demo/);

    await page.getByRole('button', { name: 'More destinations' }).click();
    const sheet = page.getByRole('dialog', { name: 'All destinations' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('notifications drawer opens and closes without leaving the dashboard', async ({ page }) => {
    await openDashboard(page);

    await page.getByRole('button', { name: /Notifications/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Notifications' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(/unread/i);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.locator('h1')).toContainText(/Demo/);
  });

  test('dashboard has no console errors or failed asset requests', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failed: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      if (!request.url().includes('/api/')) failed.push(request.url());
    });

    await openDashboard(page);
    await expect(page.getByRole('heading', { name: 'Recent Activity' })).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(failed).toEqual([]);
  });
});
