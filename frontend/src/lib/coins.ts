import type { Coin } from '@/types';

export type ListingFilter = 'any' | 'old' | 'new';

const CUTOFF_2021 = Date.UTC(2021, 0, 1);

export function matchesListingFilter(coin: Coin, filter: ListingFilter): boolean {
  if (filter === 'any') return true;
  if (!coin.listing_date) return false;
  const listed = +new Date(coin.listing_date);
  if (!Number.isFinite(listed)) return false;
  return filter === 'old' ? listed < CUTOFF_2021 : listed >= CUTOFF_2021;
}

/** Stablecoins and other pegged assets are hidden unless explicitly shown. */
export function matchesStableFilter(coin: Coin, showStables: boolean): boolean {
  return showStables || !coin.is_stable;
}

/**
 * Change in distance-to-dip over the last 7/30 days, in percentage points.
 * Negative values mean the coin is moving closer to its dip.
 */
export function trendDelta(coin: Coin, useAtl: boolean, days: 7 | 30): number | null {
  const now = coin.current_price_btc;
  const then = days === 7 ? coin.price_7d_ago_btc : coin.price_30d_ago_btc;
  const low = useAtl ? coin.all_time_low : coin.event_low;
  if (!now || !then || !low) return null;
  return ((now - then) / low) * 100;
}

export function formatTrend(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} pp`;
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function coinsToCsv(coins: Coin[]): string {
  const columns = [
    'symbol',
    'base_asset',
    'name',
    'listing_date',
    'current_price_btc',
    'price_7d_ago_btc',
    'price_30d_ago_btc',
    'market_cap',
    'volume_24h',
    'event_low',
    'all_time_low',
    'distance_pct_event',
    'distance_pct_atl',
    'price_verified',
    'price_deviation_pct',
  ] as const;

  const rows = coins.map((coin) =>
    columns
      .map((column) => csvEscape(coin[column as keyof Coin]))
      .join(','),
  );

  return [columns.join(','), ...rows].join('\n');
}

export function downloadCsv(coins: Coin[]): void {
  const blob = new Blob([coinsToCsv(coins)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dip-radar-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
