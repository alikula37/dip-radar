import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import EquityChart from './EquityChart';
import type { BacktestPoint } from '@/types';

const curve: BacktestPoint[] = [
  { date: '2022-01-01T00:00:00', equity: 1, period_return: 0, equity_usd: 1, benchmark_usd: 1 },
  { date: '2022-06-01T00:00:00', equity: 1.25, period_return: 0.25, equity_usd: 1.1, benchmark_usd: 0.9 },
  { date: '2023-01-01T00:00:00', equity: 0.9, period_return: -0.28, equity_usd: 1.4, benchmark_usd: 1.2 },
];

describe('EquityChart', () => {
  it('draws strategy, benchmark and drawdown paths', () => {
    render(<EquityChart curve={curve} mode="btc" />);

    const chart = screen.getByRole('img', { name: /backtest equity curve in btc/i });
    expect(chart.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
  });

  it('shows a hover readout for the nearest point', () => {
    render(<EquityChart curve={curve} mode="btc" />);

    fireEvent.mouseMove(screen.getByTestId('equity-chart'), { clientX: 4 });

    expect(screen.getByText(/strategy ×1\.000 \(0%\)/i)).toBeTruthy();
    expect(screen.getByText(/drawdown 0\.0%/i)).toBeTruthy();
  });

  it('renders USD values when the mode is usd', () => {
    render(<EquityChart curve={curve} mode="usd" />);

    expect(screen.getByRole('img', { name: /backtest equity curve in usd/i })).toBeTruthy();
    expect(screen.getByText(/btc \(usd\)/i)).toBeTruthy();
  });

  it('falls back to BTC values when USD rates are missing', () => {
    const noRates = curve.map((point) => ({ ...point, equity_usd: null, benchmark_usd: null }));
    render(<EquityChart curve={noRates} mode="usd" />);

    expect(screen.getByRole('img', { name: /backtest equity curve in btc/i })).toBeTruthy();
  });

  it('handles a curve that is too short', () => {
    render(<EquityChart curve={[curve[0]]} mode="btc" />);

    expect(screen.getByText(/not enough data/i)).toBeTruthy();
  });
});
