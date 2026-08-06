import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class CartPage extends BasePage {
  protected readonly path = 'cart.html';

  readonly heading: Locator;
  readonly cartTotal: Locator;
  readonly proceedToCheckoutLink: Locator;
  readonly rows: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1 });
    this.cartTotal = page.locator('#cartTotal');
    this.proceedToCheckoutLink = page.getByRole('link', { name: 'Proceed to checkout' });
    this.rows = page.locator('table tbody tr');
  }

  /** Two rows share "Decrease/Increase quantity" button text, so every row action is scoped to its `<tr>`. */
  row(productName: string): Locator {
    return this.rows.filter({ hasText: productName });
  }

  async increaseQuantity(productName: string): Promise<void> {
    await this.row(productName).getByRole('button', { name: 'Increase quantity' }).click();
  }

  async decreaseQuantity(productName: string): Promise<void> {
    await this.row(productName).getByRole('button', { name: 'Decrease quantity' }).click();
  }

  async removeItem(productName: string): Promise<void> {
    await this.row(productName).getByRole('button', { name: `Remove ${productName} from cart` }).click();
  }

  quantityInput(productName: string): Locator {
    return this.row(productName).getByLabel('Quantity');
  }
}
