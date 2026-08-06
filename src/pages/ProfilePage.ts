import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProfilePage extends BasePage {
  protected readonly path = 'profile.html';

  readonly fullNameInput: Locator;
  readonly emailInput: Locator;
  /** #profilePhone has two <label for> elements (same pattern as CheckoutPage.phoneInput) -- id selector, not getByLabel. */
  readonly phoneInput: Locator;
  readonly saveChangesButton: Locator;
  readonly profileTab: Locator;
  readonly ordersTab: Locator;
  readonly settingsTab: Locator;
  readonly orderHistoryTable: Locator;
  readonly emailNotificationsToggle: Locator;
  readonly deleteAccountButton: Locator;
  readonly deleteAccountModal: Locator;
  readonly confirmDeleteButton: Locator;

  constructor(page: Page) {
    super(page);
    this.fullNameInput = page.getByLabel('Full name');
    this.emailInput = page.getByLabel('Email');
    this.phoneInput = page.locator('#profilePhone');
    this.saveChangesButton = page.getByRole('button', { name: 'Save changes' });
    this.profileTab = page.getByRole('tab', { name: 'Profile' });
    this.ordersTab = page.getByRole('tab', { name: 'Orders' });
    this.settingsTab = page.getByRole('tab', { name: 'Settings' });
    this.orderHistoryTable = page.locator('#tab-orders table');
    this.emailNotificationsToggle = page.getByRole('switch', { name: 'Email notifications' });
    // .first(): the modal's own confirm button shares this exact name; the
    // trigger button precedes the modal in DOM order.
    this.deleteAccountButton = page.getByRole('button', { name: 'Delete account' }).first();
    this.deleteAccountModal = page.locator('#deleteAccountModal');
    this.confirmDeleteButton = this.deleteAccountModal.getByRole('button', { name: 'Delete account' });
  }

  async openOrdersTab(): Promise<void> {
    await this.ordersTab.click();
  }

  async openSettingsTab(): Promise<void> {
    await this.settingsTab.click();
  }

  orderRow(orderNumber: string): Locator {
    return this.orderHistoryTable.locator('tbody tr').filter({ hasText: orderNumber });
  }
}
