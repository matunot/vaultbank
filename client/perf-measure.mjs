// Mobile performance measurement on a throttled connection + slow CPU.
// Requires the built app served by the backend (default http://127.0.0.1:5000).
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:5000';
const OUT = process.env.AUDIT_OUT || '../reports/audit/after';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
// Slow 4G-ish: 1.6 Mbps down, 750 kbps up, 150 ms RTT.
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 150,
  downloadThroughput: 1.6 * 1024 * 1024 / 8,
  uploadThroughput: 750 * 1024 / 8,
});
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const apiRequests = [];
page.on('response', async (response) => {
  const url = new URL(response.url());
  if (url.pathname === '/login' || url.pathname.startsWith('/api/')) {
    apiRequests.push({ path: url.pathname, status: response.status() });
  }
});

await page.addInitScript(() => {
  window.__vbPerf = { lcp: null, cls: 0, longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      window.__vbPerf.lcp = entries[entries.length - 1];
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__vbPerf.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__vbPerf.longTasks += 1;
        window.__vbPerf.longTaskMs += entry.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* older engines */
  }
});

const collect = () =>
  page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const byType = { script: 0, css: 0, fetch: 0, other: 0 };
    for (const entry of resources) {
      const type = entry.initiatorType;
      const key = type === 'script' || type === 'link' ? (entry.name.endsWith('.css') ? 'css' : 'script') : type === 'fetch' || type === 'xmlhttprequest' ? 'fetch' : 'other';
      byType[key] += entry.transferSize || 0;
    }
    const lcp = window.__vbPerf?.lcp;
    return {
      ttfb: Math.round(nav.responseStart),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      lcpMs: lcp ? Math.round(lcp.startTime) : null,
      lcpElement: lcp?.element ? lcp.element.tagName + (lcp.element.id ? `#${lcp.element.id}` : '') : null,
      cls: Number((window.__vbPerf?.cls || 0).toFixed(4)),
      longTasks: window.__vbPerf?.longTasks || 0,
      longTaskMs: Math.round(window.__vbPerf?.longTaskMs || 0),
      transferKB: Object.fromEntries(
        Object.entries(byType).map(([key, bytes]) => [key, Number((bytes / 1024).toFixed(2))]),
      ),
      resourceCount: resources.length,
    };
  });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const login = await collect();
await page.screenshot({ path: `${OUT}/throttled-login.png` });

await page.locator('#login-account').fill('demo@vaultbank.com');
await page.locator('#login-password').fill('password');
const loginStart = Date.now();
await page.getByRole('button', { name: 'Access Private Account' }).click();
await page.locator('h1').filter({ hasText: /Demo/ }).waitFor();
const signInToDashboardMs = Date.now() - loginStart;
await page.getByRole('heading', { name: 'Recent Activity' }).waitFor();
await page.waitForTimeout(2500);
const dashboard = await collect();
await page.screenshot({ path: `${OUT}/throttled-dashboard.png`, fullPage: false });

const result = {
  base: BASE,
  profile: 'mobile 390x844, 1.6Mbps/750kbps, 150ms RTT, 4x CPU throttle',
  login,
  signInToDashboardMs,
  dashboard,
  apiRequests,
};
await browser.close();
fs.writeFileSync(`${OUT}/perf.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
