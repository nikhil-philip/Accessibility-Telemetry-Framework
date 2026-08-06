import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProductListingPage extends BasePage {
  protected readonly path = 'products.html';

  readonly searchInput: Locator;
  readonly categoryFilter: Locator;
  readonly sortTrigger: Locator;
  readonly sortMenu: Locator;
  readonly inStockToggle: Locator;
  readonly viewToggleButton: Locator;
  readonly productCards: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.getByRole('searchbox', { name: 'Search products' });
    this.categoryFilter = page.getByLabel('Category');
    this.sortTrigger = page.getByRole('combobox', { name: 'Sort products' });
    this.sortMenu = page.locator('#sortMenu');
    this.inStockToggle = page.getByRole('checkbox', { name: 'In stock only' });
    this.viewToggleButton = page.getByRole('button', { name: 'Toggle grid or list view' });
    this.productCards = page.locator('.product-card');
  }

  /**
   * "Add to cart" appears on most cards with identical text, so any action
   * on it must be scoped to a specific card, not queried page-wide.
   */
  productCard(name: string): Locator {
    return this.productCards.filter({ hasText: name });
  }

  async addToCart(productName: string): Promise<void> {
    await this.productCard(productName).getByRole('button', { name: /add to cart/i }).click();
  }

  async openSortMenu(): Promise<void> {
    await this.sortTrigger.click();
  }

  async selectSortOption(optionName: string): Promise<void> {
    await this.openSortMenu();
    await this.sortMenu.getByRole('option', { name: optionName }).click();
  }

  /**
   * Each card has two links that both point at the product (the image and
   * the title) sharing the same accessible name -- `.first()` is a
   * deliberate, safe choice here since either one navigates identically.
   */
  async openProductDetails(productName: string): Promise<void> {
    await this.productCard(productName).getByRole('link', { name: productName }).first().click();
  }
}
