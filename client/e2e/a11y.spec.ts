import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BLOCKING = new Set(['serious', 'critical']);

function blockingSummary(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ''))
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

test.describe('signed-out accessibility', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login page has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('#login-account')).toBeVisible();
    // Let the staggered entrance animations finish so axe measures final colors.
    await page.waitForTimeout(1200);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(blockingSummary(results.violations)).toEqual([]);
  });
});

test('dashboard has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText('Live balance')).toBeVisible();
  await page.waitForTimeout(1200);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(blockingSummary(results.violations)).toEqual([]);
});
