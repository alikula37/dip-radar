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
  equity_trend_exposure: null,
  profit_lock_pct: null,
  short_n: 0,
  short_max_score: null,
  short_funding_apr: 0,
  short_exposure: 1,
  profit_sweep_pct: 0,
  max_holding_periods: null,
  invert_score: false,
  ic_filter: false,
  ic_window: 6,
  ic_threshold: 0,
  ic_exposure: 0.35,
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
    avg_short_notional: 0,
    avg_long_notional: 1,
    funding_cost: 0,
    positive_ic_share: 0.55,
    positive_years: 0.6,
    positive_rolling_share: 0.55,
    time_in_drawdown: 0.7,
    best_period_share: 0.45,
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
    ...(index === 9 ? { in_btc: 'ic' } : {}),
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
      .mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByRole('button', { name: 'USD' }));

    expect(screen.getByRole('img', { name: /backtest equity curve in usd/i })).toBeTruthy();
  });

  it('applies the optimized preset found by the large search', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByRole('button', { name: 'Optimized' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(
          /top_n=5.*min_score=20.*min_market_cap=50000000.*weighting=score.*rotation=hold.*sell_score=3.*stop_loss_pct=30.*equity_trend_exposure=0.*profit_lock_pct=25.*short_n=5.*short_funding_apr=10.*short_exposure=1.*short_max_score=40.*profit_sweep_pct=30.*max_holding_periods=52.*invert_score=true.*ic_filter=true.*ic_window=2.*ic_threshold=0\.1.*ic_exposure=0.*score_model=rule.*regime_filter=breadth.*regime_exposure=0\.5.*regime_min_breadth=0\.5.*max_market_cap=1000000000/,
        ),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });

  it('applies the hedge preset (large-cap value spread, short-heavy)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByRole('button', { name: 'Hedge' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(
          /top_n=5.*min_score=20.*min_market_cap=500000000.*weighting=market_cap.*rotation=hold.*sell_score=5.*min_trend_30d=-25.*stop_loss_pct=30.*trailing_stop_pct=50.*equity_trend_exposure=0\.35.*profit_lock_pct=50.*short_n=5.*short_funding_apr=10.*short_exposure=1.*short_max_score=40.*ic_filter=true.*ic_window=12.*ic_threshold=0\.05.*ic_exposure=0.*score_model=rule.*regime_filter=breadth.*regime_exposure=0\.25.*regime_min_breadth=0\.5.*max_market_cap=10000000000/,
        ),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });

  it('reveals score model feature importance on demand', async () => {
    const models = [
      {
        version: 'rule',
        label: 'Rule-based value score',
        experimental: false,
        trained_until: null,
        validation: null,
        features: [
          { name: 'valuation', label: 'Valuation blend', description: 'Blend of the price percentiles.', weight: 0.3, direction: -1 },
        ],
      },
      {
        version: 'learned_v4',
        label: 'Learned score (learned_v4)',
        experimental: true,
        trained_until: '2024-12-31',
        validation: { walk_forward_ic: 0.17 },
        features: [
          { name: 'band_p05_dist_3y', label: 'Distance to 3y P05', description: 'Dip distance in BTC terms.', weight: 0.011, direction: -1 },
        ],
      },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/score-models')) {
        return new Response(JSON.stringify(models), { status: 200 });
      }
      return new Response(JSON.stringify(response), { status: 200 });
    });

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByText('Feature importance'));

    expect(await screen.findByText('Valuation blend')).toBeTruthy();
    expect(screen.getByText('Blend of the price percentiles.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/score model/i), { target: { value: 'learned_v4' } });
    expect(await screen.findByText('Distance to 3y P05')).toBeTruthy();
    expect(screen.getAllByText(/trained through 2024-12-31/).length).toBeGreaterThan(0);
  });

  it('sends the exit rule and sell threshold when they change', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.change(screen.getByLabelText(/exit rule/i), { target: { value: 'rebalance' } });
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
      .mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.change(screen.getByLabelText(/regime filter/i), { target: { value: 'breadth' } });
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
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/api/score-models')) {
        return new Response(
          JSON.stringify([
            { version: 'rule', label: 'Rule-based value score', experimental: false, trained_until: null, validation: null, features: [] },
            { version: 'learned_v4', label: 'Learned score (learned_v4)', experimental: true, trained_until: '2024-12-31', validation: null, features: [] },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(response), { status: 200 });
    });

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.change(screen.getByLabelText(/score model/i), { target: { value: 'learned_v4' } });

    expect(screen.getByText(/experimental score/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Run backtest' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(/score_model=learned_v4/),
        expect.objectContaining({ cache: 'no-store' }),
      );
    });
  });

  it('fetches live signals and lists watched strategies', async () => {
    const signalsPayload = {
      as_of: '2026-09-16T00:00:00',
      anchor: '2026-09-14T00:00:00',
      next_anchor: '2026-09-21T00:00:00',
      rebalance: 'weekly',
      start: '2022-01-01T00:00:00',
      score_model: 'rule',
      state: {
        equity: 1.5,
        long_notional: 0.5,
        short_notional: 0.25,
        in_btc: null,
        tracked: [],
        risk_on: true,
        ic_risk_on: true,
        rolling_ic: 0.12,
        equity_brake: false,
      },
      positions: [
        {
          symbol: 'BCHUSDT',
          direction: 'long',
          score: 100,
          weight: 0.5,
          entry_date: '2026-09-07',
          entry_price: 0.002,
          price_now: 0.0024,
          pnl_pct: 0.2,
          peak: 0.0024,
          sweep: 1,
          periods_held: 1,
          stop_price: 0.0014,
          trailing_stop_price: null,
          take_profit_price: null,
          action: 'HOLD',
          reason: null,
          trigger_date: null,
          trigger_price: null,
        },
      ],
      candidates: [{ symbol: 'ETHUSDT', score: 95, direction: 'long' }],
      message: 'The book is live as of the 2026-09-14 anchor.',
    };
    const watchesPayload = [
      {
        id: 7,
        name: 'Hedge',
        active: true,
        start: '2022-01-01',
        end: null,
        rebalance: 'weekly',
        score_model: 'rule',
        start_equity: 1,
        last_equity: 1.2,
        paper_return: 0.2,
        last_anchor: '2026-09-14T00:00:00',
        last_refreshed_at: '2026-09-16T00:00:00',
      },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/strategy/signals?')) {
        return new Response(JSON.stringify(signalsPayload), { status: 200 });
      }
      if (url.includes('/api/strategy/watches')) {
        return new Response(JSON.stringify(watchesPayload), { status: 200 });
      }
      return new Response(JSON.stringify(response), { status: 200 });
    });

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByRole('button', { name: /get signals/i }));

    expect(await screen.findByText('BCH')).toBeTruthy();
    expect(screen.getByText(/next-anchor watchlist/i)).toBeTruthy();
    expect(screen.getByText('Hedge · weekly · rule')).toBeTruthy();
    expect(screen.getByText(/paper \+20\.00%/)).toBeTruthy();
  });

  it('explains flat periods as sitting in BTC', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    expect(screen.getByText('In BTC · factor IC weak')).toBeTruthy();
  });

  it('expands the rebalance history on demand', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

    render(<BacktestPage />);
    await screen.findByText(/showing 8 of 10/);

    fireEvent.click(screen.getByRole('button', { name: /show all 10 rebalances/i }));

    expect(await screen.findByText(/showing 10 of 10/)).toBeTruthy();
  });

  it('reveals the trade log with buy and sell prices when opened', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));

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
      cv_folds: 3,
      strictness: 'strict',
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
          passed: true,
          reason: null,
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

    // One click moves every parameter into the search scope.
    fireEvent.click(screen.getByRole('button', { name: 'Optimize all' }));

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
    expect(body.optimize_params).toEqual(expect.arrayContaining(['take_profit_pct', 'short_n', 'profit_sweep_pct', 'ic_filter']));
    expect(Object.keys(body.fixed_params)).toHaveLength(0);
    expect(body.cv_folds).toBe(3);
    expect(body.strictness).toBe('strict');

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

  it('shows the table with warnings when no candidate passes validation', async () => {
    const flaggedOptimizer: OptimizerResponse = {
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
      cv_folds: 3,
      strictness: 'strict',
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
      best: [
        {
          params: { top_n: 4, min_score: 45, sell_score: 30, min_trend_30d: -25, weighting: 'score', rotation: 'hold', regime_filter: 'alt_trend', regime_exposure: 0.35, trailing_stop_pct: null, take_profit_pct: null },
          train_metrics: response.metrics,
          cv_metrics: { mean: 0.42, min: 0.1, per_fold: [] },
          holdout_metrics: response.metrics,
          passed: false,
          reason: 'holdout loses money',
        },
      ],
      rejected: { count: 16, reasons: { 'holdout loses money': 16 } },
      gap_fraction: 0.5,
      optimize_params: ['top_n', 'min_score'],
      fixed_params: { trailing_stop_pct: null },
      message: 'No configuration passed validation with the current strictness.',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/backtest/optimize')) {
        return Promise.resolve(new Response(JSON.stringify(flaggedOptimizer), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });

    render(<BacktestPage />);
    await screen.findByText('Win rate');

    fireEvent.click(screen.getByRole('button', { name: /auto-optimize/i }));
    fireEvent.click(screen.getByRole('button', { name: /find best parameters/i }));

    expect(await screen.findByText('holdout loses money')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /CV \(walk-forward\)/ })).toBeTruthy();
    expect(screen.getByText('top 4')).toBeTruthy();
  });

  it('shows only the message when there are no candidates at all', async () => {
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
      cv_folds: 3,
      strictness: 'strict',
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ detail: 'Not enough history for this frequency' }), { status: 422 }),
    );

    render(<BacktestPage />);

    expect(await screen.findByText('Not enough history for this frequency')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});
