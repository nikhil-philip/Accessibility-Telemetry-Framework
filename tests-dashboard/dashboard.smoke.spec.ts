import { test, expect } from '@playwright/test';

/**
 * Smallest-possible browser-level smoke test for the generated L7
 * dashboard (dashboard/index.html, served by scripts/serve-dashboard.ts
 * per playwright.dashboard.config.ts). Deliberately NOT a replacement for
 * scripts/verify-dashboard.ts (which checks every number against the real
 * L4/L5/L6 engines) or the axe-core audit (dashboard.a11y.spec.ts) --
 * this only proves the page actually works when opened in a real browser:
 * it loads, the executive summary and control chart render, at least one
 * SPC signal is visible, a details view expands, the primary interactive
 * element is keyboard-reachable, and nothing throws.
 */
test('dashboard loads, renders the executive summary and control chart, surfaces an SPC signal, expands a details view via keyboard, and throws no JS errors', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // 1-3: the static dashboard serves and loads successfully in a real browser.
  const response = await page.goto('/index.html');
  expect(response?.ok(), 'dashboard/index.html should respond 200').toBe(true);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1')).toHaveText('Accessibility Quality Engineering Dashboard');

  // 4: executive summary (production panel) shows gate, defect score, severity.
  const productionPanel = page.locator('#production-heading').locator('xpath=ancestor::section[1]');
  await expect(productionPanel.locator('.badge').filter({ hasText: /^Gate:/ })).toBeVisible();
  await expect(productionPanel.getByText('Latest defect score')).toBeVisible();
  await expect(productionPanel.getByText('Critical (weight 10)')).toBeVisible();
  await expect(productionPanel.getByText('Serious (weight 5)')).toBeVisible();

  // 5: the I-MR control chart SVG is actually rendered with data points, not just an empty <svg>.
  const chartSvg = productionPanel.locator('svg.chart').first();
  await expect(chartSvg).toBeVisible();
  expect(await chartSvg.locator('circle.point').count()).toBeGreaterThan(0);

  // 6: at least one SPC signal is visible (Experiment A's observations list,
  // read directly from already-computed regressionSpike/rule fields -- see dashboard.js).
  const observation = page.locator('.observations li').first();
  await expect(observation).toBeVisible();
  await expect(observation).toContainText(/regression spike|rule 1/i);

  // 7 & 8: the first chart's "View as table" details toggle is reachable via
  // keyboard alone (Tab) and expands the table view on activation (Enter).
  const table = productionPanel.locator('.table-scroll').first();
  await expect(table).toBeHidden();

  let reachedToggle = false;
  for (let i = 0; i < 40 && !reachedToggle; i++) {
    await page.keyboard.press('Tab');
    reachedToggle = await page.evaluate(() => {
      const el = document.activeElement;
      return !!el && el.tagName === 'BUTTON' && el.textContent?.trim() === 'View as table';
    });
  }
  expect(reachedToggle, 'the first "View as table" toggle should be reachable via Tab within 40 presses').toBe(true);

  await page.keyboard.press('Enter');
  await expect(table).toBeVisible();
  await expect(table.locator('table.data-table')).toBeVisible();

  // 9: no page-level JS errors anywhere in the flow above.
  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
