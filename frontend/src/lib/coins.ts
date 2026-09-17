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

export type ValuationWindow = 1 | 3 | 'all';

export const VALUATION_WINDOW_LABELS: Record<string, string> = {
  '1': '1y',
  '3': '3y',
  all: 'all',
};

/** Valuation percentile (share of days spent above today's price). */
export function valuationPct(coin: Coin, window: ValuationWindow): number | null {
  if (window === 1) return coin.valuation_pct_1y ?? null;
  if (window === 3) return coin.valuation_pct_3y ?? null;
  return coin.valuation_pct_all ?? null;
}

const SCORE_PART_LABELS: Record<string, string> = {
  valuation: 'Valuation percentile',
  distance: 'Distance to dip',
  median_gap: 'Below 3y median',
  basing: 'Basing at lows',
  range: 'Range position',
  dip_respect: 'Dip respect (proven bounces)',
  knife: 'Knife-risk penalty',
};

export function scoreBreakdown(coin: Coin): string {
  const parts = coin.value_parts ?? {};
  const rows = Object.entries(parts).map(
    ([key, value]) => `${SCORE_PART_LABELS[key] ?? key}: ${value > 0 ? '+' : ''}${value}`,
  );
  return [`Value score ${coin.value_score ?? 'N/A'}`, ...rows].join('\n');
}

export interface FilterState {
  search: string;
  minCap: number;
  minVolume: number;
  listingFilter: ListingFilter;
  showStables: boolean;
  watchOnly: boolean;
}

export interface HiddenReasons {
  visible: number;
  total: number;
  reasons: { key: 'stables' | 'listing' | 'marketCap' | 'volume' | 'watchlist' | 'search'; count: number }[];
}

/**
 * Counts how many coins each filter removes (first failing filter wins) so
 * the UI can explain why a coin is missing from the lists.
 */
export function summarizeHiddenCoins(coins: Coin[], filters: FilterState, watchedSymbols: Set<string>): HiddenReasons {
  const query = filters.search.trim().toLowerCase();
  const counts: Record<string, number> = { stables: 0, listing: 0, marketCap: 0, volume: 0, watchlist: 0, search: 0 };
  let visible = 0;

  for (const coin of coins) {
    if (!matchesStableFilter(coin, filters.showStables)) {
      counts.stables += 1;
      continue;
    }
    if (!matchesListingFilter(coin, filters.listingFilter)) {
      counts.listing += 1;
      continue;
    }
    if ((coin.market_cap ?? 0) < filters.minCap) {
      counts.marketCap += 1;
      continue;
    }
    if ((coin.volume_24h ?? 0) < filters.minVolume) {
      counts.volume += 1;
      continue;
    }
    if (filters.watchOnly && !watchedSymbols.has(coin.symbol)) {
      counts.watchlist += 1;
      continue;
    }
    if (query) {
      const haystack = `${coin.symbol} ${coin.name ?? ''} ${coin.base_asset ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) {
        counts.search += 1;
        continue;
      }
    }
    visible += 1;
  }

  const reasons = (Object.keys(counts) as HiddenReasons['reasons'][number]['key'][])
    .filter((key) => counts[key] > 0)
    .map((key) => ({ key, count: counts[key] }));

  return { visible, total: coins.length, reasons };
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
    'valuation_pct_1y',
    'valuation_pct_3y',
    'valuation_pct_all',
    'median_dist_1y',
    'median_dist_3y',
    'range_position',
    'days_since_atl',
    'basing_pct_90d',
    'trend_30d_pct',
    'trend_90d_pct',
    'value_score',
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
