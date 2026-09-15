import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BacktestPage from './page';
import type { BacktestResponse, OptimizerResponse } from '@/types';

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
  score_model: 'rule',
  regime_filter: null,
  regime_min_breadth: 0.5,
  regime_exposure: 0,
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
  holdings: Array.from({ length: 10 }, (_, index) => ({
    date: `2022-${String(index + 1).padStart(2, '0')}-01T00:00:00`,
    picks: [{ symbol: 'ETHBTC', score: 90 - index, weight: 0.5, period_return: 0.1 }],
  })),
  trades: [
    {
      symbol: 'ETHBTC',
      entry_date: '2022-01-01T00:00:00',
      entry_price: 0.05,
      entry_score: 90,
      exit_date: '2022-02-01T00:00:00',
      exit_price: 0.075,
      exit_reason: 'take_profit',
      return_pct: 0.5,
      days: 31,
    },
    {
      symbol: 'BNBBTC',
      entry_date: '2022-02-01T00:00:00',
      entry_price: 0.01,
      entry_score: 72,
      exit_date: '2022-03-01T00:00:00',
      exit_price: 0.009,
      exit_reason: 'stop_loss',
      return_pct: -0.1,
      days: 28,
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
    expect(screen.getAllByText('ETH').length).toBeGreaterThan(0);
    expect(screen.getByText(/showing 8 of 10/)).toBeTruthy();
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

  it('sends the regime filter, exposure and breadth threshold', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.change(screen.getByLabelText('Regime filter'), { target: { value: 'breadth' } });
    fireEvent.change(screen.getByLabelText(/min breadth/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(/regime_filter=breadth.*regime_exposure=0\.35.*regime_min_breadth=0\.6/),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });

  it('can compare the experimental learned score model', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.change(screen.getByLabelText('Score model'), { target: { value: 'learned_v1' } });

    expect(screen.getByText(/experimental score/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(/score_model=learned_v1/),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });

  it('expands the rebalance history on demand', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText(/showing 8 of 10/);

    fireEvent.click(screen.getByRole('button', { name: /show all 10 rebalances/i }));

    expect(await screen.findByText(/showing 10 of 10/)).toBeTruthy();
  });

  it('reveals the trade log with buy and sell prices when opened', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Trade log (2)');

    const toggle = screen.getByRole('button', { name: /trade log \(2\)/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('Bought')).toBeTruthy();
    expect(screen.getByText('Sold')).toBeTruthy();
    expect(screen.getByText('0.050000 BTC')).toBeTruthy();
    expect(screen.getByText('0.075000 BTC')).toBeTruthy();
    expect(screen.getByText('take profit')).toBeTruthy();
    expect(screen.getByText('stop loss')).toBeTruthy();
  });


  it('runs the auto-optimizer and can apply a candidate', async () => {
    const optimizerResponse: OptimizerResponse = {
      optimizer: 'optuna-tpe',
      objective: 'sharpe',
      trials: 50,
      evaluated: 42,
      max_drawdown_limit: null,
      rebalance: 'weekly',
      score_model: 'rule',
      min_market_cap: 10_000_000,
      min_volume: 250_000,
      fee_pct: 0.1,
      validation_fraction: 0.3,
      train: { start: '2022-01-01T00:00:00', end: '2025-01-01T00:00:00' },
      holdout: { start: '2025-01-01T00:00:00', end: '2026-09-01T00:00:00' },
      cv: {
        folds: [{ train: ['2022-01-01T00:00:00', '2024-01-01T00:00:00'], test: ['2024-02-01T00:00:00', '2024-12-01T00:00:00'] }],
        horizon_anchors: 1,
        embargo_anchors: 1,
        folds_requested: 3,
        candidates_scored: 16,
      },
      best: [
        {
          params: {
            top_n: 4,
            min_score: 45,
            sell_score: 30,
            min_trend_30d: -25,
            weighting: 'score',
            rotation: 'hold',
            regime_filter: 'alt_trend',
            regime_exposure: 0.35,
            trailing_stop_pct: null,
            take_profit_pct: null,
            // stop_loss_pct deliberately omitted: the Apply mapping must not emit NaN
          },
          train_metrics: response.metrics,
          cv_metrics: { mean: 0.42, min: 0.1, per_fold: [] },
          holdout_metrics: response.metrics,
        },
      ],
      validated: 1,
      rejected: { count: 3, reasons: { 'holdout not positive': 3 } },
      gap_fraction: 0.5,
      optimize_params: ['top_n', 'min_score'],
      fixed_params: { trailing_stop_pct: null, take_profit_pct: null, stop_loss_pct: null },
      message: null,
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/backtest/optimize')) {
        return Promise.resolve(new Response(JSON.stringify(optimizerResponse), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByRole('button', { name: /auto-optimize/i }));
    expect(screen.getByRole('dialog', { name: 'Auto-optimize' })).toBeTruthy();

    // Move a fixed parameter into the search scope with its "+" button.
    fireEvent.click(screen.getByRole('button', { name: 'Optimize take_profit_pct' }));

    fireEvent.click(screen.getByRole('button', { name: /find best parameters/i }));

    expect(await screen.findByText(/optuna-tpe · 42\/50/)).toBeTruthy();
    expect(screen.getByText('top 4')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /CV \(walk-forward\)/ })).toBeTruthy();

    const optimizerCall = fetchSpy.mock.calls.find(([input]) => String(input).includes('/api/backtest/optimize')) as
      | [string, RequestInit]
      | undefined;
    expect(optimizerCall).toBeTruthy();
    expect(optimizerCall?.[1]?.method).toBe('POST');
    const body = JSON.parse(String(optimizerCall?.[1]?.body));
    expect(body.optimize_params).toContain('take_profit_pct');
    expect(body.fixed_params).not.toHaveProperty('take_profit_pct');
    expect(body.cv_folds).toBe(3);

    // The auto-optimize panel renders before the results table, so its Apply is first.
    const applyButtons = screen.getAllByRole('button', { name: /apply/i });
    fireEvent.click(applyButtons[0]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(/top_n=4.*min_score=45/),
        expect.objectContaining({ cache: 'no-store' }),
      );
      expect(String(fetchSpy.mock.calls.at(-1)?.[0])).not.toContain('NaN');
    });
  });

  it('shows only the message when no candidate passes validation', async () => {
    const emptyOptimizer: OptimizerResponse = {
      optimizer: 'optuna-tpe',
      objective: 'sharpe',
      trials: 50,
      evaluated: 42,
      max_drawdown_limit: null,
      rebalance: 'weekly',
      score_model: 'rule',
      min_market_cap: 10_000_000,
      min_volume: 250_000,
      fee_pct: 0.1,
      validation_fraction: 0.3,
      train: { start: '2022-01-01T00:00:00', end: '2025-01-01T00:00:00' },
      holdout: { start: '2025-01-01T00:00:00', end: '2026-09-01T00:00:00' },
      cv: {
        folds: [{ train: ['2022-01-01T00:00:00', '2024-01-01T00:00:00'], test: ['2024-02-01T00:00:00', '2024-12-01T00:00:00'] }],
        horizon_anchors: 1,
        embargo_anchors: 1,
        folds_requested: 3,
        candidates_scored: 16,
      },
      validated: 0,
      best: [],
      rejected: { count: 16, reasons: { 'CV mean not positive': 16 } },
      gap_fraction: 0.5,
      optimize_params: ['top_n', 'min_score'],
      fixed_params: { trailing_stop_pct: null },
      message: 'No configuration passed validation on the untouched holdout.',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/backtest/optimize')) {
        return Promise.resolve(new Response(JSON.stringify(emptyOptimizer), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByRole('button', { name: /auto-optimize/i }));
    fireEvent.click(screen.getByRole('button', { name: /find best parameters/i }));

    expect(await screen.findByText(/No configuration passed validation/)).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /CV \(walk-forward\)/ })).toBeNull();
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
