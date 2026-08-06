import { test as base } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AXE_TAGS } from '../config/axe.config';
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
 * one. Two things live here rather than in individual specs:
 *  1. `makeAxeBuilder` -- Playwright's own documented pattern for a11y
 *     fixtures, so every spec scans with the same rule configuration
 *     without re-importing AxeBuilder or the tag list.
 *  2. One fixture per page object -- specs receive `{ cartPage }` already
 *     constructed against the current `page`, instead of `new CartPage(page)`
 *     boilerplate in every test body.
 */
export const test = base.extend<Fixtures>({
  makeAxeBuilder: async ({ page }, use) => {
    const build = () => new AxeBuilder({ page }).withTags([...AXE_TAGS]);
    await use(build);
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
