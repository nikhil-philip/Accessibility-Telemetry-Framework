import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProductDetailsPage extends BasePage {
  protected readonly path = 'product-details.html';

  readonly heading: Locator;
  readonly quantityInput: Locator;
  readonly decreaseQtyButton: Locator;
  readonly increaseQtyButton: Locator;
  /** Scoped with .first() -- the same-named button also exists, hidden, inside the Quick View modal. */
  readonly addToCartButton: Locator;
  readonly quickViewButton: Locator;
  readonly quickViewModal: Locator;
  readonly descriptionTab: Locator;
  readonly specsTab: Locator;
  readonly reviewsTab: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1 });
    this.quantityInput = page.getByLabel('Quantity');
    this.decreaseQtyButton = page.getByRole('button', { name: 'Decrease quantity' });
    this.increaseQtyButton = page.getByRole('button', { name: 'Increase quantity' });
    this.addToCartButton = page.getByRole('button', { name: 'Add to cart' }).first();
    this.quickViewButton = page.getByRole('button', { name: 'Quick view' });
    this.quickViewModal = page.locator('#quickViewModal');
    this.descriptionTab = page.getByRole('tab', { name: 'Description' });
    this.specsTab = page.getByRole('tab', { name: 'Specs' });
    this.reviewsTab = page.getByRole('tab', { name: 'Reviews' });
  }

  /** ShopSmart routes product detail pages via a `sku` query param. */
  async openProduct(sku: string): Promise<void> {
    await this.page.goto(`product-details.html?sku=${sku}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async setQuantity(times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.increaseQtyButton.click();
    }
  }
}
