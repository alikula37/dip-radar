'use client';

import { Activity, LayoutGrid, List, RefreshCw, Search } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CoinModal from '@/components/CoinModal';
import CoinTable, { SortDirection, SortKey } from '@/components/CoinTable';
import RankedList from '@/components/RankedList';
import ScatterChart from '@/components/ScatterChart';
import { Button, Segmented, Spinner, StatCard } from '@/components/ui';
import { formatDate, makeDistanceColorScale, percentile } from '@/lib/colors';
import type { Coin, Meta } from '@/types';

const POLL_INTERVAL_MS = 5000;

const MIN_CAP_OPTIONS = [
  { value: 0, label: 'Any market cap' },
  { value: 10_000_000, label: '≥ $10M market cap' },
  { value: 50_000_000, label: '≥ $50M market cap' },
  { value: 100_000_000, label: '≥ $100M market cap' },
];

const MIN_VOLUME_OPTIONS = [
  { value: 0, label: 'Any volume' },
  { value: 1_000_000, label: '≥ $1M volume' },
  { value: 5_000_000, label: '≥ $5M volume' },
];

const PHASE_LABELS: Record<string, string> = {
  coins: 'Discovering listed coins',
  klines: 'Fetching price history',
  metadata: 'Fetching market data',
  done: 'Finishing up',
  error: 'Sync failed',
};

type Toast = { message: string; type: 'info' | 'error' };

export default function Home() {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [useAtl, setUseAtl] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'scatter' | 'table'>('scatter');
  const [minCap, setMinCap] = useState(0);
  const [minVolume, setMinVolume] = useState(0);
  const [selectedCoin, setSelectedCoin] = useState<Coin | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'distance',
    direction: 'asc',
  });

  const toastTimer = useRef<number | null>(null);
  const sawSyncRunning = useRef(false);
  const refreshingRef = useRef(false);
  const lastUpdatedBefore = useRef<string | null>(null);
  const refreshStartedAt = useRef<string | null>(null);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    setToast({ message, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const fetchCoins = useCallback(async () => {
    try {
      const response = await fetch('/api/coins', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: Coin[] = await response.json();
      setCoins(data);
      setError(null);
    } catch {
      setError('Could not reach the backend API. Is it running?');
    }
  }, []);

  const fetchMeta = useCallback(async (): Promise<Meta | null> => {
    try {
      const response = await fetch('/api/meta', { cache: 'no-store' });
      if (!response.ok) return null;
      const data: Meta = await response.json();
      setMeta(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [coinsResponse, metaResponse] = await Promise.all([
          fetch('/api/coins', { cache: 'no-store' }),
          fetch('/api/meta', { cache: 'no-store' }),
        ]);
        if (!coinsResponse.ok) throw new Error(`HTTP ${coinsResponse.status}`);
        const coinsData: Coin[] = await coinsResponse.json();
        if (cancelled) return;
        setCoins(coinsData);
        if (metaResponse.ok) setMeta(await metaResponse.json());
        setError(null);
      } catch {
        if (!cancelled) setError('Could not reach the backend API. Is it running?');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const syncInProgress = refreshing || (meta?.sync_in_progress ?? false);
  const needsPolling = syncInProgress || (coins.length === 0 && !error);

  useEffect(() => {
    if (!needsPolling) return;
    const interval = window.setInterval(() => {
      void (async () => {
        const latestMeta = await fetchMeta();
        await fetchCoins();

        if (!refreshingRef.current) return;

        const progress = latestMeta?.sync_progress;
        const progressAt = progress?.updated_at ?? '';
        if (progress?.phase === 'error' && progressAt >= (refreshStartedAt.current ?? '')) {
          refreshingRef.current = false;
          setRefreshing(false);
          sawSyncRunning.current = false;
          showToast(progress.message ?? 'Sync failed.', 'error');
          return;
        }

        if (latestMeta?.last_updated && latestMeta.last_updated !== lastUpdatedBefore.current) {
          refreshingRef.current = false;
          setRefreshing(false);
          sawSyncRunning.current = false;
          showToast('Data refreshed.');
          return;
        }

        if (latestMeta?.sync_in_progress) {
          sawSyncRunning.current = true;
          return;
        }

        if (sawSyncRunning.current) {
          sawSyncRunning.current = false;
          refreshingRef.current = false;
          setRefreshing(false);
          showToast('Data refreshed.');
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [needsPolling, fetchCoins, fetchMeta, showToast]);

  const handleRefresh = async () => {
    try {
      const response = await fetch('/api/refresh', { method: 'POST' });
      if (response.status === 409) {
        showToast('A sync is already running.');
        lastUpdatedBefore.current = meta?.last_updated ?? null;
        refreshStartedAt.current = new Date().toISOString();
        refreshingRef.current = true;
        sawSyncRunning.current = false;
        setRefreshing(true);
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lastUpdatedBefore.current = meta?.last_updated ?? null;
      refreshStartedAt.current = new Date().toISOString();
      refreshingRef.current = true;
      sawSyncRunning.current = false;
      setRefreshing(true);
      showToast('Refresh started. Data updates when the sync finishes.');
    } catch {
      showToast('Could not start refresh.', 'error');
    }
  };

  const activeDistance = useCallback(
    (coin: Coin) => (useAtl ? coin.distance_pct_atl : coin.distance_pct_event),
    [useAtl],
  );

  const stats = useMemo(() => {
    const distances = coins
      .map(activeDistance)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return {
      tracked: coins.length,
      near25: distances.filter((value) => value <= 25).length,
      near50: distances.filter((value) => value <= 50).length,
      median: percentile(distances, 50),
    };
  }, [coins, activeDistance]);

  const filteredCoins = useMemo(() => {
    const query = search.trim().toLowerCase();

    const list = coins
      .filter(
        (coin) =>
          !query ||
          coin.symbol.toLowerCase().includes(query) ||
          (coin.name ?? '').toLowerCase().includes(query) ||
          (coin.base_asset ?? '').toLowerCase().includes(query),
      )
      .filter((coin) => (coin.market_cap ?? 0) >= minCap)
      .filter((coin) => (coin.volume_24h ?? 0) >= minVolume);

    return [...list].sort((a, b) => {
      let result = 0;
      if (sort.key === 'market_cap') result = (a.market_cap ?? -1) - (b.market_cap ?? -1);
      else if (sort.key === 'volume_24h') result = (a.volume_24h ?? -1) - (b.volume_24h ?? -1);
      else if (sort.key === 'distance')
        result = (activeDistance(a) ?? Number.MAX_VALUE) - (activeDistance(b) ?? Number.MAX_VALUE);
      else result = a.symbol.localeCompare(b.symbol);
      return sort.direction === 'asc' ? result : -result;
    });
  }, [coins, search, minCap, minVolume, sort, activeDistance]);

  const colorFor = useMemo(() => {
    const distances = filteredCoins
      .map(activeDistance)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const robustMax = Math.max(percentile(distances, 90), 25);
    return makeDistanceColorScale(robustMax);
  }, [filteredCoins, activeDistance]);

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'symbol' ? 'asc' : 'desc' },
    );
  };

  const progress = meta?.sync_progress ?? null;
  const progressPct =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : null;
  const phaseLabel = progress ? (PHASE_LABELS[progress.phase] ?? progress.phase) : 'Syncing';

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1440px] px-4 pb-12 pt-5 sm:px-6">
      {toast && (
        <div
          role="status"
          style={{ animation: 'slide-down 0.3s ease-out' }}
          className={`fixed left-1/2 top-5 z-[60] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-xl ${
            toast.type === 'error' ? 'bg-red-400 text-[#3b0808]' : 'bg-primary text-on-primary'
          }`}
        >
          {toast.message}
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-outline pb-4">
        <div className="flex items-center gap-3">
          <Activity size={28} className="text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-primary">Dip Radar</h1>
            <p className="text-xs text-content-muted">
              BTC-parity altcoins and how far they trade from their historical dips
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {meta?.last_updated && (
            <span className="hidden text-[11px] text-content-muted sm:inline">
              Updated {formatDate(meta.last_updated)}
            </span>
          )}
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Syncing…' : 'Refresh data'}
          </Button>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Tracked coins" value={stats.tracked} hint="Pre-2021 or ≥ $10M cap" />
        <StatCard label="≤ 25% from dip" value={stats.near25} accent="positive" hint={useAtl ? 'All-time low' : '2021 low'} />
        <StatCard label="≤ 50% from dip" value={stats.near50} hint={useAtl ? 'All-time low' : '2021 low'} />
        <StatCard label="Median distance" value={`${stats.median.toFixed(0)}%`} hint="Across tracked coins" />
      </section>

      {syncInProgress && coins.length > 0 && (
        <div className="mt-4 rounded-xl border border-outline bg-surface px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-content">
              <Spinner size={14} className="text-primary" />
              {phaseLabel}
            </span>
            <span className="font-mono text-content-muted">
              {progressPct !== null ? `${progressPct}%` : '…'}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${progressPct ?? 5}%` }}
            />
          </div>
        </div>
      )}

      <section className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
          <input
            type="text"
            placeholder="Search coins…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-outline bg-surface-2 py-2 pl-9 pr-3 text-sm text-content outline-none placeholder:text-content-muted focus:border-primary"
          />
        </div>

        <Segmented
          ariaLabel="Reference low"
          value={useAtl ? 'atl' : 'event'}
          onChange={(value) => setUseAtl(value === 'atl')}
          options={[
            { value: 'event', label: 'Since 2021' },
            { value: 'atl', label: 'All-time low' },
          ]}
        />

        <select
          value={minCap}
          onChange={(event) => setMinCap(Number(event.target.value))}
          className="rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
        >
          {MIN_CAP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          value={minVolume}
          onChange={(event) => setMinVolume(Number(event.target.value))}
          className="rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
        >
          {MIN_VOLUME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-outline bg-surface-2 p-0.5">
          <button
            type="button"
            aria-label="Scatter view"
            aria-pressed={viewMode === 'scatter'}
            onClick={() => setViewMode('scatter')}
            className={`rounded-md p-2 transition-colors ${
              viewMode === 'scatter' ? 'bg-primary text-on-primary' : 'text-content-muted hover:text-content'
            }`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            type="button"
            aria-label="Table view"
            aria-pressed={viewMode === 'table'}
            onClick={() => setViewMode('table')}
            className={`rounded-md p-2 transition-colors ${
              viewMode === 'table' ? 'bg-primary text-on-primary' : 'text-content-muted hover:text-content'
            }`}
          >
            <List size={16} />
          </button>
        </div>
      </section>

      {loading ? (
        <section className="mt-6 space-y-3">
          <div className="h-[420px] animate-pulse rounded-2xl border border-outline bg-surface" />
          <div className="flex items-center justify-center gap-2 text-sm text-content-muted">
            <Spinner size={16} /> Loading radar data…
          </div>
        </section>
      ) : error && coins.length === 0 ? (
        <section className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-outline bg-surface px-6 py-16 text-center">
          <p className="text-sm text-content">{error}</p>
          <Button
            variant="primary"
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchCoins().finally(() => setLoading(false));
              fetchMeta();
            }}
          >
            Retry
          </Button>
        </section>
      ) : coins.length === 0 ? (
        <section className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-outline bg-surface px-6 py-16 text-center">
          <Spinner size={28} className="text-primary" />
          <div>
            <p className="text-sm font-medium text-content">{phaseLabel}…</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-content-muted">
              Historical data is fetched from Binance and CoinGecko. The first sync usually takes a few minutes.
            </p>
          </div>
          <div className="h-1.5 w-64 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${progressPct ?? 5}%` }}
            />
          </div>
        </section>
      ) : (
        <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 rounded-2xl border border-outline bg-surface p-2 sm:p-3">
            {filteredCoins.length === 0 ? (
              <p className="py-20 text-center text-sm text-content-muted">No coins match the current filters.</p>
            ) : viewMode === 'scatter' ? (
              <ScatterChart coins={filteredCoins} useAtl={useAtl} onCoinClick={setSelectedCoin} />
            ) : (
              <CoinTable
                coins={filteredCoins}
                useAtl={useAtl}
                colorFor={colorFor}
                sort={sort}
                onToggleSort={toggleSort}
                onSelect={setSelectedCoin}
              />
            )}
          </div>

          <aside className="min-w-0">
            <RankedList coins={filteredCoins} useAtl={useAtl} colorFor={colorFor} onSelect={setSelectedCoin} />
          </aside>
        </section>
      )}

      {selectedCoin && (
        <CoinModal
          coin={selectedCoin}
          useAtl={useAtl}
          colorFor={colorFor}
          onClose={() => setSelectedCoin(null)}
        />
      )}
    </div>
  );
}
