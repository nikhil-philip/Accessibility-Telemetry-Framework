import { test, expect } from '@playwright/test';
import { createAxeBuilder } from '../src/utils/accessibilityScanner';

/**
 * axe-core audit of the L7 dashboard itself, reusing the project's single
 * axe configuration (createAxeBuilder -> axe.config.ts's AXE_TAGS) rather
 * than re-declaring a tag list here. Complements, and is intentionally
 * separate from, dashboard.smoke.spec.ts -- this is the accessibility
 * check; the smoke test is functional/behavioral only.
 */
for (const colorScheme of ['light', 'dark'] as const) {
  test(`dashboard has zero axe-core violations (${colorScheme} mode)`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    await page.goto('/index.html');
    await page.waitForLoadState('networkidle');

    const results = await createAxeBuilder(page).analyze();

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

    await context.close();
  });
}
