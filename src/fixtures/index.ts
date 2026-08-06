import { test as base } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createAxeBuilder, scanPage, AccessibilityScanResult, ScanOptions } from '../utils/accessibilityScanner';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ProductListingPage } from '../pages/ProductListingPage';
import { ProductDetailsPage } from '../pages/ProductDetailsPage';
import { CartPage } from '../pages/CartPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { ProfilePage } from '../pages/ProfilePage';
import { ContactPage } from '../pages/ContactPage';

interface Fixtures {
  /** Pre-configured with axe.config.ts's tag list -- see that file for why `best-practice` matters. */
  makeAxeBuilder: () => AxeBuilder;
  /**
   * Bound convenience wrapper over accessibilityScanner.ts's `scanPage` --
   * specs that want the full AccessibilityScanResult (rule id, impact,
   * description, helpUrl, affected elements) call `scan({ pageName })`
   * instead of importing scanPage + passing `page` themselves.
   */
  scan: (params: { pageName: string; scanContext?: string } & ScanOptions) => Promise<AccessibilityScanResult>;
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  productListingPage: ProductListingPage;
  productDetailsPage: ProductDetailsPage;
  cartPage: CartPage;
  checkoutPage: CheckoutPage;
  profilePage: ProfilePage;
  contactPage: ContactPage;
}

/**
 * A single extended `test` that specs import instead of Playwright's base
 * one. Three things live here rather than in individual specs:
 *  1. `makeAxeBuilder` -- Playwright's own documented low-level a11y
 *     fixture pattern, for specs that want the raw AxeBuilder/AxeResults.
 *  2. `scan` -- the higher-level equivalent, returning accessibilityScanner
 *     .ts's fully-detailed AccessibilityScanResult (rule id, impact,
 *     description, helpUrl, affected elements) for one page/state.
 *  3. One fixture per page object -- specs receive `{ cartPage }` already
 *     constructed against the current `page`, instead of `new CartPage(page)`
 *     boilerplate in every test body.
 * Both (1) and (2) are backed by the same createAxeBuilder() in
 * accessibilityScanner.ts, so there is one source of truth for axe
 * configuration no matter which a spec uses.
 */
export const test = base.extend<Fixtures>({
  makeAxeBuilder: async ({ page }, use) => {
    await use(() => createAxeBuilder(page));
  },
  scan: async ({ page }, use) => {
    await use((params) => scanPage(page, params));
  },
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  dashboardPage: async ({ page }, use) => use(new DashboardPage(page)),
  productListingPage: async ({ page }, use) => use(new ProductListingPage(page)),
  productDetailsPage: async ({ page }, use) => use(new ProductDetailsPage(page)),
  cartPage: async ({ page }, use) => use(new CartPage(page)),
  checkoutPage: async ({ page }, use) => use(new CheckoutPage(page)),
  profilePage: async ({ page }, use) => use(new ProfilePage(page)),
  contactPage: async ({ page }, use) => use(new ContactPage(page)),
});

export { expect } from '@playwright/test';
