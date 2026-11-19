// Ad-hoc mobile layout/render audit. Not part of the app bundle.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:4173';
const OUT = process.env.AUDIT_OUT || '../reports/audit';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

for (const width of [360, 375, 390, 412]) {
  const context = await browser.newContext({
    viewport: { width, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginLayout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    title: document.title,
  }));
  await page.screenshot({ path: `${OUT}/login-${width}.png`, fullPage: false });

  await page.fill('#login-account', 'demo@vaultbank.com');
  await page.fill('#login-password', 'password');
  await page.click('button:has-text("Access")').catch(async () => {
    await page.locator('form button[type="submit"], button').filter({ hasText: /access|sign in|login/i }).first().click();
  });
  await page.waitForTimeout(4000);

  const dashLayout = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');
    const rect = (el) => (el ? { x: Math.round(el.getBoundingClientRect().x), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      aside: rect(aside),
      main: rect(main),
      h1: document.querySelector('h1')?.textContent?.trim(),
      navVisible: !!aside,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      storage: { token: !!localStorage.getItem('vaultbank_token') },
    };
  });
  await page.screenshot({ path: `${OUT}/dashboard-${width}.png`, fullPage: false });

  results.push({ width, loginLayout, dashLayout, consoleErrors, failedRequests: failedRequests.slice(0, 8) });
  await context.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/layout.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
