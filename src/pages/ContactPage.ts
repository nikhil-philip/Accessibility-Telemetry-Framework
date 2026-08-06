import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ContactPage extends BasePage {
  protected readonly path = 'contact.html';

  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly subjectSelect: Locator;
  readonly messageInput: Locator;
  readonly sendMessageButton: Locator;
  readonly faqTriggers: Locator;

  constructor(page: Page) {
    super(page);
    this.nameInput = page.getByLabel('Name');
    this.emailInput = page.getByLabel('Email');
    this.subjectSelect = page.getByLabel('Subject');
    this.messageInput = page.getByLabel('Message');
    this.sendMessageButton = page.getByRole('button', { name: 'Send message' });
    this.faqTriggers = page.locator('.accordion-trigger');
  }

  async submitMessage(details: { name: string; email: string; subject: string; message: string }): Promise<void> {
    await this.nameInput.fill(details.name);
    await this.emailInput.fill(details.email);
    await this.subjectSelect.selectOption(details.subject);
    await this.messageInput.fill(details.message);
    await this.sendMessageButton.click();
  }

  async expandFaq(question: string): Promise<void> {
    await this.page.getByRole('button', { name: question }).click();
  }
}
