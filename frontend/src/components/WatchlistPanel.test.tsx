import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WatchlistPanel from './WatchlistPanel';
import type { Watch } from '@/types';

const watches: Watch[] = [
  {
    symbol: 'ETHBTC',
    base_asset: 'ETH',
    name: 'Ethereum',
    logo_url: null,
    distance_pct_event: 15.5,
    distance_pct_atl: 40,
    threshold_pct: 20,
    last_alerted_at: null,
  },
];

function renderPanel(overrides: Partial<Parameters<typeof WatchlistPanel>[0]> = {}) {
  return render(
    <WatchlistPanel
      watches={watches}
      useAtl={false}
      colorFor={() => '#4ade80'}
      onSelect={vi.fn()}
      onRemove={vi.fn()}
      onThresholdChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe('WatchlistPanel', () => {
  it('shows an empty state when nothing is watched', () => {
    renderPanel({ watches: [] });

    expect(screen.getByText(/star coins/i)).toBeTruthy();
  });

  it('renders watched coins and removes them', () => {
    const onRemove = vi.fn();
    renderPanel({ onRemove });

    expect(screen.getByText('ETH')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove ETHBTC from watchlist'));

    expect(onRemove).toHaveBeenCalledWith('ETHBTC');
  });

  it('updates the threshold on blur', () => {
    const onThresholdChange = vi.fn();
    renderPanel({ onThresholdChange });

    const input = screen.getByLabelText('Alert threshold for ETHBTC');
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.blur(input);

    expect(onThresholdChange).toHaveBeenCalledWith('ETHBTC', 10);
  });

  it('does not fire for an unchanged threshold', () => {
    const onThresholdChange = vi.fn();
    renderPanel({ onThresholdChange });

    const input = screen.getByLabelText('Alert threshold for ETHBTC');
    fireEvent.blur(input);

    expect(onThresholdChange).not.toHaveBeenCalled();
  });
});
