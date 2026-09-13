import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ScatterChart from './ScatterChart';
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
  makeCoin({ symbol: 'ETHBTC', name: 'Ethereum', market_cap: 300_000_000_000, distance_pct_event: 80, volume_24h: 500_000_000 }),
  makeCoin({ symbol: 'XLMUSDT', name: 'Stellar', market_cap: 5_000_000_000, distance_pct_event: 12, volume_24h: 50_000_000 }),
  makeCoin({ symbol: 'NOCAPBTC', name: 'No market data', market_cap: null }),
];

describe('ScatterChart', () => {
  it('renders one circle per coin with market data and reports clicks', async () => {
    const onCoinClick = vi.fn();
    const { container } = render(<ScatterChart coins={coins} useAtl={false} onCoinClick={onCoinClick} />);

    const chart = container.querySelector('svg[aria-label="Altcoin dip scatter chart"]') as SVGSVGElement;
    expect(chart).not.toBeNull();

    await waitFor(() => {
      expect(chart.querySelectorAll('circle')).toHaveLength(2);
    });

    fireEvent.click(chart.querySelectorAll('circle')[0]);
    expect(onCoinClick).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHBTC' }));
  });

  it('renders coins closer to the dip with a larger radius', async () => {
    const { container } = render(<ScatterChart coins={coins} useAtl={false} onCoinClick={vi.fn()} />);

    const chart = container.querySelector('svg[aria-label="Altcoin dip scatter chart"]') as SVGSVGElement;
    await waitFor(() => {
      expect(chart.querySelectorAll('circle')).toHaveLength(2);
    });

    const [eth, xlm] = Array.from(chart.querySelectorAll('circle'));
    expect(Number(xlm.getAttribute('r'))).toBeGreaterThan(Number(eth.getAttribute('r')));
  });

  it('renders labeled axes and the watch zone', () => {
    render(<ScatterChart coins={coins} useAtl={false} onCoinClick={vi.fn()} />);

    expect(screen.getByText('Market cap (USD, log scale)')).toBeTruthy();
    expect(screen.getByText('Distance from dip (%)')).toBeTruthy();
    expect(screen.getByText(/Watch zone/)).toBeTruthy();
  });

  it('reports coins hidden because of missing market data', () => {
    render(<ScatterChart coins={coins} useAtl={false} onCoinClick={vi.fn()} />);

    expect(screen.getByText(/1 coin hidden/)).toBeTruthy();
  });
});
