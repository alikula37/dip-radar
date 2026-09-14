import { expect, test } from '@playwright/test';

test('leaderboard is the default view', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('dip-leaderboard')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Closest to their dip')).toBeVisible();
});

test('dashboard loads coins and opens the detail modal', async ({ page }) => {
  await page.goto('/?view=scatter');

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

test('historical as-of view is available through the URL', async ({ page }) => {
  await page.goto('/?asof=2024-03-01');

  await expect(page.getByText(/Historical view:/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Back to live', exact: true })).toBeVisible();
});

test('explains which filter hides coins and resets them', async ({ page }) => {
  await page.goto('/?listed=new&view=table');

  await expect(page.getByText(/hidden by .*listing date/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Reset filters' })).toBeVisible();

  await page.getByRole('button', { name: 'Reset filters' }).click();

  await expect(page.getByText(/hidden by .*listing date/)).toHaveCount(0);
});
