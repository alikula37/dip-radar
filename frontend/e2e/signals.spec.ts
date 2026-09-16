import { expect, test } from '@playwright/test';

test('signals page opens from the dashboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /signals/i }).click();

  await expect(page.getByRole('heading', { name: 'Signals' })).toBeVisible();
  // Either the empty state (fresh DB) or a saved watch panel (existing DB).
  await expect(page.getByText(/No watched strategies yet|shadow baseline/)).toBeVisible();
});
