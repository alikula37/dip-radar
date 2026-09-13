import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CoinTable from './CoinTable';
import type { Coin } from '@/types';

function makeCoin(overrides: Partial<Coin> & Pick<Coin, 'symbol'>): Coin {
  return {
    name: overrides.symbol,
    logo_url: null,
    current_price_btc: 0.001,
    event_low: 0.0005,
    all_time_low: 0.0005,
    distance_pct_event: 100,
    distance_pct_atl: 120,
    bubble_size_event: 50,
    bubble_size_atl: 50,
    market_cap: 100_000_000,
    volume_24h: 5_000_000,
    ...overrides,
  };
}

const coins: Coin[] = [
  makeCoin({ symbol: 'ETHBTC', name: 'Ethereum', base_asset: 'ETH' }),
  makeCoin({ symbol: 'LTCBTC', name: 'Litecoin', base_asset: 'LTC' }),
];

function renderTable(overrides: Partial<Parameters<typeof CoinTable>[0]> = {}) {
  return render(
    <CoinTable
      coins={coins}
      useAtl={false}
      colorFor={() => '#4ade80'}
      sort={{ key: 'distance', direction: 'asc' }}
      onToggleSort={vi.fn()}
      onSelect={vi.fn()}
      watchedSymbols={new Set()}
      onToggleWatch={vi.fn()}
      {...overrides}
    />,
  );
}

describe('CoinTable', () => {
  it('toggles the watchlist without opening the coin', () => {
    const onToggleWatch = vi.fn();
    const onSelect = vi.fn();
    renderTable({ onToggleWatch, onSelect });

    fireEvent.click(screen.getByLabelText('Add ETHBTC to watchlist'));

    expect(onToggleWatch).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHBTC' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows watched coins as active stars', () => {
    renderTable({ watchedSymbols: new Set(['ETHBTC']) });

    expect(screen.getByLabelText('Remove ETHBTC from watchlist')).toBeTruthy();
    expect(screen.getByLabelText('Add LTCBTC to watchlist')).toBeTruthy();
  });

  it('opens the coin when the row is clicked', () => {
    const onSelect = vi.fn();
    renderTable({ onSelect });

    fireEvent.click(screen.getByText('ETH'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHBTC' }));
  });
});
