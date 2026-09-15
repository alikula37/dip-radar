'use client';

import { Activity, ChevronDown, ChevronUp, Download, FlaskConical, Play, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import EquityChart from '@/components/EquityChart';
import { Button, RadarLoader, Segmented, StatCard, cn } from '@/components/ui';
import { formatBtcValue, formatPct } from '@/lib/colors';
import type { BacktestForm, BacktestMetrics, BacktestResponse, OptimizerCandidate, OptimizerResponse } from '@/types';

type Rebalance = 'weekly' | 'monthly' | 'quarterly';
type Weighting = 'equal' | 'score' | 'market_cap';

const DEFAULT_FORM: BacktestForm = {
  start: '2022-01-01',
  end: '',
  rebalance: 'weekly',
  topN: 3,
  minScore: 50,
  minCap: 10_000_000,
  minVolume: 250_000,
  weighting: 'score',
  fillWithBtc: true,
  feePct: 0.1,
  rotation: 'hold',
  sellScore: 25,
  minTrend: -25,
  stopLoss: null,
  trailingStop: null,
  takeProfit: null,
  scoreModel: 'rule',
  regimeFilter: 'alt_trend',
  regimeMinBreadth: 50,
  regimeExposure: 35,
  equityTrendExposure: null,
  profitLock: null,
  shortN: 3,
  shortMaxScore: 40,
  shortFundingApr: 10,
  shortExposure: 25,
  profitSweep: 50,
  maxHolding: null,
};

const PRESETS: { key: string; label: string; values: Partial<BacktestForm> }[] = [
  {
    key: 'conservative',
    label: 'Conservative',
    values: {
      rebalance: 'quarterly',
      topN: 3,
      minScore: 60,
      weighting: 'equal',
      fillWithBtc: true,
      rotation: 'hold',
      sellScore: 40,
      minTrend: 10,
      stopLoss: null,
      trailingStop: 75,
      takeProfit: 100,
      scoreModel: 'rule',
      regimeFilter: 'none',
      regimeExposure: 35,
      equityTrendExposure: null,
      profitLock: null,
      shortN: 0,
      shortMaxScore: null,
      shortFundingApr: 10,
      shortExposure: 25,
      profitSweep: 0,
      maxHolding: null,
    },
  },
  {
    key: 'balanced',
    label: 'Balanced',
    values: {
      rebalance: 'weekly',
      topN: 3,
      minScore: 50,
      weighting: 'score',
      fillWithBtc: true,
      rotation: 'hold',
      sellScore: 25,
      minTrend: -25,
      stopLoss: null,
      trailingStop: null,
      takeProfit: null,
      scoreModel: 'rule',
      regimeFilter: 'alt_trend',
      regimeExposure: 35,
      equityTrendExposure: null,
      profitLock: null,
      shortN: 3,
      shortMaxScore: 40,
      shortFundingApr: 10,
      shortExposure: 25,
      profitSweep: 50,
      maxHolding: null,
    },
  },
  {
    key: 'aggressive',
    label: 'Aggressive',
    values: {
      rebalance: 'weekly',
      topN: 2,
      minScore: 50,
      weighting: 'score',
      fillWithBtc: true,
      rotation: 'hold',
      sellScore: 25,
      minTrend: -25,
      stopLoss: null,
      trailingStop: null,
      takeProfit: null,
      scoreModel: 'rule',
      regimeFilter: 'alt_trend',
      regimeExposure: 35,
      equityTrendExposure: null,
      profitLock: null,
      shortN: 3,
      shortMaxScore: 40,
      shortFundingApr: 10,
      shortExposure: 50,
      profitSweep: 30,
      maxHolding: null,
    },
  },
];

const PARAM_SPECS: Record<
  string,
  { label: string; kind: 'int' | 'categorical'; choices?: (string | number | null)[] }
> = {
  top_n: { label: 'Top N', kind: 'int' },
  min_score: { label: 'Min score', kind: 'int' },
  sell_score: { label: 'Sell score', kind: 'categorical', choices: [null, 20, 25, 30, 40, 50, 60] },
  min_trend_30d: { label: 'Min 30d trend', kind: 'categorical', choices: [null, -60, -40, -25, 0] },
  weighting: { label: 'Weighting', kind: 'categorical', choices: ['equal', 'score', 'market_cap'] },
  rotation: { label: 'Exit rule', kind: 'categorical', choices: ['hold', 'rebalance'] },
  regime_filter: { label: 'Regime filter', kind: 'categorical', choices: [null, 'alt_trend', 'breadth'] },
  regime_exposure: { label: 'Risk-off exposure', kind: 'categorical', choices: [0, 0.25, 0.35, 0.5, 0.75, 1] },
  trailing_stop_pct: { label: 'Trailing stop', kind: 'categorical', choices: [null, 35, 50, 75] },
  take_profit_pct: { label: 'Take profit', kind: 'categorical', choices: [null, 100, 200, 500] },
  stop_loss_pct: { label: 'Stop loss', kind: 'categorical', choices: [null, 30, 40, 50] },
  equity_trend_exposure: { label: 'Equity-trend exposure', kind: 'categorical', choices: [null, 0, 0.35, 0.5, 0.7] },
  profit_lock_pct: { label: 'Profit lock', kind: 'categorical', choices: [null, 25, 50] },
  short_n: { label: 'Short N', kind: 'categorical', choices: [0, 2, 3, 5] },
  short_max_score: { label: 'Max short score', kind: 'categorical', choices: [null, 30, 40, 50] },
  short_funding_apr: { label: 'Short funding APR', kind: 'categorical', choices: [0, 10, 20] },
  short_exposure: { label: 'Short exposure', kind: 'categorical', choices: [0, 0.25, 0.5, 1] },
  profit_sweep_pct: { label: 'Profit sweep', kind: 'categorical', choices: [0, 30, 50, 70] },
  max_holding_periods: { label: 'Max holding', kind: 'categorical', choices: [null, 26, 52, 104] },
};

const DEFAULT_SEARCH_PARAMS = [
  'top_n',
  'min_score',
  'sell_score',
  'min_trend_30d',
  'weighting',
  'rotation',
  'regime_filter',
  'regime_exposure',
];

const DEFAULT_PINNED_VALUES: Record<string, string | number | boolean | null> = {
  trailing_stop_pct: null,
  take_profit_pct: null,
  stop_loss_pct: null,
  equity_trend_exposure: null,
  profit_lock_pct: null,
  short_n: 0,
  short_max_score: null,
  short_funding_apr: 0,
  short_exposure: 1,
  profit_sweep_pct: 0,
  max_holding_periods: null,
};

function paramLabel(value: string | number | null): string {
  if (value === null) return 'off';
  if (typeof value === 'number') return String(value);
  return value;
}

const MIN_CAP_OPTIONS = [
  { value: 0, label: 'Any market cap' },
  { value: 10_000_000, label: '≥ $10M market cap' },
  { value: 50_000_000, label: '≥ $50M market cap' },
  { value: 100_000_000, label: '≥ $100M market cap' },
  { value: 500_000_000, label: '≥ $500M market cap' },
];

const MIN_VOLUME_OPTIONS = [
  { value: 0, label: 'Any volume' },
  { value: 250_000, label: '≥ $250K volume' },
  { value: 1_000_000, label: '≥ $1M volume' },
  { value: 10_000_000, label: '≥ $10M volume' },
];

async function requestBacktest(form: BacktestForm): Promise<BacktestResponse> {
  const query = new URLSearchParams({
    start: form.start,
    rebalance: form.rebalance,
    top_n: String(form.topN),
    min_score: String(form.minScore),
    min_market_cap: String(form.minCap),
    min_volume: String(form.minVolume),
    weighting: form.weighting,
    fill_with_btc: String(form.fillWithBtc),
    fee_pct: String(form.feePct),
    rotation: form.rotation,
    sell_score: String(form.sellScore),
  });
  if (form.minTrend !== null) query.set('min_trend_30d', String(form.minTrend));
  if (form.stopLoss !== null) query.set('stop_loss_pct', String(form.stopLoss));
  if (form.trailingStop !== null) query.set('trailing_stop_pct', String(form.trailingStop));
  if (form.takeProfit !== null) query.set('take_profit_pct', String(form.takeProfit));
  if (form.equityTrendExposure !== null) query.set('equity_trend_exposure', String(form.equityTrendExposure / 100));
  if (form.profitLock !== null) query.set('profit_lock_pct', String(form.profitLock));
  if (form.shortN > 0) {
    query.set('short_n', String(form.shortN));
    query.set('short_funding_apr', String(form.shortFundingApr));
    query.set('short_exposure', String(form.shortExposure / 100));
    if (form.shortMaxScore !== null) query.set('short_max_score', String(form.shortMaxScore));
  }
  if (form.profitSweep > 0) query.set('profit_sweep_pct', String(form.profitSweep));
  if (form.maxHolding !== null) query.set('max_holding_periods', String(form.maxHolding));
  query.set('score_model', form.scoreModel);
  if (form.regimeFilter !== 'none') {
    query.set('regime_filter', form.regimeFilter);
    query.set('regime_exposure', String(form.regimeExposure / 100));
    if (form.regimeFilter === 'breadth') query.set('regime_min_breadth', String(form.regimeMinBreadth / 100));
  }
  if (form.end) query.set('end', form.end);

  const response = await fetch(`/api/backtest?${query.toString()}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail ?? `Backtest failed (HTTP ${response.status})`);
  }
  return payload as BacktestResponse;
}

async function requestOptimizer(
  form: BacktestForm,
  options: {
    objective: string;
    trials: number;
    maxDrawdownLimit: number | null;
    validationFraction: number;
    cvFolds: number;
    strictness: string;
    optimizeParams: string[];
    fixedParams: Record<string, string | number | boolean | null>;
  },
): Promise<OptimizerResponse> {
  const response = await fetch('/api/backtest/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      start: form.start,
      end: form.end || undefined,
      rebalance: form.rebalance,
      min_market_cap: form.minCap,
      min_volume: form.minVolume,
      fee_pct: form.feePct,
      fill_with_btc: form.fillWithBtc,
      score_model: form.scoreModel,
      objective: options.objective,
      trials: options.trials,
      max_drawdown_limit: options.maxDrawdownLimit,
      validation_fraction: options.validationFraction / 100,
      cv_folds: options.cvFolds,
      strictness: options.strictness,
      optimize_params: options.optimizeParams,
      fixed_params: options.fixedParams,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail ?? `Optimizer failed (HTTP ${response.status})`);
  }
  return payload as OptimizerResponse;
}

function downloadCurveCsv(result: BacktestResponse): void {
  const header = 'date,equity,equity_usd,benchmark_usd,period_return';
  const rows = result.curve.map((point) =>
    [
      point.date.slice(0, 10),
      point.equity.toFixed(6),
      point.equity_usd?.toFixed(6) ?? '',
      point.benchmark_usd?.toFixed(6) ?? '',
      point.period_return.toFixed(6),
    ].join(','),
  );
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dip-radar-backtest-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


function compactPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(0)}%`;
}

function metricsText(metrics: BacktestMetrics): string {
  return `ret ${compactPct(metrics.total_return)} · sh ${metrics.sharpe.toFixed(2)} · dd ${compactPct(metrics.max_drawdown)}`;
}

function weightedReturn(picks: BacktestResponse['holdings'][number]['picks']): number {
  return picks.reduce((total, pick) => total + pick.weight * pick.period_return, 0);
}

const EXIT_REASON_LABELS: Record<string, string> = {
  take_profit: 'take profit',
  trailing_stop: 'trailing stop',
  stop_loss: 'stop loss',
  score: 'score faded',
  rebalance: 'rotated out',
  missing: 'no data',
  open: 'open',
};

const EXIT_REASON_CLASSES: Record<string, string> = {
  take_profit: 'bg-[#4ade80]/15 text-[#4ade80]',
  trailing_stop: 'bg-[#f87171]/15 text-[#f87171]',
  stop_loss: 'bg-[#f87171]/15 text-[#f87171]',
  score: 'bg-primary/15 text-primary',
  rebalance: 'bg-surface-3 text-content-muted',
  missing: 'bg-surface-3 text-content-muted',
  open: 'bg-[#54d7ee]/15 text-[#54d7ee]',
};

export default function BacktestPage() {
  const [form, setForm] = useState<BacktestForm>(DEFAULT_FORM);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<'btc' | 'usd'>('btc');
  const [showAllRebalances, setShowAllRebalances] = useState(false);
  const [tradesOpen, setTradesOpen] = useState(false);
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<OptimizerResponse | null>(null);
  const [searchParams, setSearchParams] = useState<string[]>(DEFAULT_SEARCH_PARAMS);
  const [pinnedValues, setPinnedValues] = useState<Record<string, string | number | boolean | null>>({
    ...DEFAULT_PINNED_VALUES,
  });
  const [objective, setObjective] = useState<'sharpe' | 'return' | 'calmar' | 'consistency'>('sharpe');
  const [trials, setTrials] = useState(60);
  const [maxDrawdownLimit, setMaxDrawdownLimit] = useState<number | null>(null);
  const [validationFraction, setValidationFraction] = useState(30);
  const [cvFolds, setCvFolds] = useState(3);
  const [strictness, setStrictness] = useState<'strict' | 'balanced' | 'loose'>('strict');

  const runBacktest = useCallback(async (params: BacktestForm) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await requestBacktest(params);
      setResult(payload);
      setShowAllRebalances(false);
      setShowAllTrades(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backtest failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  const runOptimizer = useCallback(async () => {
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const payload = await requestOptimizer(form, {
        objective,
        trials,
        maxDrawdownLimit,
        validationFraction,
        cvFolds,
        strictness,
        optimizeParams: searchParams,
        fixedParams: pinnedValues,
      });
      setOptimizeResult(payload);
    } catch (caught) {
      setOptimizeError(caught instanceof Error ? caught.message : 'Optimizer failed.');
    } finally {
      setOptimizing(false);
    }
  }, [form, objective, trials, maxDrawdownLimit, validationFraction, cvFolds, strictness, searchParams, pinnedValues]);

  const applyCandidate = (candidate: OptimizerCandidate) => {
    const params = candidate.params;
    const number = (value: unknown, fallback: number) => {
      const parsed = Number(value);
      return value === null || value === undefined || Number.isNaN(parsed) ? fallback : parsed;
    };
    const optional = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isNaN(parsed) ? null : parsed;
    };
    const next: BacktestForm = {
      ...form,
      topN: number(params.top_n, form.topN),
      minScore: number(params.min_score, form.minScore),
      sellScore:
        params.sell_score === null || params.sell_score === undefined
          ? number(params.min_score, form.minScore)
          : number(params.sell_score, form.sellScore),
      minTrend: optional(params.min_trend_30d),
      weighting: (params.weighting ?? form.weighting) as BacktestForm['weighting'],
      rotation: (params.rotation ?? form.rotation) as BacktestForm['rotation'],
      regimeFilter: (params.regime_filter ?? 'none') as BacktestForm['regimeFilter'],
      regimeExposure: Math.round(number(params.regime_exposure, form.regimeExposure / 100) * 100),
      trailingStop: optional(params.trailing_stop_pct),
      takeProfit: optional(params.take_profit_pct),
      stopLoss: optional(params.stop_loss_pct),
      equityTrendExposure:
        params.equity_trend_exposure === null || params.equity_trend_exposure === undefined
          ? null
          : Math.round(Number(params.equity_trend_exposure) * 100),
      profitLock: optional(params.profit_lock_pct),
      shortN: number(params.short_n, form.shortN),
      shortMaxScore: optional(params.short_max_score),
      shortFundingApr: number(params.short_funding_apr, form.shortFundingApr),
      shortExposure: Math.round(number(params.short_exposure, form.shortExposure / 100) * 100),
      profitSweep: number(params.profit_sweep_pct, form.profitSweep),
      maxHolding: optional(params.max_holding_periods),
    };
    setForm(next);
    void runBacktest(next);
  };

  useEffect(() => {
    if (!autoOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAutoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autoOpen]);

  useEffect(() => {
    // Defer so the loading state is not set synchronously inside the effect.
    const timer = window.setTimeout(() => void runBacktest(DEFAULT_FORM), 0);
    return () => window.clearTimeout(timer);
  }, [runBacktest]);

  const update = <Key extends keyof BacktestForm>(key: Key, value: BacktestForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const next = { ...form, ...preset.values };
    setForm(next);
    void runBacktest(next);
  };

  const activePreset = PRESETS.find((preset) =>
    Object.entries(preset.values).every(
      ([key, value]) => form[key as keyof BacktestForm] === value,
    ),
  )?.key;

  const addableParams = Object.keys(PARAM_SPECS).filter(
    (name) => !searchParams.includes(name) && !(name in pinnedValues),
  );
  const fixedParamNames = Object.keys(pinnedValues);

  const metrics = result?.metrics;
  const allPeriods = useMemo(() => (result ? [...result.holdings].reverse() : []), [result]);
  const periods = showAllRebalances ? allPeriods : allPeriods.slice(0, 8);
  const allTrades = useMemo(() => (result ? [...result.trades].reverse() : []), [result]);
  const visibleTrades = showAllTrades ? allTrades : allTrades.slice(0, 12);
  const tradeStats = useMemo(() => {
    const closed = allTrades.filter((trade) => trade.exit_reason !== 'open');
    const returns = closed.map((trade) => trade.return_pct);
    const wins = returns.filter((value) => value > 0).length;
    return {
      total: allTrades.length,
      open: allTrades.length - closed.length,
      winRate: closed.length > 0 ? wins / closed.length : 0,
      avg: returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0,
      best: returns.length > 0 ? Math.max(...returns) : 0,
      worst: returns.length > 0 ? Math.min(...returns) : 0,
    };
  }, [allTrades]);

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1200px] px-4 pb-12 pt-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-outline pb-4">
        <div className="flex items-center gap-3">
          <FlaskConical size={28} className="text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-primary">Strategy Lab</h1>
            <p className="text-xs text-content-muted">
              What if you had bought the historically cheapest coins and rebalanced?
            </p>
          </div>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-outline bg-surface-2 px-3 py-2 text-sm font-medium text-content transition-colors hover:border-outline-strong hover:bg-surface-3"
        >
          <Activity size={15} />
          Dashboard
        </Link>
      </header>

      <section className="mt-4 rounded-2xl border border-outline bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            ariaLabel="Strategy preset"
            value={activePreset ?? 'custom'}
            onChange={(value) => {
              const preset = PRESETS.find((entry) => entry.key === value);
              if (preset) applyPreset(preset);
            }}
            options={[...PRESETS.map((preset) => ({ value: preset.key, label: preset.label })), { value: 'custom', label: 'Custom' }]}
          />


          <Button
            variant="outline"
            onClick={() => setAutoOpen(true)}
            title="Optuna TPE search selected by purged walk-forward CV and reported on an unseen holdout"
          >
            <Sparkles size={15} />
            Auto-optimize
          </Button>
          <Button variant="primary" onClick={() => void runBacktest(form)} disabled={loading}>
            <Play size={15} />
            {loading ? 'Running…' : 'Run backtest'}
          </Button>

          {form.scoreModel !== 'rule' && (
            <span className="text-[11px] text-[#facc15]" title="Research artifact; rule-based score remains the default">
              Experimental score · trained through 2024-12-31 · did not pass the strategy gate
            </span>
          )}

          {result && !loading && (
            <span className="text-[11px] text-content-muted">
              {result.metrics.periods} rebalances · {result.start.slice(0, 10)} → {result.end.slice(0, 10)} ·{' '}
              {result.rebalance}
              {result.rotation === 'hold'
                ? ` · hold until score < ${result.sell_score ?? result.min_score}`
                : ' · reset to top N'}
              {result.score_model !== 'rule' ? ` · ${result.score_model} score` : ' · rule-based score'}
              {result.short_n > 0
                ? ` · short ${result.short_n} @ ${Math.round(result.short_exposure * 100)}% (funding ${result.short_funding_apr}%)`
                : ''}
              {result.regime_filter
                ? ` · risk-off: ${
                    result.regime_filter === 'alt_trend'
                      ? 'alt/BTC trend'
                      : `breadth < ${Math.round(result.regime_min_breadth * 100)}%`
                  } at ${Math.round(result.regime_exposure * 100)}% exposure`
                : ''}
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <label className="text-[11px] text-content-muted">
            Start
            <input
              type="date"
              value={form.start}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => update('start', event.target.value)}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            End (blank = latest)
            <input
              type="date"
              value={form.end}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => update('end', event.target.value)}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Rebalance
            <select
              value={form.rebalance}
              onChange={(event) => update('rebalance', event.target.value as Rebalance)}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </label>
          <label className="text-[11px] text-content-muted">
            Top N coins
            <input
              type="number"
              min={1}
              max={25}
              value={form.topN}
              onChange={(event) => update('topN', Math.min(25, Math.max(1, Number(event.target.value) || 1)))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Min Value Score
            <input
              type="number"
              min={0}
              max={100}
              value={form.minScore}
              onChange={(event) => update('minScore', Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Market cap filter
            <select
              value={form.minCap}
              onChange={(event) => update('minCap', Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            >
              {MIN_CAP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-content-muted">
            Volume filter
            <select
              value={form.minVolume}
              onChange={(event) => update('minVolume', Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            >
              {MIN_VOLUME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-content-muted">
            Weighting
            <select
              value={form.weighting}
              onChange={(event) => update('weighting', event.target.value as Weighting)}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            >
              <option value="equal">Equal weight</option>
              <option value="score">Score weighted</option>
              <option value="market_cap">Market cap weighted</option>
            </select>
          </label>
          <label className="text-[11px] text-content-muted">
            Score model
            <select
              value={form.scoreModel}
              onChange={(event) => update('scoreModel', event.target.value as BacktestForm['scoreModel'])}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            >
              <option value="rule">Rule-based (default)</option>
              <option value="learned_v1">Learned v1 (experimental)</option>
              <option value="learned_v2">Learned v2 (survivorship-fixed)</option>
              <option value="learned_v3_regime">Learned v3 (regime-trained)</option>
            </select>
          </label>
          <label className="text-[11px] text-content-muted">
            Regime filter
            <select
              value={form.regimeFilter}
              onChange={(event) => update('regimeFilter', event.target.value as BacktestForm['regimeFilter'])}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            >
              <option value="none">Off</option>
              <option value="alt_trend">Alt/BTC trend</option>
              <option value="breadth">Breadth (200d SMA)</option>
            </select>
          </label>
          {form.regimeFilter !== 'none' && (
            <label className="text-[11px] text-content-muted">
              Risk-off exposure (%)
              <input
                type="number"
                min={0}
                max={100}
                value={form.regimeExposure}
                onChange={(event) =>
                  update('regimeExposure', Math.min(100, Math.max(0, Number(event.target.value) || 0)))
                }
                className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
              />
            </label>
          )}
          <label className="text-[11px] text-content-muted">
            Equity-trend exposure (%, blank = off)
            <input
              type="number"
              min={0}
              max={100}
              placeholder="off"
              value={form.equityTrendExposure ?? ''}
              onChange={(event) =>
                update('equityTrendExposure', event.target.value === '' ? null : Math.min(100, Math.max(0, Number(event.target.value))))
              }
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Profit lock (%, blank = off)
            <input
              type="number"
              min={0}
              max={95}
              placeholder="off"
              value={form.profitLock ?? ''}
              onChange={(event) =>
                update('profitLock', event.target.value === '' ? null : Math.min(95, Math.max(0, Number(event.target.value))))
              }
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Short N (market-neutral sleeve)
            <input
              type="number"
              min={0}
              max={25}
              value={form.shortN}
              onChange={(event) => update('shortN', Math.min(25, Math.max(0, Number(event.target.value) || 0)))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          {form.shortN > 0 && (
            <>
              <label className="text-[11px] text-content-muted">
                Max short score (blank = any)
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="any"
                  value={form.shortMaxScore ?? ''}
                  onChange={(event) =>
                    update('shortMaxScore', event.target.value === '' ? null : Math.min(100, Math.max(0, Number(event.target.value))))
                  }
                  className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
                />
              </label>
              <label className="text-[11px] text-content-muted">
                Short funding APR (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.shortFundingApr}
                  onChange={(event) => update('shortFundingApr', Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                  className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
                />
              </label>
              <label className="text-[11px] text-content-muted">
                Short exposure (% of long book)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.shortExposure}
                  onChange={(event) => update('shortExposure', Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                  className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs font-medium text-content outline-none focus:border-primary"
                />
              </label>
            </>
          )}
          <label className="text-[11px] text-content-muted">
            Profit sweep (% of profit back to BTC)
            <input
              type="number"
              min={0}
              max={100}
              value={form.profitSweep}
              onChange={(event) => update('profitSweep', Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Max holding (rebalances, blank = off)
            <input
              type="number"
              min={1}
              max={500}
              placeholder="off"
              value={form.maxHolding ?? ''}
              onChange={(event) =>
                update('maxHolding', event.target.value === '' ? null : Math.min(500, Math.max(1, Number(event.target.value))))
              }
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          {form.regimeFilter === 'breadth' && (
            <label className="text-[11px] text-content-muted">
              Min breadth (%)
              <input
                type="number"
                min={0}
                max={100}
                value={form.regimeMinBreadth}
                onChange={(event) =>
                  update('regimeMinBreadth', Math.min(100, Math.max(0, Number(event.target.value) || 0)))
                }
                className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
              />
            </label>
          )}
          <label className="text-[11px] text-content-muted">
            Fee per trade (%)
            <input
              type="number"
              min={0}
              max={5}
              step={0.05}
              value={form.feePct}
              onChange={(event) => update('feePct', Math.min(5, Math.max(0, Number(event.target.value) || 0)))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Exit rule
            <select
              value={form.rotation}
              onChange={(event) => update('rotation', event.target.value as BacktestForm['rotation'])}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            >
              <option value="hold">Hold until score drops</option>
              <option value="rebalance">Reset to top N each period</option>
            </select>
          </label>
          <label className="text-[11px] text-content-muted">
            Sell when score &lt;
            <input
              type="number"
              min={0}
              max={100}
              value={form.sellScore}
              onChange={(event) => update('sellScore', Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Min 30d trend (%, blank = any)
            <input
              type="number"
              min={-100}
              max={100}
              placeholder="e.g. -25"
              value={form.minTrend ?? ''}
              onChange={(event) => update('minTrend', event.target.value === '' ? null : Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Stop loss (%, blank = off)
            <input
              type="number"
              min={0}
              max={95}
              placeholder="off"
              value={form.stopLoss ?? ''}
              onChange={(event) =>
                update('stopLoss', event.target.value === '' ? null : Math.min(95, Math.max(0, Number(event.target.value))))
              }
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Trailing stop (%, blank = off)
            <input
              type="number"
              min={0}
              max={95}
              placeholder="off"
              value={form.trailingStop ?? ''}
              onChange={(event) =>
                update(
                  'trailingStop',
                  event.target.value === '' ? null : Math.min(95, Math.max(0, Number(event.target.value))),
                )
              }
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Take profit (%, blank = off)
            <input
              type="number"
              min={0}
              max={10000}
              placeholder="off"
              value={form.takeProfit ?? ''}
              onChange={(event) =>
                update('takeProfit', event.target.value === '' ? null : Math.max(0, Number(event.target.value)))
              }
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            />
          </label>
          <label className="text-[11px] text-content-muted">
            Unfilled slots
            <select
              value={form.fillWithBtc ? 'btc' : 'cash'}
              onChange={(event) => update('fillWithBtc', event.target.value === 'btc')}
              className="mt-1 w-full rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
            >
              <option value="btc">Hold BTC (0% in BTC terms)</option>
              <option value="cash">Hold cash (0%)</option>
            </select>
          </label>
        </div>
      </section>

      {autoOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Auto-optimize"
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
          onClick={() => setAutoOpen(false)}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-outline bg-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-outline px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-content">Auto-optimize</h2>
                <p className="text-[11px] text-content-muted">
                  Search on the training window → selected by purged + embargoed walk-forward CV → reported on a
                  holdout the search never sees
                </p>
              </div>
              <button
                type="button"
                aria-label="Close auto-optimize"
                onClick={() => setAutoOpen(false)}
                className="rounded-full p-1 text-content-muted transition-colors hover:bg-surface-3 hover:text-content"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto px-4 py-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-[11px] text-content-muted">
                  Objective
                  <select
                    value={objective}
                    onChange={(event) => setObjective(event.target.value as typeof objective)}
                    className="mt-1 rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
                  >
                    <option value="sharpe">Sharpe</option>
                    <option value="return">Total return</option>
                    <option value="calmar">Calmar</option>
                    <option value="consistency">Consistency (rolling 1y positive)</option>
                  </select>
                </label>
                <label className="text-[11px] text-content-muted">
                  Trials
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    value={trials}
                    onChange={(event) => setTrials(Math.min(1000, Math.max(10, Number(event.target.value) || 10)))}
                    className="mt-1 w-24 rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
                  />
                </label>
                <label className="text-[11px] text-content-muted">
                  Max drawdown limit (%, blank = off)
                  <input
                    type="number"
                    min={0}
                    max={95}
                    value={maxDrawdownLimit ?? ''}
                    onChange={(event) => setMaxDrawdownLimit(event.target.value === '' ? null : Number(event.target.value))}
                    className="mt-1 w-28 rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
                  />
                </label>
                <label className="text-[11px] text-content-muted">
                  Strictness
                  <select
                    value={strictness}
                    onChange={(event) => setStrictness(event.target.value as typeof strictness)}
                    className="mt-1 rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
                  >
                    <option value="strict">Strict</option>
                    <option value="balanced">Balanced</option>
                    <option value="loose">Loose</option>
                  </select>
                </label>
                <label className="text-[11px] text-content-muted">
                  CV folds
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={cvFolds}
                    onChange={(event) => setCvFolds(Math.min(6, Math.max(1, Number(event.target.value) || 3)))}
                    className="mt-1 w-20 rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
                  />
                </label>
                <label className="text-[11px] text-content-muted">
                  Holdout (%)
                  <input
                    type="number"
                    min={10}
                    max={50}
                    value={validationFraction}
                    onChange={(event) => setValidationFraction(Math.min(50, Math.max(10, Number(event.target.value) || 30)))}
                    className="mt-1 w-20 rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
                  />
                </label>
                <Button
                  variant="primary"
                  onClick={() => void runOptimizer()}
                  disabled={optimizing || searchParams.length === 0}
                >
                  <Sparkles size={15} />
                  {optimizing ? 'Searching…' : 'Find best parameters'}
                </Button>
              </div>

              <div className="mt-3 rounded-xl border border-outline bg-surface-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-content-muted">Optimizing</span>
                  {searchParams.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 rounded-full border border-outline bg-surface px-2 py-0.5 text-[11px]"
                    >
                      {PARAM_SPECS[name].label}
                      <button
                        type="button"
                        aria-label={`Stop optimizing ${name}`}
                        onClick={() => {
                          const spec = PARAM_SPECS[name];
                          const fallback =
                            DEFAULT_PINNED_VALUES[name] ??
                            (spec.kind === 'int' ? 5 : spec.choices?.[0] ?? null);
                          setSearchParams((current) => current.filter((entry) => entry !== name));
                          setPinnedValues((current) => ({ ...current, [name]: fallback }));
                        }}
                        className="rounded-full p-0.5 text-content-muted transition-colors hover:text-content"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {addableParams.length > 0 && (
                    <select
                      value=""
                      aria-label="Add parameter to optimize"
                      onChange={(event) => {
                        const name = event.target.value;
                        if (!name) return;
                        setPinnedValues((current) => {
                          const next = { ...current };
                          delete next[name];
                          return next;
                        });
                        setSearchParams((current) => [...current, name]);
                      }}
                      className="rounded-full border border-dashed border-outline bg-transparent px-2 py-0.5 text-[11px] text-content-muted outline-none"
                    >
                      <option value="">+ Add parameter</option>
                      {addableParams.map((name) => (
                        <option key={name} value={name}>
                          {PARAM_SPECS[name].label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {fixedParamNames.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-content-muted">Fixed</span>
                    {fixedParamNames.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 rounded-full border border-outline bg-surface px-2 py-0.5 text-[11px]"
                      >
                        <span className="text-content-muted">{PARAM_SPECS[name].label}</span>
                        {PARAM_SPECS[name].kind === 'int' ? (
                          <input
                            type="number"
                            aria-label={`Fixed value for ${name}`}
                            value={Number(pinnedValues[name] ?? 5)}
                            onChange={(event) =>
                              setPinnedValues((current) => ({ ...current, [name]: Number(event.target.value) || 0 }))
                            }
                            className="w-14 bg-transparent text-content outline-none"
                          />
                        ) : (
                          <select
                            value={String(pinnedValues[name] ?? 'off')}
                            aria-label={`Fixed value for ${name}`}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const value = raw === 'off' ? null : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
                              setPinnedValues((current) => ({ ...current, [name]: value }));
                            }}
                            className="bg-transparent text-content outline-none"
                          >
                            {PARAM_SPECS[name].choices?.map((choice) => (
                              <option key={String(choice)} value={String(choice ?? 'off')}>
                                {paramLabel(choice)}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          aria-label={`Optimize ${name}`}
                          onClick={() => {
                            setPinnedValues((current) => {
                              const next = { ...current };
                              delete next[name];
                              return next;
                            });
                            setSearchParams((current) => [...current, name]);
                          }}
                          className="rounded-full p-0.5 text-content-muted transition-colors hover:text-content"
                        >
                          +
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-content-muted">
                  Added parameters are searched; everything under Fixed is pinned. The universe filters and dates from
                  the form are always fixed.
                </p>
              </div>

              <p className="mt-2 text-[11px] text-content-muted">
                Universe filters and dates from the form stay pinned. Candidates are ranked by CV mean (worst fold
                breaks ties), not by the search score.
              </p>

              {optimizeError && <p className="mt-3 text-xs text-[#f87171]">{optimizeError}</p>}

              {optimizeResult && (
                <>
                  <p className="mt-4 text-[11px] text-content-muted">
                    {optimizeResult.optimizer} · {optimizeResult.evaluated}/{optimizeResult.trials} unique configs ·
                    CV {optimizeResult.cv.folds.length} fold(s), purge horizon {optimizeResult.cv.horizon_anchors} /
                    embargo {optimizeResult.cv.embargo_anchors} anchors · train{' '}
                    {optimizeResult.train.start.slice(0, 10)} → {optimizeResult.train.end.slice(0, 10)} · holdout{' '}
                    {optimizeResult.holdout.start.slice(0, 10)} → {optimizeResult.holdout.end.slice(0, 10)}
                    {optimizeResult.max_drawdown_limit ? ` · max DD ≤ ${optimizeResult.max_drawdown_limit}%` : ''}
                    {` · strictness ${optimizeResult.strictness}`}
                  </p>
                  <p className="mt-1 text-[11px] text-content-muted">
                    Validated {optimizeResult.validated} · rejected {optimizeResult.rejected.count}
                    {Object.entries(optimizeResult.rejected.reasons).length > 0
                      ? ` (${Object.entries(optimizeResult.rejected.reasons)
                          .map(([reason, count]) => `${reason} ×${count}`)
                          .join(', ')})`
                      : ''}
                  </p>
                  {optimizeResult.message && (
                    <p className="mt-3 rounded-xl border border-[#f87171]/40 bg-[#f87171]/10 px-3 py-2 text-xs text-[#f87171]">
                      {optimizeResult.message}
                      {optimizeResult.strictness === 'strict'
                        ? ' Try the Balanced or Loose strictness, a longer date range or different filters.'
                        : ' Try a longer date range or different filters.'}
                    </p>
                  )}
                  {optimizeResult.best.length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[860px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-outline text-[11px] uppercase tracking-wide text-content-muted">
                          <th className="py-2 pr-3">Config</th>
                          <th className="py-2 pr-3">Train</th>
                          <th className="py-2 pr-3">CV (walk-forward)</th>
                          <th className="py-2 pr-3">Holdout</th>
                          <th className="py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {optimizeResult.best.map((candidate, index) => (
                          <tr key={index} className="border-b border-outline/50 align-top">
                            <td className="py-2 pr-3">
                              <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                                <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5">top {String(candidate.params.top_n)}</span>
                                <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5">score ≥ {String(candidate.params.min_score)}</span>
                                <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5">
                                  sell {candidate.params.sell_score === null ? '= buy' : String(candidate.params.sell_score)}
                                </span>
                                <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5">{String(candidate.params.rotation)}</span>
                                <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5">
                                  {candidate.params.regime_filter === null
                                    ? 'regime off'
                                    : `${String(candidate.params.regime_filter)}@${Math.round(Number(candidate.params.regime_exposure) * 100)}%`}
                                </span>
                                {candidate.params.trailing_stop_pct !== null && (
                                  <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5">trail {String(candidate.params.trailing_stop_pct)}%</span>
                                )}
                                {candidate.params.take_profit_pct !== null && (
                                  <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5">tp {String(candidate.params.take_profit_pct)}%</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 pr-3 font-mono text-[11px] text-content-muted">{metricsText(candidate.train_metrics)}</td>
                            <td className="py-2 pr-3 font-mono text-[11px] text-content-muted">
                              {candidate.cv_metrics
                                ? `mean ${candidate.cv_metrics.mean.toFixed(2)} · min ${candidate.cv_metrics.min.toFixed(2)} (${candidate.cv_metrics.per_fold.length})`
                                : '—'}
                            </td>
                            <td className="py-2 pr-3 font-mono text-[11px] text-content">
                              {candidate.holdout_metrics ? metricsText(candidate.holdout_metrics) : '—'}
                            </td>
                            <td className="py-2 text-right">
                              <Button variant="ghost" className="px-2 py-1 text-[11px]" onClick={() => applyCandidate(candidate)}>
                                Apply
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                  {optimizeResult.best.length > 0 && (
                  <p className="mt-2 text-[11px] text-content-muted">
                    The holdout column is the only untouched evidence. A positive CV that turns negative on the
                    holdout means the search overfit — stay with the presets in that case.
                  </p>
                  )}
                  {optimizeResult.best.length === 0 && optimizeResult.closest && (
                    <p className="mt-2 text-[11px] text-content-muted">
                      Closest attempt (rejected: {optimizeResult.closest.reason}) — train{' '}
                      {metricsText(optimizeResult.closest.train_metrics)} · CV{' '}
                      {optimizeResult.closest.cv_metrics
                        ? `mean ${optimizeResult.closest.cv_metrics.mean.toFixed(2)} / min ${optimizeResult.closest.cv_metrics.min.toFixed(2)}`
                        : '—'}{' '}
                      · holdout{' '}
                      {optimizeResult.closest.holdout_metrics
                        ? metricsText(optimizeResult.closest.holdout_metrics)
                        : '—'}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <section className="mt-4">
          <div className="flex h-[420px] flex-col items-center justify-center gap-4 rounded-2xl border border-outline bg-surface">
            <RadarLoader size="lg" label="Replaying Value Score history…" />
            <p className="max-w-md text-center text-xs text-content-muted">
              The first run rebuilds point-in-time scores for every rebalance date — up to ~30 s on the
              full universe. Later runs reuse the snapshot.
            </p>
          </div>
        </section>
      ) : error ? (
        <section className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-outline bg-surface px-6 py-16 text-center">
          <p className="text-sm text-content">{error}</p>
          <Button variant="primary" onClick={() => void runBacktest(form)}>
            Retry
          </Button>
        </section>
      ) : result && metrics ? (
        <>
          <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
            <StatCard
              label="Total return (BTC)"
              value={formatPct(metrics.total_return * 100)}
              hint={
                metrics.total_return_usd !== null
                  ? `USD: ${formatPct(metrics.total_return_usd * 100)} · BTC/USD: ${formatPct(
                      (metrics.benchmark_btc_usd_return ?? 0) * 100,
                    )}`
                  : undefined
              }
              accent={metrics.total_return > 0 ? 'positive' : undefined}
            />
            <StatCard label="CAGR" value={formatPct(metrics.cagr * 100)} hint="Annualized, BTC terms" />
            <StatCard label="Sharpe" value={metrics.sharpe.toFixed(2)} hint="Per-period returns, annualized" />
            <StatCard
              label="Max drawdown"
              value={formatPct(metrics.max_drawdown * 100)}
              hint={metrics.calmar !== null ? `Calmar ${metrics.calmar.toFixed(2)}` : undefined}
            />
            <StatCard label="Volatility" value={formatPct(metrics.volatility * 100)} hint="Annualized" />
            <StatCard
              label="Win rate"
              value={formatPct(metrics.win_rate * 100)}
              hint={`Avg holdings ${metrics.avg_holdings.toFixed(1)} · turnover ${formatPct(
                metrics.avg_turnover * 100,
              )}`}
            />
            <StatCard
              label="Consistency"
              value={`${((metrics.positive_years ?? 0) * 100).toFixed(0)}%`}
              hint={`positive years · ${((metrics.positive_rolling_share ?? 0) * 100).toFixed(0)}% of rolling 1y windows`}
            />
            <StatCard
              label="Time in drawdown"
              value={`${((metrics.time_in_drawdown ?? 0) * 100).toFixed(0)}%`}
              hint={`best 5% of periods made ${((metrics.best_period_share ?? 0) * 100).toFixed(0)}% of the gains`}
            />
          </section>

          <section className="mt-4 rounded-2xl border border-outline bg-surface p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-content">Equity curve</h2>
                <p className="text-[11px] text-content-muted">
                  Starting capital = ×1.00. Log scale. BTC buy &amp; hold is the benchmark.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => downloadCurveCsv(result)} title="Download the equity curve as CSV">
                  <Download size={15} />
                  CSV
                </Button>
                <Segmented
                  ariaLabel="Display currency"
                  value={displayMode}
                  onChange={setDisplayMode}
                  options={[
                    { value: 'btc', label: 'BTC' },
                    { value: 'usd', label: 'USD' },
                  ]}
                />
              </div>
            </div>
            <div className="mt-2">
              <EquityChart curve={result.curve} mode={displayMode} />
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-outline bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-content">Rebalances</h2>
              <span className="text-[11px] text-content-muted">
                showing {periods.length} of {allPeriods.length}
              </span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="border-b border-outline text-[11px] uppercase tracking-wide text-content-muted">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Picks (score, weight)</th>
                    <th className="py-2">Period return</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => {
                    const periodReturn = weightedReturn(period.picks);
                    return (
                      <tr key={period.date} className="border-b border-outline/50 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap font-mono">{period.date.slice(0, 10)}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            {period.picks.length === 0 && (
                              <span className={period.risk_on === false ? 'text-[#facc15]' : 'text-content-muted'}>
                                {period.risk_on === false ? 'Risk-off — BTC' : 'No candidates — BTC/cash'}
                              </span>
                            )}
                            {period.picks.map((pick) => (
                              <span
                                key={pick.symbol}
                                className="inline-flex items-center gap-1 rounded-full border border-outline bg-surface-2 px-2 py-0.5 font-mono text-[11px]"
                              >
                                <span className="text-content">{pick.symbol.replace(/(USDT|BTC)$/, '')}</span>
                                <span className="text-primary">{pick.score.toFixed(0)}</span>
                                <span className="text-content-muted">{(pick.weight * 100).toFixed(0)}%</span>
                                {pick.direction === 'short' && <span className="text-[#f87171]">short</span>}
                                {pick.exited && <span className="text-[#f87171]">stop</span>}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className={cn('py-2 font-mono', periodReturn >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]')}>
                          {formatPct(periodReturn * 100)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {allPeriods.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllRebalances((current) => !current)}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {showAllRebalances ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {showAllRebalances ? 'Show latest 8 rebalances' : `Show all ${allPeriods.length} rebalances`}
              </button>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-outline bg-surface">
            <button
              type="button"
              aria-expanded={tradesOpen}
              onClick={() => setTradesOpen((current) => !current)}
              className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div>
                <h2 className="text-sm font-semibold text-content">Trade log ({tradeStats.total})</h2>
                <p className="text-[11px] text-content-muted">
                  Where every position was bought and sold · {tradeStats.open} still open
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-content-muted">
                <span className="hidden sm:inline">
                  Win rate{' '}
                  <strong className={tradeStats.winRate >= 0.5 ? 'text-[#4ade80]' : 'text-content'}>
                    {formatPct(tradeStats.winRate * 100)}
                  </strong>{' '}
                  · avg <strong className="text-content">{formatPct(tradeStats.avg * 100)}</strong> · best{' '}
                  <strong className="text-[#4ade80]">{formatPct(tradeStats.best * 100)}</strong> · worst{' '}
                  <strong className="text-[#f87171]">{formatPct(tradeStats.worst * 100)}</strong>
                </span>
                {tradesOpen ? (
                  <ChevronUp size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </div>
            </button>

            {tradesOpen && (
              <div className="border-t border-outline px-4 pb-4 pt-3">
                {allTrades.length === 0 ? (
                  <p className="py-6 text-center text-sm text-content-muted">
                    No trades yet — the strategy stayed in BTC.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-outline text-[11px] uppercase tracking-wide text-content-muted">
                            <th className="py-2 pr-3">Coin</th>
                            <th className="py-2 pr-3">Bought</th>
                            <th className="py-2 pr-3">Sold</th>
                            <th className="py-2 pr-3">Result</th>
                            <th className="py-2">Why</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleTrades.map((trade, index) => (
                            <tr
                              key={`${trade.symbol}-${trade.entry_date}-${index}`}
                              className="border-b border-outline/50"
                            >
                              <td className="py-2 pr-3">
                                <span className="font-mono text-content">{trade.symbol.replace(/(USDT|BTC)$/, '')}</span>
                                <span className="ml-1.5 text-content-muted">score {trade.entry_score.toFixed(0)}</span>
                              </td>
                              <td className="py-2 pr-3 font-mono">
                                <div>{trade.entry_date.slice(0, 10)}</div>
                                <div className="text-content-muted">{formatBtcValue(trade.entry_price)} BTC</div>
                              </td>
                              <td className="py-2 pr-3 font-mono">
                                <div>{trade.exit_date.slice(0, 10)}</div>
                                <div className="text-content-muted">{formatBtcValue(trade.exit_price)} BTC</div>
                              </td>
                              <td
                                className={cn(
                                  'py-2 pr-3 font-mono',
                                  trade.return_pct >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]',
                                )}
                              >
                                {formatPct(trade.return_pct * 100)}
                                <span className="ml-1 text-content-muted">{trade.days}d</span>
                              </td>
                              <td className="py-2">
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                                    EXIT_REASON_CLASSES[trade.exit_reason] ?? 'bg-surface-3 text-content-muted',
                                  )}
                                >
                                  {EXIT_REASON_LABELS[trade.exit_reason] ?? trade.exit_reason}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {allTrades.length > 12 && (
                      <button
                        type="button"
                        onClick={() => setShowAllTrades((current) => !current)}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        {showAllTrades ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {showAllTrades ? 'Show latest 12 trades' : `Show all ${allTrades.length} trades`}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          <p className="mt-4 text-[11px] leading-relaxed text-content-muted">
            Historical simulation, not investment advice. Scores are recomputed from past candles at each
            rebalance date, but liquidity filters use today&apos;s market cap and volume: delisted coins are
            missing and surviving coins may look more liquid than they were. Missing prices forward-fill the
            last close.
          </p>
        </>
      ) : null}
    </div>
  );
}
