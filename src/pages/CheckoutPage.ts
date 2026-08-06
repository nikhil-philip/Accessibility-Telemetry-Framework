import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class CheckoutPage extends BasePage {
  protected readonly path = 'checkout.html';

  readonly heading: Locator;
  readonly fullNameInput: Locator;
  readonly addressInput: Locator;
  readonly cityInput: Locator;
  readonly postalCodeInput: Locator;
  /**
   * #checkoutEmail and #checkoutPhone each have two <label for> elements
   * (a seeded, still-present form-field-multiple-labels issue -- see
   * docs/violations/catalog.json). Their computed accessible name is the
   * concatenation of both labels, which is brittle to match by text, so
   * these two use the element id instead of getByLabel.
   */
  readonly emailInput: Locator;
  readonly phoneInput: Locator;
  readonly standardShippingRadio: Locator;
  readonly expressShippingRadio: Locator;
  readonly cardNumberInput: Locator;
  readonly cardExpiryInput: Locator;
  readonly cardCvcInput: Locator;
  readonly placeOrderButton: Locator;
  readonly orderConfirmModal: Locator;
  readonly confirmOrderButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1 });
    this.fullNameInput = page.getByLabel('Full name');
    this.addressInput = page.getByLabel('Address');
    this.cityInput = page.getByLabel('City');
    this.postalCodeInput = page.getByLabel('Postal code');
    this.emailInput = page.locator('#checkoutEmail');
    this.phoneInput = page.locator('#checkoutPhone');
    this.standardShippingRadio = page.getByLabel('Standard', { exact: false });
    this.expressShippingRadio = page.getByLabel('Express', { exact: false });
    this.cardNumberInput = page.getByLabel('Card number');
    this.cardExpiryInput = page.getByLabel('Expiry');
    this.cardCvcInput = page.getByLabel('CVC');
    this.placeOrderButton = page.getByRole('button', { name: 'Place order' });
    this.orderConfirmModal = page.locator('#orderConfirmModal');
    this.confirmOrderButton = this.orderConfirmModal.getByRole('button', { name: 'Confirm order' });
  }

  async fillShippingDetails(details: {
    fullName: string;
    address: string;
    city: string;
    postalCode: string;
    email: string;
    phone: string;
  }): Promise<void> {
    await this.fullNameInput.fill(details.fullName);
    await this.addressInput.fill(details.address);
    await this.cityInput.fill(details.city);
    await this.postalCodeInput.fill(details.postalCode);
    await this.emailInput.fill(details.email);
    await this.phoneInput.fill(details.phone);
  }

  async fillPaymentDetails(details: { cardNumber: string; cardExpiry: string; cardCvc: string }): Promise<void> {
    await this.cardNumberInput.fill(details.cardNumber);
    await this.cardExpiryInput.fill(details.cardExpiry);
    await this.cardCvcInput.fill(details.cardCvc);
  }

  async placeOrder(): Promise<void> {
    await this.placeOrderButton.click();
  }

  async confirmOrder(): Promise<void> {
    await this.confirmOrderButton.click();
  }
}
