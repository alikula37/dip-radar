import { describe, expect, it } from 'vitest';

import { buildCoinCardSvg, buildDigestCardSvg, coinTweetText, digestTweetText } from './shareCard';
import type { Coin } from '@/types';

function coin(overrides: Partial<Coin> = {}): Coin {
  return {
    symbol: 'BCHBTC',
    base_asset: 'BCH',
    name: 'Bitcoin Cash',
    logo_url: null,
    current_price_btc: 0.007,
    current_price_usd: 612,
    price_7d_ago_btc: 0.0068,
    price_30d_ago_btc: 0.006,
    event_low: 0.0068,
    all_time_low: 0.005,
    distance_pct_event: 2.9,
    distance_pct_atl: 40,
    bubble_size_event: 50,
    bubble_size_atl: 50,
    market_cap: 12_000_000_000,
    volume_24h: 300_000_000,
    valuation_pct_1y: 4,
    valuation_pct_3y: 3.6,
    valuation_pct_all: 12,
    median_dist_3y: -35,
    range_position: 0.18,
    days_since_atl: 900,
    basing_pct_90d: 31,
    dip_touches: 6,
    dip_bounces: 5,
    dip_bounce_avg: 42.8,
    trend_30d_pct: 8,
    trend_90d_pct: 12,
    above_sma200: true,
    history_days: 2400,
    value_score: 96.8,
    value_parts: { dip_respect: 9 },
    ...overrides,
  };
}

describe('share cards', () => {
  it('renders a coin report card with the key numbers', () => {
    const svg = buildCoinCardSvg(coin(), {
      dateLabel: '2026-09-17',
      referenceLabel: 'Since 2021 low',
      dipHistory: [
        { timestamp: '2026-01-01', close: 0.007, all_time_low: 0.005, event_low: 0.0068, distance_pct_event: 3, distance_pct_atl: 40 },
        { timestamp: '2026-06-01', close: 0.0071, all_time_low: 0.005, event_low: 0.0068, distance_pct_event: 4, distance_pct_atl: 41 },
      ],
    });

    expect(svg).toContain('DIP RADAR');
    expect(svg).toContain('$BCH');
    expect(svg).toContain('>97<'); // rounded value score
    expect(svg).toContain('+2.9%');
    expect(svg).toContain('5×');
    expect(svg).toContain('avg bounce +43%');
    expect(svg).toContain('github.com/alikula37/dip-radar');
    expect(svg).toContain('<path d="M');
  });

  it('renders the daily digest with up to five ranked rows', () => {
    const coins = [coin(), coin({ symbol: 'ETHBTC', base_asset: 'ETH', value_score: 33, dip_bounces: 2 }), coin({ symbol: 'ADABTC', base_asset: 'ADA', value_score: 12, dip_bounces: 0 })];

    const svg = buildDigestCardSvg(coins, { dateLabel: '2026-09-17' });

    expect(svg).toContain('Daily board');
    expect(svg).toContain('$BCH');
    expect(svg).toContain('$ETH');
    expect(svg).toContain('2026-09-17');
  });

  it('builds a ready-to-post tweet with the coin numbers', () => {
    const text = coinTweetText(coin());

    expect(text).toContain('$BCH');
    expect(text).toContain('Value Score 97/100');
    expect(text).toContain('+2.9% from its reference dip low');
    expect(text).toContain('Dip respect: 5 proven bounces, avg +43%');
    expect(text).toContain('#crypto #altcoins #BTC');
  });

  it('handles coins without a score or bounce history', () => {
    const fresh = coin({ value_score: null, dip_bounces: 0, dip_bounce_avg: null, valuation_pct_3y: null });

    const text = coinTweetText(fresh);

    expect(text).toContain('not enough history');
    expect(text).toContain('No proven bounce from this dip yet');
  });

  it('builds the digest tweet as a numbered list', () => {
    const text = digestTweetText([coin(), coin({ base_asset: 'ETH', symbol: 'ETHBTC', value_score: 33 })], '2026-09-17');

    expect(text.startsWith('🎯 Dip Radar daily board · 2026-09-17')).toBe(true);
    expect(text).toContain('1. $BCH · score 97');
    expect(text).toContain('2. $ETH · score 33');
  });
});
