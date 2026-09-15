import { expect, test } from '@playwright/test';

test('strategy lab renders a backtest of the Value Score history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Strategy Lab' }).click();

  await expect(page).toHaveURL(/\/backtest$/);
  await expect(page.getByRole('heading', { name: 'Strategy Lab' })).toBeVisible();

  const chart = page.getByTestId('equity-chart');
  await expect(chart).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Total return (BTC)')).toBeVisible();
  await expect(page.getByText('Max drawdown')).toBeVisible();
  await expect(page.getByText('Latest rebalances')).toBeVisible();

  await chart.hover({ position: { x: 320, y: 120 } });
  await expect(page.getByText(/Strategy ×/)).toBeVisible();

  await page.getByRole('button', { name: 'USD' }).click();
  await expect(page.getByRole('img', { name: /in usd/i })).toBeVisible();
});

test('strategy lab can grid-search and apply a configuration', async ({ page }) => {
  await page.goto('/backtest');
  await expect(page.getByTestId('equity-chart')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Optimize' }).click();
  await page.getByRole('button', { name: 'Run backtest' }).click();

  await expect(page.getByText('Best configurations (by Sharpe)')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Apply' }).first().click();

  await expect(page.getByTestId('equity-chart')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/rebalances ·/)).toBeVisible();
});
