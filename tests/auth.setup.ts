import * as fs from 'fs';
import * as path from 'path';
import { test as setup } from '../src/fixtures';
import { testUsers } from '../src/utils/testData';
import { createLogger } from '../src/utils/logger';

const logger = createLogger('AuthSetup');
const AUTH_FILE = 'playwright/.auth/user.json';

/**
 * Playwright's documented "setup project" pattern (playwright.config.ts's
 * `setup` project runs this once; every other project depends on it and
 * reuses the saved storageState instead of logging in per-test).
 *
 * ShopSmart's login form does not yet issue a real backend session -- it's
 * a static demo form (see the prior ShopSmart build's "statelessness
 * constraint"). This setup still performs the real UI login interaction,
 * then explicitly navigates to the authenticated area, so storageState
 * captures whatever session state *does* exist. The moment ShopSmart (or
 * any real app reusing this framework) issues actual session cookies /
 * localStorage on login, this same code captures them correctly with no
 * changes required.
 */
setup('authenticate', async ({ page, loginPage }) => {
  await loginPage.open();
  await loginPage.login(testUsers.standard.email, testUsers.standard.password);

  await page.goto('dashboard.html');
  await page.waitForLoadState('domcontentloaded');

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
  logger.info(`Saved session state to ${AUTH_FILE}`);
});
