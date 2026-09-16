'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FlaskConical, RefreshCw, Trash2, TrendingDown } from 'lucide-react';

import { Button, RadarLoader, cn } from '@/components/ui';
import { formatPct } from '@/lib/colors';
import type { StrategySignalRecord, StrategySignalsResponse, StrategyWatch } from '@/types';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload as { detail?: string } | null)?.detail ?? `Request failed (HTTP ${response.status})`);
  }
  return payload as T;
}

const ACTION_STYLES: Record<string, string> = {
  BUY: 'text-[#4ade80]',
  SELL: 'text-[#f87171]',
  SHORT: 'text-[#f87171]',
  STAY_IN_BTC: 'text-[#facc15]',
  HOLD: 'text-content-muted',
  TRACKED: 'text-content-muted',
};

export default function SignalsPage() {
  const [watches, setWatches] = useState<StrategyWatch[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [live, setLive] = useState<StrategySignalsResponse | null>(null);
  const [history, setHistory] = useState<StrategySignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWatches = useCallback(async () => {
    const payload = await fetchJson<StrategyWatch[]>('/api/strategy/watches');
    setWatches(payload);
    return payload;
  }, []);

  const loadWatch = useCallback(async (watchId: number) => {
    setError(null);
    setLoading(true);
    try {
      const [livePayload, historyPayload] = await Promise.all([
        fetchJson<StrategySignalsResponse>(`/api/strategy/watches/${watchId}/live`),
        fetchJson<StrategySignalRecord[]>(`/api/strategy/watches/${watchId}/signals?limit=60`),
      ]);
      setLive(livePayload);
      setHistory(historyPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Signals failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const payload = await loadWatches();
          if (cancelled) return;
          if (payload.length > 0) {
            setSelected(payload[0].id);
            await loadWatch(payload[0].id);
          } else {
            setLoading(false);
          }
        } catch (caught) {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : 'Could not load watches.');
            setLoading(false);
          }
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadWatches, loadWatch]);

  const refreshWatch = useCallback(
    async (watchId: number) => {
      try {
        await fetchJson(`/api/strategy/watches/${watchId}/refresh`, { method: 'POST' });
        await loadWatches();
        await loadWatch(watchId);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Refresh failed.');
      }
    },
    [loadWatches, loadWatch],
  );

  const deleteWatch = useCallback(
    async (watchId: number) => {
      try {
        await fetchJson(`/api/strategy/watches/${watchId}`, { method: 'DELETE' });
        const payload = await loadWatches();
        const next = payload.find((watch) => watch.id !== watchId) ?? null;
        setSelected(next?.id ?? null);
        if (next) await loadWatch(next.id);
        else {
          setLive(null);
          setHistory([]);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Delete failed.');
      }
    },
    [loadWatches, loadWatch],
  );

  const activeWatch = watches.find((watch) => watch.id === selected) ?? null;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1200px] px-4 pb-12 pt-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-outline pb-4">
        <div className="flex items-center gap-3">
          <TrendingDown size={28} className="text-primary" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold text-content">Signals</h1>
            <p className="text-xs text-content-muted">
              Watched strategies, their live book and every stored signal with its paper follow-through
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-outline bg-surface-2 px-3 py-2 text-sm font-medium text-content transition-colors hover:border-outline-strong hover:bg-surface-3"
          >
            <ArrowLeft size={15} />
            Dashboard
          </Link>
          <Link
            href="/backtest"
            className="inline-flex items-center gap-2 rounded-lg border border-outline bg-surface-2 px-3 py-2 text-sm font-medium text-content transition-colors hover:border-outline-strong hover:bg-surface-3"
          >
            <FlaskConical size={15} />
            Strategy Lab
          </Link>
        </div>
      </header>

      {error && <p className="mt-4 rounded-lg border border-outline bg-surface-2 p-3 text-xs text-[#f87171]">{error}</p>}

      {!loading && watches.length === 0 && (
        <section className="mt-6 rounded-xl border border-outline bg-surface-1 p-6 text-center">
          <p className="text-sm text-content">No watched strategies yet.</p>
          <p className="mt-1 text-xs text-content-muted">
            Configure a strategy in the Strategy Lab and use <span className="text-content">Save as watch</span> to track
            its signals here.
          </p>
          <Link
            href="/backtest"
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-outline bg-surface-2 px-3 py-2 text-sm font-medium text-content transition-colors hover:border-outline-strong hover:bg-surface-3"
          >
            <FlaskConical size={15} />
            Open Strategy Lab
          </Link>
        </section>
      )}

      {watches.length > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-2">
            {watches.map((watch) => (
              <button
                key={watch.id}
                type="button"
                onClick={() => {
                  setSelected(watch.id);
                  void loadWatch(watch.id);
                }}
                className={cn(
                  'w-full rounded-lg border bg-surface-2 p-3 text-left text-xs transition-colors',
                  watch.id === selected ? 'border-primary' : 'border-outline hover:border-outline-strong',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-content">{watch.name}</span>
                  {watch.paper_return !== null && (
                    <span className={watch.paper_return >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                      {formatPct(watch.paper_return * 100)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-content-muted">
                  {watch.rebalance} · {watch.score_model} · anchor {watch.last_anchor?.slice(0, 10) ?? '—'}
                </p>
              </button>
            ))}
          </aside>

          <main className="space-y-4">
            {activeWatch && (
              <section className="rounded-xl border border-outline bg-surface-1 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-content">{activeWatch.name}</h2>
                    <p className="text-[11px] text-content-muted">
                      shadow baseline {activeWatch.start_equity?.toFixed(3) ?? '—'}× · now{' '}
                      {activeWatch.last_equity?.toFixed(3) ?? '—'}× · refreshed{' '}
                      {activeWatch.last_refreshed_at?.slice(0, 16).replace('T', ' ') ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => void refreshWatch(activeWatch.id)} disabled={loading}>
                      <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
                      Refresh
                    </Button>
                    <Button variant="outline" onClick={() => void deleteWatch(activeWatch.id)}>
                      <Trash2 size={14} />
                      Delete
                    </Button>
                  </div>
                </div>

                {loading && (
                  <div className="mt-4 flex justify-center">
                    <RadarLoader />
                  </div>
                )}

                {live && !loading && (
                  <div className="mt-3 space-y-3">
                    <p className="text-[11px] text-content-muted">
                      Anchor {live.anchor.slice(0, 10)} → next {live.next_anchor.slice(0, 10)} · as of{' '}
                      {live.as_of.slice(0, 10)} · {live.message}
                    </p>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5 text-content-muted">
                        equity {live.state.equity.toFixed(2)}× BTC
                      </span>
                      <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5 text-content-muted">
                        long {live.state.long_notional.toFixed(2)} · short {live.state.short_notional.toFixed(2)}
                      </span>
                      {live.state.rolling_ic !== null && (
                        <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5 text-content-muted">
                          rolling IC {live.state.rolling_ic.toFixed(3)} {live.state.ic_risk_on ? '(on)' : '(off)'}
                        </span>
                      )}
                      {live.state.in_btc && (
                        <span className="rounded-full border border-outline bg-surface-2 px-2 py-0.5 text-[#facc15]">
                          In BTC · {live.state.in_btc}
                        </span>
                      )}
                    </div>

                    {live.positions.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-xs">
                          <thead>
                            <tr className="border-b border-outline text-[11px] uppercase tracking-wide text-content-muted">
                              <th className="py-1.5 pr-3">Symbol</th>
                              <th className="py-1.5 pr-3">Side</th>
                              <th className="py-1.5 pr-3">Score</th>
                              <th className="py-1.5 pr-3">Weight</th>
                              <th className="py-1.5 pr-3">Entry</th>
                              <th className="py-1.5 pr-3">Now</th>
                              <th className="py-1.5 pr-3">BTC PnL</th>
                              <th className="py-1.5">Signal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {live.positions.map((position) => (
                              <tr key={`${position.direction}-${position.symbol}`} className="border-b border-outline/50">
                                <td className="py-1.5 pr-3 font-mono">{position.symbol.replace(/(USDT|BTC)$/, '')}</td>
                                <td className="py-1.5 pr-3 text-content-muted">{position.direction}</td>
                                <td className="py-1.5 pr-3 text-primary">{position.score?.toFixed(0) ?? '—'}</td>
                                <td className="py-1.5 pr-3">
                                  {position.weight !== null ? `${(position.weight * 100).toFixed(0)}%` : '—'}
                                </td>
                                <td className="py-1.5 pr-3 font-mono text-[11px]">
                                  {position.entry_price?.toPrecision(4) ?? '—'}
                                </td>
                                <td className="py-1.5 pr-3 font-mono text-[11px]">
                                  {position.price_now?.toPrecision(4) ?? '—'}
                                </td>
                                <td
                                  className={cn(
                                    'py-1.5 pr-3 font-mono',
                                    (position.pnl_pct ?? 0) >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]',
                                  )}
                                >
                                  {position.pnl_pct !== null ? formatPct(position.pnl_pct * 100) : '—'}
                                </td>
                                <td className="py-1.5">
                                  {position.action === 'SELL' ? (
                                    <span className="text-[#f87171]">
                                      SELL · {position.reason} · {position.trigger_date?.slice(0, 10)}
                                    </span>
                                  ) : (
                                    <span className="text-content-muted">
                                      {position.action}
                                      {position.stop_price ? ` · stop ${position.stop_price.toPrecision(3)}` : ''}
                                      {position.trailing_stop_price
                                        ? ` · trail ${position.trailing_stop_price.toPrecision(3)}`
                                        : ''}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {live.candidates.length > 0 && (
                      <p className="text-[11px] text-content-muted">
                        Next-anchor watchlist:{' '}
                        {live.candidates
                          .map((candidate) => `${candidate.symbol.replace(/(USDT|BTC)$/, '')} ${candidate.score.toFixed(0)}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            {history.length > 0 && (
              <section className="rounded-xl border border-outline bg-surface-1 p-4">
                <h2 className="text-sm font-semibold text-content">Signal history</h2>
                <p className="text-[11px] text-content-muted">
                  Every stored signal with the strategy&apos;s own paper move since it fired.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-outline text-[11px] uppercase tracking-wide text-content-muted">
                        <th className="py-1.5 pr-3">Date</th>
                        <th className="py-1.5 pr-3">Action</th>
                        <th className="py-1.5 pr-3">Symbol</th>
                        <th className="py-1.5 pr-3">Reason</th>
                        <th className="py-1.5 pr-3">Price</th>
                        <th className="py-1.5">Return since</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((signal) => (
                        <tr key={signal.id} className="border-b border-outline/50">
                          <td className="py-1.5 pr-3 font-mono">{signal.date.slice(0, 10)}</td>
                          <td className={cn('py-1.5 pr-3', ACTION_STYLES[signal.action] ?? 'text-content')}>
                            {signal.action}
                          </td>
                          <td className="py-1.5 pr-3 font-mono">
                            {signal.symbol ? signal.symbol.replace(/(USDT|BTC)$/, '') : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-content-muted">{signal.reason ?? '—'}</td>
                          <td className="py-1.5 pr-3 font-mono text-[11px]">
                            {signal.price ? signal.price.toPrecision(4) : '—'}
                          </td>
                          <td
                            className={cn(
                              'py-1.5 font-mono',
                              (signal.return_since ?? 0) >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]',
                            )}
                          >
                            {signal.return_since !== null && signal.return_since !== undefined
                              ? formatPct(signal.return_since * 100)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
