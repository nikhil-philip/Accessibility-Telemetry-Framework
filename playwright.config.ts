import { defineConfig, devices } from '@playwright/test';
import { envConfig } from './src/config/env.config';

/**
 * Reports vs. telemetry (see docs/architecture/ARCHITECTURE.md L4 and
 * README-level docs): `reports/` is Playwright's own run report -- did the
 * suite pass, what failed, screenshots/traces for debugging. `telemetry/`
 * (root-level, written by src/telemetry/reporter.ts) is the *semantic*
 * accessibility record -- what violations exist, for the SPC layer to
 * consume later. They answer different questions and are kept separate on
 * purpose.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : envConfig.retries,
  workers: process.env.CI ? 4 : undefined,
  timeout: envConfig.defaultTimeoutMs * 3,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['./src/telemetry/reporter.ts'],
  ],

  use: {
    baseURL: envConfig.baseURL,
    headless: envConfig.headless,
    actionTimeout: envConfig.defaultTimeoutMs,
    navigationTimeout: envConfig.navigationTimeoutMs,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  // Boots ShopSmart automatically so `npm test` works from a clean checkout
  // with no manual server-start step. reuseExistingServer keeps local dev
  // fast (won't rebuild/restart a server you already have running) while
  // CI always starts clean.
  webServer: {
    command: 'npm run start',
    cwd: './apps/shopsmart',
    url: envConfig.baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
