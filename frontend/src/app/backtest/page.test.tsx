import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BacktestPage from './page';
import type { BacktestResponse } from '@/types';

const response: BacktestResponse = {
  requested_start: '2022-01-01',
  requested_end: '2023-01-01',
  start: '2022-01-01T00:00:00',
  end: '2023-01-01T00:00:00',
  rebalance: 'monthly',
  top_n: 5,
  min_score: 50,
  min_market_cap: 10_000_000,
  min_volume: 250_000,
  weighting: 'equal',
  fill_with_btc: true,
  fee_pct: 0.1,
  rotation: 'hold',
  sell_score: 40,
  min_trend_30d: -25,
  stop_loss_pct: null,
  trailing_stop_pct: 50,
  take_profit_pct: 100,
  metrics: {
    total_return: 0.5,
    total_return_usd: 0.7,
    benchmark_btc_usd_return: 0.4,
    cagr: 0.2,
    volatility: 0.5,
    sharpe: 1.2,
    max_drawdown: -0.3,
    calmar: 0.66,
    win_rate: 0.6,
    avg_holdings: 5,
    avg_turnover: 0.4,
    periods: 12,
  },
  curve: [
    { date: '2022-01-01T00:00:00', equity: 1, period_return: 0, equity_usd: 1, benchmark_usd: 1 },
    { date: '2022-07-01T00:00:00', equity: 1.4, period_return: 0.4, equity_usd: 1.2, benchmark_usd: 0.9 },
    { date: '2023-01-01T00:00:00', equity: 1.5, period_return: 0.07, equity_usd: 1.7, benchmark_usd: 1.4 },
  ],
  holdings: [
    {
      date: '2022-01-01T00:00:00',
      picks: [{ symbol: 'ETHBTC', score: 90, weight: 0.5, period_return: 0.1 }],
    },
  ],
  optimization: [
    {
      rotation: 'hold',
      top_n: 3,
      min_score: 40,
      fill_with_btc: true,
      total_return: 0.9,
      sharpe: 1.5,
      max_drawdown: -0.2,
    },
  ],
};

describe('BacktestPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs a backtest on mount and renders metrics, curve and picks', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);

    expect(screen.getByRole('status')).toBeTruthy();

    expect(await screen.findByText('Win rate')).toBeTruthy();
    expect(screen.getByText(/total return \(btc\)/i)).toBeTruthy();
    expect(screen.getByText('Best configurations (by Sharpe)')).toBeTruthy();
    expect(screen.getByText('ETH')).toBeTruthy();
    expect(screen.getByRole('img', { name: /backtest equity curve in btc/i })).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/backtest?'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('switches the chart to USD', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByRole('button', { name: 'USD' }));

    expect(screen.getByRole('img', { name: /backtest equity curve in usd/i })).toBeTruthy();
  });

  it('applies an optimized configuration and re-runs', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Best configurations (by Sharpe)');

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(/top_n=3.*min_score=40/),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });

  it('sends the exit rule and sell threshold when they change', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.change(screen.getByLabelText('Exit rule'), { target: { value: 'rebalance' } });
    fireEvent.change(screen.getByLabelText(/sell when score/i), { target: { value: '55' } });
    fireEvent.change(screen.getByLabelText(/take profit/i), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(/rotation=rebalance.*sell_score=55.*take_profit_pct=200/),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });

  it('shows backend validation errors with a retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not enough history for this frequency' }), { status: 422 }),
    );

    render(<BacktestPage />);

    expect(await screen.findByText('Not enough history for this frequency')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});
