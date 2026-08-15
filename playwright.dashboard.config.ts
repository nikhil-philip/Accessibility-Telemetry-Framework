import { defineConfig, devices } from '@playwright/test';

/**
 * Standalone Playwright config for the L7 dashboard's own smoke/a11y tests
 * (tests-dashboard/). Deliberately separate from playwright.config.ts,
 * which drives the ShopSmart accessibility/functional suite against a
 * different app, port, and auth setup (tests/auth.setup.ts) the dashboard
 * has no use for -- keeping the two fully decoupled means `npm test` never
 * touches the dashboard, and this suite never boots ShopSmart or requires
 * its auth state. testDir is intentionally tests-dashboard/, not tests/,
 * so playwright.config.ts's own testDir glob never picks these specs up.
 */
const PORT = Number(process.env.DASHBOARD_PORT) || 4310;

export default defineConfig({
  testDir: './tests-dashboard',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,

  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // (Re)generates dashboard/ from current telemetry, then serves it --
  // scripts/generate-dashboard.ts and scripts/serve-dashboard.ts are both
  // existing, unmodified L7 tooling; this just chains them so the suite
  // always exercises a freshly-built dashboard.
  webServer: {
    command: 'npm run serve:dashboard',
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
