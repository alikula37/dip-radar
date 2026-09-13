import { expect, test } from '@playwright/test';

test('dashboard loads coins and opens the detail modal', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dip Radar' })).toBeVisible();
  await expect(page.getByText('Tracked coins', { exact: true })).toBeVisible();

  const chart = page.getByRole('img', { name: 'Altcoin dip scatter chart' });
  await expect(chart).toBeVisible({ timeout: 30_000 });

  await chart.locator('circle').first().click({ force: true });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Current price')).toBeVisible();

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('table view is available through the URL', async ({ page }) => {
  await page.goto('/?view=table');

  await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('img', { name: 'Altcoin dip scatter chart' })).toHaveCount(0);
});
