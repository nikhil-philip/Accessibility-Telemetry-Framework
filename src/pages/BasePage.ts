import { Page } from '@playwright/test';

/**
 * Every page object owns its own route (`path`) and exposes `open()` rather
 * than a bare `goto` -- callers shouldn't need to know ShopSmart's file
 * names, only "open the cart page". Locators are declared as readonly
 * fields built from `this.page` in the constructor (Playwright locators are
 * lazy -- building one doesn't query the DOM until an action/assertion
 * uses it, so this is cheap even for elements that don't exist yet).
 *
 * Deliberately not here: assertions. Page objects describe *how to interact
 * with* a page; specs decide *what should be true*. Keeping `expect()` out
 * of page objects is what keeps them reusable across a functional spec and
 * an accessibility spec for the same page.
 */
export abstract class BasePage {
  protected abstract readonly path: string;

  constructor(protected readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto(this.path);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async title(): Promise<string> {
    return this.page.title();
  }
}
