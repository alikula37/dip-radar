import { describe, expect, it } from 'vitest';

import { coinsToCsv, csvEscape, formatTrend, trendDelta } from './coins';
import type { Coin } from '@/types';

function makeCoin(overrides: Partial<Coin> = {}): Coin {
  return {
    symbol: 'ETHBTC',
    name: 'Ethereum',
    logo_url: null,
    current_price_btc: 0.03,
    event_low: 0.01,
    all_time_low: 0.01,
    price_7d_ago_btc: 0.035,
    price_30d_ago_btc: 0.04,
    distance_pct_event: 100,
    distance_pct_atl: 200,
    bubble_size_event: 50,
    bubble_size_atl: 50,
    market_cap: 1000,
    volume_24h: 100,
    ...overrides,
  };
}

describe('trendDelta', () => {
  it('is negative when the price is falling toward the dip', () => {
    // (0.03 - 0.035) / 0.01 * 100 = -50 pp
    expect(trendDelta(makeCoin(), false, 7)).toBeCloseTo(-50);
  });

  it('uses the selected reference low', () => {
    const coin = makeCoin({ all_time_low: 0.02 });
    // (0.03 - 0.035) / 0.02 * 100 = -25 pp
    expect(trendDelta(coin, true, 7)).toBeCloseTo(-25);
  });

  it('returns null when data is missing', () => {
    expect(trendDelta(makeCoin({ price_7d_ago_btc: null }), false, 7)).toBeNull();
    expect(trendDelta(makeCoin({ current_price_btc: null }), false, 7)).toBeNull();
  });
});

describe('formatTrend', () => {
  it('formats percentage points with a sign', () => {
    expect(formatTrend(-12.34)).toBe('-12.3 pp');
    expect(formatTrend(5)).toBe('+5.0 pp');
    expect(formatTrend(null)).toBe('N/A');
  });
});

describe('csvEscape', () => {
  it('quotes values containing separators', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape(null)).toBe('');
  });
});

describe('coinsToCsv', () => {
  it('exports a header and one row per coin', () => {
    const csv = coinsToCsv([makeCoin(), makeCoin({ symbol: 'ICPUSDT' })]);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('symbol');
    expect(lines[0]).toContain('distance_pct_atl');
    expect(lines[1].startsWith('ETHBTC,')).toBe(true);
    expect(lines[2].startsWith('ICPUSDT,')).toBe(true);
  });
});
