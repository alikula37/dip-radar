import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DipHistoryChart from './DipHistoryChart';

const points = [
  {
    timestamp: '2020-01-01T00:00:00',
    close: 0.8,
    all_time_low: 0.5,
    event_low: 0.5,
    distance_pct_event: 60,
    distance_pct_atl: 60,
  },
  {
    timestamp: '2021-06-01T00:00:00',
    close: 0.3,
    all_time_low: 0.2,
    event_low: 0.2,
    distance_pct_event: 50,
    distance_pct_atl: 50,
  },
];

describe('DipHistoryChart', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the distance series and shows hover values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(points), { status: 200 }));

    render(<DipHistoryChart symbol="ETHBTC" />);

    const chart = await screen.findByRole('img', { name: /ETHBTC dip distance/i });
    expect(chart.querySelector('path')).not.toBeNull();

    fireEvent.mouseMove(chart, { clientX: 350 });

    expect(await screen.findByText('2021-06-01')).toBeTruthy();
    expect(screen.getByText(/50\.00%/)).toBeTruthy();
  });

  it('draws the as-of marker when inside the range', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(points), { status: 200 }));

    render(<DipHistoryChart symbol="ETHBTC" marker="2021-06-01" />);

    expect(await screen.findByTestId('dip-history-marker')).toBeTruthy();
  });

  it('shows an error when the series is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('missing', { status: 404 }));

    render(<DipHistoryChart symbol="ETHBTC" />);

    expect(await screen.findByText(/dip history unavailable/i)).toBeTruthy();
  });
});
