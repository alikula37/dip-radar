import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Treemap from './Treemap';
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
  makeCoin({ symbol: 'ETHBTC', name: 'Ethereum', market_cap: 300_000_000_000, distance_pct_event: 80 }),
  makeCoin({ symbol: 'LTCBTC', name: 'Litecoin', market_cap: 5_000_000_000, distance_pct_event: 40 }),
  makeCoin({ symbol: 'NOCAPBTC', name: 'No market data', market_cap: null }),
];

describe('Treemap', () => {
  it('renders one tile per coin with market data and reports clicks', async () => {
    const onCoinClick = vi.fn();
    const { container } = render(
      <Treemap coins={coins} useAtl={false} colorFor={() => '#4ade80'} onCoinClick={onCoinClick} />,
    );

    const chart = container.querySelector('svg[aria-label="Altcoin dip treemap"]') as SVGSVGElement;
    expect(chart).not.toBeNull();

    await waitFor(() => {
      expect(chart.querySelectorAll('rect')).toHaveLength(2);
    });

    fireEvent.click(chart.querySelectorAll('rect')[0]);
    expect(onCoinClick).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHBTC' }));
  });

  it('labels large tiles with the base asset', async () => {
    render(<Treemap coins={coins} useAtl={false} colorFor={() => '#4ade80'} onCoinClick={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('ETH')).toBeTruthy();
    });
  });
});
