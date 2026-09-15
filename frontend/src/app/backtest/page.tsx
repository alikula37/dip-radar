'use client';

import { Activity, ChevronDown, ChevronUp, Download, FlaskConical, Play, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import EquityChart from '@/components/EquityChart';
import { Button, RadarLoader, Segmented, StatCard, cn } from '@/components/ui';
import { formatBtcValue, formatPct } from '@/lib/colors';
import type { BacktestForm, BacktestResponse } from '@/types';

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
  optimize: false,
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
    },
  },
];

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
  query.set('score_model', form.scoreModel);
  if (form.end) query.set('end', form.end);
  if (form.optimize) query.set('optimize', 'true');

  const response = await fetch(`/api/backtest?${query.toString()}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail ?? `Backtest failed (HTTP ${response.status})`);
  }
  return payload as BacktestResponse;
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

          <button
            type="button"
            aria-pressed={form.optimize}
            onClick={() => update('optimize', !form.optimize)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
              form.optimize
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline bg-surface-2 text-content-muted hover:text-content',
            )}
            title="Also grid-search top-N, score threshold and BTC fill"
          >
            <Sparkles size={14} />
            Optimize
          </button>

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
            </select>
          </label>
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

      {loading ? (
        <section className="mt-4">
          <div className="flex h-[420px] flex-col items-center justify-center gap-4 rounded-2xl border border-outline bg-surface">
            <RadarLoader size="lg" label="Replaying Value Score history…" />
            <p className="max-w-md text-center text-xs text-content-muted">
              The first run rebuilds point-in-time scores for every rebalance date, which can take a few
              seconds. Later runs reuse the snapshot.
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
          <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
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

          {result.optimization && result.optimization.length > 0 && (
            <section className="mt-4 rounded-2xl border border-outline bg-surface p-4">
              <h2 className="text-sm font-semibold text-content">Best configurations (by Sharpe)</h2>
              <p className="text-[11px] text-content-muted">
                Grid search over exit rule, top-N, minimum score and BTC fill on the same snapshot.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-outline text-[11px] uppercase tracking-wide text-content-muted">
                      <th className="py-2 pr-3">Exit</th>
                      <th className="py-2 pr-3">Top N</th>
                      <th className="py-2 pr-3">Min score</th>
                      <th className="py-2 pr-3">Unfilled</th>
                      <th className="py-2 pr-3">Total (BTC)</th>
                      <th className="py-2 pr-3">Sharpe</th>
                      <th className="py-2 pr-3">Max DD</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.optimization.map((row) => (
                      <tr
                        key={`${row.rotation}-${row.top_n}-${row.min_score}-${row.fill_with_btc}`}
                        className="border-b border-outline/50"
                      >
                        <td className="py-2 pr-3">{row.rotation === 'hold' ? 'Hold' : 'Top-N'}</td>
                        <td className="py-2 pr-3 font-mono">{row.top_n}</td>
                        <td className="py-2 pr-3 font-mono">{row.min_score}</td>
                        <td className="py-2 pr-3">{row.fill_with_btc ? 'BTC' : 'Cash'}</td>
                        <td className={cn('py-2 pr-3 font-mono', row.total_return > 0 ? 'text-[#4ade80]' : 'text-[#f87171]')}>
                          {formatPct(row.total_return * 100)}
                        </td>
                        <td className="py-2 pr-3 font-mono">{row.sharpe.toFixed(2)}</td>
                        <td className="py-2 pr-3 font-mono text-[#f87171]">{formatPct(row.max_drawdown * 100)}</td>
                        <td className="py-2 text-right">
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-[11px]"
                            onClick={() => {
                              const next: BacktestForm = {
                                ...form,
                                rotation: row.rotation as BacktestForm['rotation'],
                                topN: row.top_n,
                                minScore: row.min_score,
                                fillWithBtc: row.fill_with_btc,
                                optimize: false,
                              };
                              setForm(next);
                              void runBacktest(next);
                            }}
                          >
                            Apply
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

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
                            {period.picks.length === 0 && <span className="text-content-muted">No candidates — BTC/cash</span>}
                            {period.picks.map((pick) => (
                              <span
                                key={pick.symbol}
                                className="inline-flex items-center gap-1 rounded-full border border-outline bg-surface-2 px-2 py-0.5 font-mono text-[11px]"
                              >
                                <span className="text-content">{pick.symbol.replace(/(USDT|BTC)$/, '')}</span>
                                <span className="text-primary">{pick.score.toFixed(0)}</span>
                                <span className="text-content-muted">{(pick.weight * 100).toFixed(0)}%</span>
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
