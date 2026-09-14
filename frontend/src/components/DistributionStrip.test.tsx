import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DistributionStrip from './DistributionStrip';

function makeKlines(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: `2024-01-01T00:00:00`,
    open: 1 + index,
    high: 1 + index,
    low: 1 + index,
    close: 1 + index,
    volume: 1,
  }));
}

describe('DistributionStrip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the distribution and current position marker', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makeKlines(60)), { status: 200 }),
    );

    render(<DistributionStrip symbol="ETHBTC" currentPrice={30} />);

    const chart = await screen.findByRole('img', { name: /ETHBTC price distribution/i });
    expect(chart.querySelector('circle')).not.toBeNull();
    expect(screen.getByText(/You are here/)).toBeTruthy();
  });

  it('asks for more history when there is not enough', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(makeKlines(10)), { status: 200 }));

    render(<DistributionStrip symbol="ETHBTC" currentPrice={5} />);

    expect(await screen.findByText(/not enough history/i)).toBeTruthy();
  });
});
