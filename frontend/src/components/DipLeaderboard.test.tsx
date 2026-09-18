import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DipLeaderboard from './DipLeaderboard';
import type { Coin } from '@/types';

function makeCoin(overrides: Partial<Coin> & Pick<Coin, 'symbol'>): Coin {
  return {
    name: overrides.symbol,
    logo_url: null,
    current_price_btc: 1,
    event_low: 0.5,
    all_time_low: 0.5,
    price_7d_ago_btc: 1,
    price_30d_ago_btc: 1,
    distance_pct_event: 100,
    distance_pct_atl: 100,
    bubble_size_event: 50,
    bubble_size_atl: 50,
    market_cap: 100_000_000,
    volume_24h: 5_000_000,
    valuation_pct_1y: 50,
    valuation_pct_3y: 50,
    valuation_pct_all: 50,
    basing_pct_90d: 30,
    value_score: 50,
    value_parts: { valuation: 20 },
    ...overrides,
  };
}

const coins: Coin[] = [
  makeCoin({
    symbol: 'ETHBTC',
    name: 'Ethereum',
    distance_pct_event: 80,
    price_7d_ago_btc: 1.1,
    market_cap: 300_000_000_000,
    valuation_pct_3y: 90,
    basing_pct_90d: 20,
  }),
  makeCoin({
    symbol: 'LTCBTC',
    name: 'Litecoin',
    distance_pct_event: 30,
    price_7d_ago_btc: 1.02,
    market_cap: 5_000_000_000,
    valuation_pct_3y: 40,
    basing_pct_90d: 60,
  }),
  makeCoin({
    symbol: 'XRPBTC',
    name: 'Ripple',
    distance_pct_event: 10,
    price_7d_ago_btc: 1.08,
    market_cap: 80_000_000_000,
    valuation_pct_3y: 5,
    basing_pct_90d: 10,
  }),
];

function renderBoard(overrides: Partial<Parameters<typeof DipLeaderboard>[0]> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <DipLeaderboard
      coins={coins}
      useAtl={false}
      referenceLabel="Since 2021"
      colorFor={() => '#4ade80'}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { ...utils, onSelect };
}

function dataRows() {
  return screen.getAllByRole('row').slice(1);
}

describe('DipLeaderboard', () => {
  it('sorts by distance ascending by default', () => {
    renderBoard();

    const rows = dataRows();
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('XRP')).toBeTruthy();
    expect(within(rows[1]).getByText('LTC')).toBeTruthy();
    expect(within(rows[2]).getByText('ETH')).toBeTruthy();
  });

  it('switches to the falling order', () => {
    renderBoard();

    fireEvent.click(screen.getByRole('button', { name: 'Falling' }));

    const rows = dataRows();
    expect(within(rows[0]).getByText('ETH')).toBeTruthy();
    expect(within(rows[2]).getByText('LTC')).toBeTruthy();
  });

  it('sorts by valuation percentile in Cheapest mode', () => {
    renderBoard();

    fireEvent.click(screen.getByRole('button', { name: 'Cheapest' }));

    const rows = dataRows();
    expect(within(rows[0]).getByText('XRP')).toBeTruthy();
    expect(within(rows[2]).getByText('ETH')).toBeTruthy();
  });

  it('sorts by basing share in Basing mode', () => {
    renderBoard();

    fireEvent.click(screen.getByRole('button', { name: 'Basing' }));

    const rows = dataRows();
    expect(within(rows[0]).getByText('LTC')).toBeTruthy();
  });

  it('sorts by Value Score in Value mode and hides unscored coins', () => {
    const scored = [
      makeCoin({ symbol: 'AAABTC', name: 'AAA', value_score: 91 }),
      makeCoin({ symbol: 'BBBBTC', name: 'BBB', value_score: 42 }),
      makeCoin({ symbol: 'CCCBTC', name: 'CCC', value_score: null }),
    ];
    render(
      <DipLeaderboard coins={scored} useAtl={false} referenceLabel="Since 2021" colorFor={() => '#fff'} onSelect={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Value' }));

    expect(screen.getByText('Best Value Scores')).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('91 · value')).toBeTruthy();
    expect(within(rows[1]).getByText('42 · value')).toBeTruthy();
    expect(within(rows[0]).getByTitle(/Value Score 91/)).toBeTruthy();
    expect(screen.queryByText('CCC')).toBeNull();
  });

  it('expands beyond the top rows', () => {
    renderBoard({ limit: 2 });

    expect(dataRows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Show all 3/ }));

    expect(dataRows()).toHaveLength(3);
  });

  it('opens the coin on row click', () => {
    const { onSelect } = renderBoard();

    fireEvent.click(screen.getByText('XRP'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'XRPBTC' }));
  });

  it('shows an empty state when filters exclude everything', () => {
    renderBoard({ coins: [] });

    expect(screen.getByText(/no coins match/i)).toBeTruthy();
  });
});
