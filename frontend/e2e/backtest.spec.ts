import { expect, test } from '@playwright/test';

test('strategy lab renders a backtest of the Value Score history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Strategy Lab' }).click();

  await expect(page).toHaveURL(/\/backtest$/);
  await expect(page.getByRole('heading', { name: 'Strategy Lab' })).toBeVisible();

  const chart = page.getByTestId('equity-chart');
  await expect(chart).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Total return (BTC)')).toBeVisible();
  await expect(page.getByText('Max drawdown')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rebalances' })).toBeVisible();

  await page.getByRole('button', { name: /show all .* rebalances/i }).click();
  await expect(page.getByRole('button', { name: /show latest 8 rebalances/i })).toBeVisible();

  await page.getByRole('button', { name: /trade log/i }).click();
  await expect(page.getByText(/Bought|No trades yet/)).toBeVisible({ timeout: 10_000 });

  await chart.hover({ position: { x: 320, y: 120 } });
  await expect(page.getByText(/Strategy ×/)).toBeVisible();

  await page.getByRole('button', { name: 'USD' }).click();
  await expect(page.getByRole('img', { name: /in usd/i })).toBeVisible();

  await page.getByLabel('Exit rule').selectOption('rebalance');
  await page.getByLabel(/sell when score/i).fill('55');
  await page.getByRole('button', { name: 'Run backtest' }).click();
  await expect(chart).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/reset to top N/)).toBeVisible();
});

test('auto-optimizer opens a dialog, scopes parameters and validates candidates', async ({ page }) => {
  await page.goto('/backtest');
  await expect(page.getByTestId('equity-chart')).toBeVisible({ timeout: 120_000 });

  await page.getByRole('button', { name: /auto-optimize/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Auto-optimize' });
  await expect(dialog).toBeVisible();

  // Add a fixed parameter to the search scope with its "+" button.
  await dialog.getByRole('button', { name: 'Optimize trailing_stop_pct' }).click();

  await dialog.getByRole('button', { name: /find best parameters/i }).click();

  const summary = dialog.getByText(/Validated \d+ · rejected \d+/);
  await expect(summary).toBeVisible({ timeout: 120_000 });

  const summaryText = (await summary.textContent()) ?? '';
  const validated = Number(/Validated (\d+)/.exec(summaryText)?.[1] ?? '0');
  if (validated > 0) {
    await expect(dialog.getByRole('columnheader', { name: /CV \(walk-forward\)/ })).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: 'Holdout' })).toBeVisible();
    const applyButton = dialog.getByRole('button', { name: 'Apply' }).first();
    await expect(applyButton).toBeVisible({ timeout: 30_000 });
    await applyButton.click();
    await expect(page.getByTestId('equity-chart')).toBeVisible({ timeout: 120_000 });
  } else {
    await expect(dialog.getByText(/No configuration passed validation/)).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: /CV \(walk-forward\)/ })).toHaveCount(0);
  }
});
