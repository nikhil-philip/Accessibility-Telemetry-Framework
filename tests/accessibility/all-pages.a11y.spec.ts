import { test, expect } from '../../src/fixtures';
import { SITES } from '../../src/config/sites.config';
import { createLogger } from '../../src/utils/logger';

const logger = createLogger('A11yScan');

/**
 * Data-driven over the Route Registry (src/config/sites.config.ts) instead
 * of one file per page -- adding a 9th ShopSmart page to the registry adds
 * a 9th test automatically, with zero duplication here.
 *
 * Scope, deliberately: this suite records what axe-core finds. It does not
 * assert `violations` is empty. ShopSmart's builds 1-4 contain seeded
 * violations on purpose (docs/violations/catalog.json) -- an empty-array
 * assertion would fail by design on 4 of 5 builds. Deciding pass/fail from
 * accumulated telemetry is ARCHITECTURE.md's Layer 6 (Quality Gate), which
 * is separate, not-yet-built work that reads the history this suite
 * writes. This suite's only pass/fail condition is "did the scan run."
 */
for (const site of SITES) {
  test(`${site.name} completes an accessibility scan`, async ({ page, makeAxeBuilder }, testInfo) => {
    await page.goto(site.path);
    await page.waitForLoadState('domcontentloaded');

    const results = await makeAxeBuilder().analyze();

    expect(results, `axe-core should return a result set for ${site.name}`).toBeTruthy();
    expect(Array.isArray(results.violations)).toBe(true);

    const totalNodes = results.violations.reduce((sum, v) => sum + v.nodes.length, 0);
    logger.info(`${site.name}: ${results.violations.length} rule(s) violated, ${totalNodes} node(s) total`);

    // Consumed by src/telemetry/reporter.ts in onTestEnd -- this is the
    // only place a spec touches telemetry; the reporter does the rest.
    await testInfo.attach('axe-results', {
      body: JSON.stringify({
        page: site.name,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          tags: v.tags,
          nodes: v.nodes.map((n) => ({ target: n.target as string[] })),
        })),
      }),
      contentType: 'application/json',
    });
  });
}
