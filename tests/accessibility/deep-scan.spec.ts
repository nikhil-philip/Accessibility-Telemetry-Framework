import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../src/fixtures';
import {
  scanPage,
  scanDynamicState,
  scanMultiplePages,
  toTelemetryAttachment,
  AccessibilityViolation,
} from '../../src/utils/accessibilityScanner';
import { SITES } from '../../src/config/sites.config';

/**
 * Sample implementation for accessibilityScanner.ts, exercising every
 * requirement of the axe-core integration:
 *  1. Authenticated pages  -- "scans an authenticated page ..."
 *  2. Dynamic content      -- "scans dynamic content: ..." (x2)
 *  3. Multiple pages       -- "scans every configured route automatically"
 *  4. Capture all violations -- assertWellFormedViolation runs on every
 *     violation this file scans, proving nothing is silently dropped.
 *  5. Extraction            -- assertWellFormedViolation checks ruleId,
 *     impact, description, helpUrl, and affectedElements are all present
 *     for every violation.
 *
 * Note on telemetry: this file demonstrates `toTelemetryAttachment()` but
 * deliberately does NOT call `testInfo.attach('axe-results', ...)` with
 * it. That attachment name is what src/telemetry/reporter.ts's onTestEnd
 * watches for -- tests/accessibility/all-pages.a11y.spec.ts is the one
 * spec that feeds telemetry/history/, one page-load scan per route. If
 * this file's authenticated/dynamic/re-scanned results also fed the same
 * pipeline, several pages would be counted more than once per run and
 * silently inflate every build's defectScore. This file's own detailed
 * output goes to reports/detailed-accessibility-scan.json instead.
 */

function assertWellFormedViolation(violation: AccessibilityViolation): void {
  expect(violation.ruleId, 'ruleId must be present').toBeTruthy();
  expect(['critical', 'serious', 'moderate', 'minor', null]).toContain(violation.impact);
  expect(violation.description, `${violation.ruleId}: description must be present`).toBeTruthy();
  expect(violation.help, `${violation.ruleId}: help must be present`).toBeTruthy();
  expect(violation.helpUrl, `${violation.ruleId}: helpUrl must be a URL`).toMatch(/^https?:\/\//);
  expect(violation.affectedElements.length, `${violation.ruleId}: must have at least one affected element`).toBeGreaterThan(0);

  for (const element of violation.affectedElements) {
    expect(element.target.length, `${violation.ruleId}: element target selector must be present`).toBeGreaterThan(0);
    expect(element.html, `${violation.ruleId}: element html snippet must be present`).toBeTruthy();
  }
}

test.describe('Deep accessibility scanning (@axe-core/playwright)', () => {
  // ---------------------------------------------------------------------
  // Requirement 1: authenticated pages
  // ---------------------------------------------------------------------
  test('scans an authenticated page and extracts full violation detail', async ({ scan, page }) => {
    // profile.html is `requiresAuth: true` in sites.config.ts. Playwright's
    // `chromium` project (playwright.config.ts) applies storageState from
    // tests/auth.setup.ts to every test by default -- this scan runs
    // against the same authenticated session, no extra wiring required.
    await page.goto('profile.html');
    await page.waitForLoadState('domcontentloaded');

    const result = await scan({ pageName: 'User Profile (authenticated)' });

    for (const violation of result.violations) {
      assertWellFormedViolation(violation);
    }

    // Extraction, made concrete: print exactly what requirement 5 asks for
    // extracted, for the first violation found (if any).
    if (result.violations[0]) {
      const v = result.violations[0];
      console.log('Sample extracted violation:', {
        ruleId: v.ruleId,
        impact: v.impact,
        description: v.description,
        helpUrl: v.helpUrl,
        affectedElements: v.affectedElements,
      });
    }
  });

  // ---------------------------------------------------------------------
  // Requirement 2: dynamic content (interaction-driven state changes)
  // ---------------------------------------------------------------------
  test('scans dynamic content: FAQ accordion before and after expanding', async ({ page, contactPage }) => {
    await contactPage.open();

    const collapsed = await scanPage(page, { pageName: 'Contact Us', scanContext: 'FAQ collapsed (default)' });

    const expanded = await scanDynamicState(page, 'Contact Us', 'FAQ expanded', async () => {
      await contactPage.expandFaq('How long does delivery take?');
    });

    for (const violation of [...collapsed.violations, ...expanded.violations]) {
      assertWellFormedViolation(violation);
    }

    // Proves this re-scanned the live DOM after the interaction rather
    // than reusing a cached initial-load result.
    expect(expanded.scannedAt).not.toBe(collapsed.scannedAt);
  });

  test('scans dynamic content: Quick View modal while open', async ({ page, productDetailsPage }) => {
    await productDetailsPage.openProduct('SKU-1001');

    const result = await scanDynamicState(
      page,
      'Product Details',
      'Quick View modal open',
      async () => {
        await productDetailsPage.quickViewButton.click();
        await expect(productDetailsPage.quickViewModal).toHaveClass(/open/);
      },
      { include: ['#quickViewModal'] }, // scope the scan to just the open dialog
    );

    for (const violation of result.violations) {
      assertWellFormedViolation(violation);
    }
  });

  // ---------------------------------------------------------------------
  // Requirement 3: multiple pages, automatically
  // ---------------------------------------------------------------------
  test('scans every configured route automatically and writes a combined report', async ({ page }, testInfo) => {
    // A single test/browser context scanning every route in one pass --
    // a batch-efficient complement to all-pages.a11y.spec.ts's one-test-
    // per-route approach, which trades this test's speed for per-page
    // failure isolation. Both are valid; use whichever fits the CI budget.
    const results = await scanMultiplePages(page, SITES);

    expect(results).toHaveLength(SITES.length);

    for (const pageResult of results) {
      for (const violation of pageResult.violations) {
        assertWellFormedViolation(violation);
      }

      // Exercises the telemetry bridge without attaching it under the
      // reserved 'axe-results' name (see the file-level note above).
      const bridged = toTelemetryAttachment(pageResult);
      expect(bridged.page).toBe(pageResult.pageName);
      expect(bridged.violations).toHaveLength(pageResult.violations.length);
    }

    const reportPath = path.resolve(__dirname, '../../reports/detailed-accessibility-scan.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    await testInfo.attach('detailed-accessibility-scan', { path: reportPath, contentType: 'application/json' });
  });
});
