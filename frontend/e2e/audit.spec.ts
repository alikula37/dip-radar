import { expect, test } from '@playwright/test';

const errors: string[] = [];

test.beforeEach(async ({ request }) => {
  // The watchlist lives in the database; make the audit idempotent.
  await request.delete('/api/watchlist/ETHBTC');
});

test.afterEach(async ({ request }) => {
  await request.delete('/api/watchlist/ETHBTC');
});

test('full UI audit', async ({ page }) => {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('ERR_ABORTED') || text.includes('favicon')) return;
    // Static asset noise (e.g. a stale coin logo 404) is not an app error.
    if (text.includes('Failed to load resource')) return;
    errors.push(`console: ${text}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500 && response.url().includes('/api/')) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });

  // 1. default leaderboard
  await page.goto('/');
  await expect(page.getByTestId('dip-leaderboard')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Closest to their dip')).toBeVisible();

  // 2. all leaderboard modes render rows
  for (const mode of ['Falling', 'Cheapest', 'Basing', 'Closest']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(page.locator('table tbody tr').first()).toBeVisible();
  }

  // 3. cheapest window switch
  await page.getByRole('button', { name: 'Cheapest', exact: true }).click();
  await page.getByRole('button', { name: '1y', exact: true }).click();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  // 4. value score chip with breakdown tooltip
  const valueChip = page.locator('table tbody tr span[title*="Value score"]').first();
  await expect(valueChip).toBeVisible();

  // 5. table view + sorting on the new columns
  await page.goto('/?view=table');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Value/ }).click();
  await page.getByRole('button', { name: /^3y pct/ }).click();
  await page.getByRole('button', { name: /^Range pos/ }).click();
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  // 6. coin modal with chips, distribution strip and charts
  await page.getByPlaceholder('Search coins…').fill('ETHBTC');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('table tbody tr').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Current price')).toBeVisible();
  await expect(dialog.getByTestId('modal-price')).toContainText('$');
  await dialog.getByRole('button', { name: 'BTC', exact: true }).click();
  await expect(dialog.getByTestId('modal-price')).toContainText('BTC');
  await dialog.getByRole('button', { name: 'USD', exact: true }).click();
  await expect(dialog.getByText(/Where today/)).toBeVisible();
  await expect(dialog.getByRole('img', { name: /price distribution/ })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('img', { name: /dip distance/ })).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();

  // 7. map + treemap views
  await page.goto('/?view=scatter');
  await expect(page.getByRole('img', { name: 'Altcoin dip scatter chart' })).toBeVisible({ timeout: 30_000 });
  await page.goto('/?view=treemap');
  await expect(page.getByRole('img', { name: 'Altcoin dip treemap' })).toBeVisible({ timeout: 30_000 });

  // 8. filter transparency + reset
  await page.goto('/?listed=new&view=table');
  await expect(page.getByText(/hidden by .*listing date/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByText(/hidden by .*listing date/)).toHaveCount(0);

  // 9. stables toggle
  await expect(page.getByRole('button', { name: /Stables hidden \(\d+\)/ })).toBeVisible();

  // 10. as-of view round trip
  await page.goto('/?asof=2024-03-01');
  await expect(page.getByText(/Historical view:/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back to live', exact: true }).click();
  await expect(page.getByText(/Historical view:/)).toHaveCount(0);

  // 11. compare flow
  await page.goto('/?view=table');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder('Search coins…').fill('ETHBTC');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('table tbody tr').first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('img', { name: 'Coin comparison chart' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('img', { name: 'Coin comparison chart' })).toHaveCount(0);

  // 12. watchlist star + panel
  await page.getByPlaceholder('Search coins…').fill('ETHBTC');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 });
  const star = page.locator('table tbody tr').first().locator('button[aria-label*="watchlist"]');
  await expect(star).toHaveAttribute('aria-label', /Add/);
  await star.click();
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
  await expect(page.getByText(/no alerts yet|Alert at/).first()).toBeVisible({ timeout: 15_000 });
  await expect(star).toHaveAttribute('aria-label', /Remove/);
  await star.click();
  await expect(page.getByText(/Star coins in the table/i)).toBeVisible({ timeout: 15_000 });

  // 13. CSV export
  const csvEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  const csv = await csvEvent;
  expect(csv.suggestedFilename()).toMatch(/dip-radar-.*\.csv/);

  // 14. PNG export on the map
  await page.goto('/?view=scatter');
  await expect(page.getByRole('img', { name: 'Altcoin dip scatter chart' })).toBeVisible({ timeout: 30_000 });
  const pngEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG' }).click();
  const png = await pngEvent;
  expect(png.suggestedFilename()).toMatch(/dip-radar-.*\.png/);

  // 15. URL state round trip
  await page.goto('/?ref=atl&view=table&cap=100000000&vol=5000000&listed=old&stables=1');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Stables shown/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Stables shown/ })).toBeVisible();

  // 16. no console/page errors along the way
  expect(errors, errors.join('\n')).toEqual([]);
});
