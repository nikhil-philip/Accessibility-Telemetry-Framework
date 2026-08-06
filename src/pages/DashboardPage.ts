import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
  protected readonly path = 'dashboard.html';

  readonly heading: Locator;
  readonly refreshStatsButton: Locator;
  readonly quickActionsButton: Locator;
  readonly quickActionsPanel: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1 });
    this.refreshStatsButton = page.getByRole('button', { name: 'Refresh stats' });
    this.quickActionsButton = page.getByRole('button', { name: 'Quick actions' });
    this.quickActionsPanel = page.locator('#quickActionsPanel');
  }

  async openQuickActions(): Promise<void> {
    await this.quickActionsButton.click();
  }

  statValue(label: string): Locator {
    return this.page.locator('.stat-card').filter({ hasText: label }).locator('.stat-value');
  }
}
