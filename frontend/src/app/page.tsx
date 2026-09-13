'use client';

import {
  Activity,
  Camera,
  Download,
  History,
  LayoutDashboard,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Star,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CoinModal from '@/components/CoinModal';
import CoinTable, { SortDirection, SortKey } from '@/components/CoinTable';
import ComparePanel from '@/components/ComparePanel';
import RankedList from '@/components/RankedList';
import ScatterChart from '@/components/ScatterChart';
import Treemap from '@/components/Treemap';
import WatchlistPanel from '@/components/WatchlistPanel';
import { Button, Segmented, Spinner, StatCard } from '@/components/ui';
import { downloadCsv, matchesListingFilter, trendDelta } from '@/lib/coins';
import type { ListingFilter } from '@/lib/coins';
import { formatDate, makeDistanceColorScale, percentile } from '@/lib/colors';
import { exportSvgToPng } from '@/lib/exportImage';
import type { Coin, Meta, Watch } from '@/types';

const POLL_INTERVAL_MS = 5000;

const MIN_CAP_OPTIONS = [
  { value: 0, label: 'Any market cap' },
  { value: 10_000_000, label: '≥ $10M market cap' },
  { value: 50_000_000, label: '≥ $50M market cap' },
  { value: 100_000_000, label: '≥ $100M market cap' },
  { value: 500_000_000, label: '≥ $500M market cap' },
];

const MIN_VOLUME_OPTIONS = [
  { value: 0, label: 'Any volume' },
  { value: 1_000_000, label: '≥ $1M volume' },
  { value: 5_000_000, label: '≥ $5M volume' },
  { value: 10_000_000, label: '≥ $10M volume' },
];

const DEFAULT_MIN_VOLUME = 1_000_000;

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
  const [viewMode, setViewMode] = useState<'scatter' | 'table' | 'treemap'>('scatter');
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [watchOnly, setWatchOnly] = useState(false);
  const [lowFrom, setLowFrom] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [listingFilter, setListingFilter] = useState<ListingFilter>('any');
  const [minCap, setMinCap] = useState(0);
  const [minVolume, setMinVolume] = useState(DEFAULT_MIN_VOLUME);
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
  const urlApplied = useRef(false);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    setToast({ message, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const fetchCoinsWith = useCallback(async (referenceLowFrom: string | null, asOfValue: string | null) => {
    try {
      const params = new URLSearchParams();
      if (asOfValue) params.set('as_of', asOfValue);
      if (referenceLowFrom) params.set('low_from', referenceLowFrom);
      const query = params.toString();
      const response = await fetch(query ? `/api/coins?${query}` : '/api/coins', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: Coin[] = await response.json();
      setCoins(data);
      setError(null);
    } catch {
      setError('Could not reach the backend API. Is it running?');
    }
  }, []);

  const fetchCoins = useCallback(() => fetchCoinsWith(lowFrom, asOf), [fetchCoinsWith, lowFrom, asOf]);

  const changeLowFrom = useCallback(
    (value: string | null) => {
      setLowFrom(value);
      void fetchCoinsWith(value, asOf);
    },
    [fetchCoinsWith, asOf],
  );

  const changeAsOf = useCallback(
    (value: string | null) => {
      setAsOf(value);
      void fetchCoinsWith(lowFrom, value);
    },
    [fetchCoinsWith, lowFrom],
  );

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
        const params = new URLSearchParams(window.location.search);
        const initialReference = new URLSearchParams();
        const initialAsOf = params.get('asof');
        if (initialAsOf) {
          setAsOf(initialAsOf);
          initialReference.set('as_of', initialAsOf);
        }
        const initialLowFrom = params.get('low');
        if (initialLowFrom) {
          setLowFrom(initialLowFrom);
          initialReference.set('low_from', initialLowFrom);
        }
        const initialQuery = initialReference.toString();

        const coinsUrl = initialQuery ? `/api/coins?${initialQuery}` : '/api/coins';
        const [coinsResponse, metaResponse] = await Promise.all([
          fetch(coinsUrl, { cache: 'no-store' }),
          fetch('/api/meta', { cache: 'no-store' }),
        ]);
        const watchlistResponse = await fetch('/api/watchlist', { cache: 'no-store' });
        if (watchlistResponse.ok) setWatches(await watchlistResponse.json());
        if (!coinsResponse.ok) throw new Error(`HTTP ${coinsResponse.status}`);
        const coinsData: Coin[] = await coinsResponse.json();
        if (cancelled) return;
        setCoins(coinsData);
        if (metaResponse.ok) setMeta(await metaResponse.json());
        setError(null);

        // Restore the view state encoded in the URL.
        if (params.get('ref') === 'atl') setUseAtl(true);
        const query = params.get('q');
        if (query) setSearch(query);
        const cap = Number(params.get('cap'));
        if (Number.isFinite(cap) && cap > 0) setMinCap(cap);
        const volume = Number(params.get('vol'));
        if (Number.isFinite(volume) && volume > 0) setMinVolume(volume);
        const view = params.get('view');
        if (view === 'table' || view === 'scatter' || view === 'treemap') setViewMode(view);
        const listed = params.get('listed');
        if (listed === 'old' || listed === 'new') setListingFilter(listed);
        const compare = params.get('compare');
        if (compare) {
          setCompareSymbols(compare.split(',').filter(Boolean).slice(0, 3));
        }
        if (params.get('watch') === '1') setWatchOnly(true);
        const coinSymbol = params.get('coin');
        if (coinSymbol) {
          const found = coinsData.find((coin) => coin.symbol === coinSymbol);
          if (found) setSelectedCoin(found);
        }
        urlApplied.current = true;
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

  useEffect(() => {
    if (!urlApplied.current) return;
    const params = new URLSearchParams();
    if (useAtl) params.set('ref', 'atl');
    if (search.trim()) params.set('q', search.trim());
    if (minCap > 0) params.set('cap', String(minCap));
    if (minVolume > 0) params.set('vol', String(minVolume));
    if (viewMode !== 'scatter') params.set('view', viewMode);
    if (selectedCoin) params.set('coin', selectedCoin.symbol);
    if (compareSymbols.length > 0) params.set('compare', compareSymbols.join(','));
    if (watchOnly) params.set('watch', '1');
    if (lowFrom) params.set('low', lowFrom);
    if (asOf) params.set('asof', asOf);
    if (listingFilter !== 'any') params.set('listed', listingFilter);
    const queryString = params.toString();
    window.history.replaceState(
      null,
      '',
      queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname,
    );
  }, [useAtl, search, minCap, minVolume, viewMode, selectedCoin, compareSymbols, watchOnly, lowFrom, asOf, listingFilter]);

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

  const watchedSymbols = useMemo(() => new Set(watches.map((watch) => watch.symbol)), [watches]);

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
      .filter((coin) => !watchOnly || watchedSymbols.has(coin.symbol))
      .filter((coin) => matchesListingFilter(coin, listingFilter))
      .filter((coin) => (coin.market_cap ?? 0) >= minCap)
      .filter((coin) => (coin.volume_24h ?? 0) >= minVolume);

    return [...list].sort((a, b) => {
      let result = 0;
      if (sort.key === 'market_cap') result = (a.market_cap ?? -1) - (b.market_cap ?? -1);
      else if (sort.key === 'volume_24h') result = (a.volume_24h ?? -1) - (b.volume_24h ?? -1);
      else if (sort.key === 'distance')
        result = (activeDistance(a) ?? Number.MAX_VALUE) - (activeDistance(b) ?? Number.MAX_VALUE);
      else if (sort.key === 'trend_7d')
        result = (trendDelta(a, useAtl, 7) ?? Number.MAX_VALUE) - (trendDelta(b, useAtl, 7) ?? Number.MAX_VALUE);
      else result = a.symbol.localeCompare(b.symbol);
      return sort.direction === 'asc' ? result : -result;
    });
  }, [coins, search, minCap, minVolume, sort, activeDistance, useAtl, watchOnly, watchedSymbols, listingFilter]);

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

  const toggleCompare = useCallback((coin: Coin) => {
    setCompareSymbols((current) => {
      if (current.includes(coin.symbol)) return current.filter((symbol) => symbol !== coin.symbol);
      if (current.length >= 3) return [...current.slice(1), coin.symbol];
      return [...current, coin.symbol];
    });
  }, []);

  const refreshWatchlist = useCallback(async () => {
    try {
      const response = await fetch('/api/watchlist', { cache: 'no-store' });
      if (response.ok) setWatches(await response.json());
    } catch {
      // Keep the previous list on transient failures.
    }
  }, []);

  const toggleWatch = useCallback(
    async (coin: Coin) => {
      const watched = watches.some((watch) => watch.symbol === coin.symbol);
      try {
        const response = watched
          ? await fetch(`/api/watchlist/${encodeURIComponent(coin.symbol)}`, { method: 'DELETE' })
          : await fetch(`/api/watchlist/${encodeURIComponent(coin.symbol)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ threshold_pct: null }),
            });
        if (!response.ok && response.status !== 204) throw new Error(`HTTP ${response.status}`);
        await refreshWatchlist();
        const label = coin.base_asset ?? coin.symbol;
        showToast(watched ? `${label} removed from watchlist.` : `${label} added to watchlist.`);
      } catch {
        showToast('Could not update the watchlist.', 'error');
      }
    },
    [watches, refreshWatchlist, showToast],
  );

  const updateWatchThreshold = useCallback(
    async (symbol: string, threshold: number | null) => {
      try {
        const response = await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ threshold_pct: threshold }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await refreshWatchlist();
      } catch {
        showToast('Could not update the alert threshold.', 'error');
      }
    },
    [refreshWatchlist, showToast],
  );

  const selectBySymbol = useCallback(
    (symbol: string) => {
      const coin = coins.find((entry) => entry.symbol === symbol);
      if (coin) setSelectedCoin(coin);
    },
    [coins],
  );

  const handleExportPng = async () => {
    const svg = document.querySelector<SVGSVGElement>('svg[data-exportable="true"]');
    if (!svg) {
      showToast('Nothing to export yet.', 'error');
      return;
    }
    try {
      await exportSvgToPng(svg, `dip-radar-${new Date().toISOString().slice(0, 10)}.png`);
    } catch {
      showToast('PNG export failed.', 'error');
    }
  };

  const progress = meta?.sync_progress ?? null;
  const progressPct =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : null;
  const phaseLabel = progress ? (PHASE_LABELS[progress.phase] ?? progress.phase) : 'Syncing';
  const referenceLabel = useAtl ? 'All-time low' : lowFrom ? `Since ${lowFrom}` : 'Since 2021';

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
        <StatCard label="≤ 25% from dip" value={stats.near25} accent="positive" hint={referenceLabel} />
        <StatCard label="≤ 50% from dip" value={stats.near50} hint={referenceLabel} />
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
          value={useAtl ? 'atl' : lowFrom ? 'custom' : 'event'}
          onChange={(value) => {
            if (value === 'atl') {
              setUseAtl(true);
              return;
            }
            setUseAtl(false);
            if (value === 'event') {
              if (lowFrom) changeLowFrom(null);
              return;
            }
            const next = lowFrom ?? '2021-01-01';
            if (!lowFrom) setLowFrom(next);
            void fetchCoinsWith(next, asOf);
          }}
          options={[
            { value: 'event', label: 'Since 2021' },
            { value: 'atl', label: 'All-time low' },
            { value: 'custom', label: 'Custom' },
          ]}
        />

        {!useAtl && lowFrom && (
          <input
            type="date"
            value={lowFrom}
            max={new Date().toISOString().slice(0, 10)}
            aria-label="Reference window start date"
            onChange={(event) => {
              const value = event.target.value || null;
              changeLowFrom(value);
            }}
            className="rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
          />
        )}

        <select
          value={listingFilter}
          onChange={(event) => setListingFilter(event.target.value as ListingFilter)}
          aria-label="Listing date filter"
          className="rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-primary"
        >
          <option value="any">Any listing date</option>
          <option value="old">Listed before 2021</option>
          <option value="new">Listed in 2021+</option>
        </select>

        <div className="flex items-center gap-1.5 rounded-lg border border-outline bg-surface-2 px-2.5 py-2 text-xs">
          <History size={13} className="text-content-muted" />
          <label htmlFor="as-of-date" className="text-content-muted">
            As of
          </label>
          <input
            id="as-of-date"
            type="date"
            value={asOf ?? ''}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => {
              const value = event.target.value || null;
              changeAsOf(value);
            }}
            className="bg-transparent text-content outline-none"
          />
          {asOf && (
            <button
              type="button"
              aria-label="Back to live view"
              onClick={() => changeAsOf(null)}
              className="rounded-full p-0.5 text-content-muted transition-colors hover:bg-surface-3 hover:text-content"
            >
              <X size={12} />
            </button>
          )}
        </div>

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

        <button
          type="button"
          aria-pressed={watchOnly}
          onClick={() => setWatchOnly((current) => !current)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
            watchOnly
              ? 'border-primary bg-primary text-on-primary'
              : 'border-outline bg-surface-2 text-content-muted hover:text-content'
          }`}
        >
          <Star size={13} className={watchOnly ? 'fill-current' : undefined} />
          Watchlist
        </button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => downloadCsv(filteredCoins)}
            disabled={filteredCoins.length === 0}
            title="Download the filtered coins as CSV"
          >
            <Download size={15} />
            CSV
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPng}
            disabled={filteredCoins.length === 0 || viewMode === 'table'}
            title="Export the current chart as PNG"
          >
            <Camera size={15} />
            PNG
          </Button>
          <div className="flex items-center gap-1 rounded-lg border border-outline bg-surface-2 p-0.5">
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
              aria-label="Treemap view"
              aria-pressed={viewMode === 'treemap'}
              onClick={() => setViewMode('treemap')}
              className={`rounded-md p-2 transition-colors ${
                viewMode === 'treemap' ? 'bg-primary text-on-primary' : 'text-content-muted hover:text-content'
              }`}
            >
              <LayoutDashboard size={16} />
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
        </div>
      </section>

      {asOf && !loading && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs">
          <span className="text-content">
            <strong className="text-primary">Historical view:</strong> prices, lows, distances and trends are
            computed as of {asOf}. Market caps stay current.
          </span>
          <Button variant="outline" onClick={() => changeAsOf(null)}>
            Back to live
          </Button>
        </div>
      )}

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
        <>
          {compareSymbols.length > 0 && (
            <ComparePanel
              symbols={compareSymbols}
              onRemove={(symbol) =>
                setCompareSymbols((current) => current.filter((entry) => entry !== symbol))
              }
              onClear={() => setCompareSymbols([])}
            />
          )}

          <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 rounded-2xl border border-outline bg-surface p-2 sm:p-3">
              {filteredCoins.length === 0 ? (
                <p className="py-20 text-center text-sm text-content-muted">No coins match the current filters.</p>
              ) : viewMode === 'scatter' ? (
                <ScatterChart coins={filteredCoins} useAtl={useAtl} onCoinClick={setSelectedCoin} />
              ) : viewMode === 'treemap' ? (
                <Treemap coins={filteredCoins} useAtl={useAtl} colorFor={colorFor} onCoinClick={setSelectedCoin} />
              ) : (
                <CoinTable
                  coins={filteredCoins}
                  useAtl={useAtl}
                  colorFor={colorFor}
                  sort={sort}
                  onToggleSort={toggleSort}
                  onSelect={setSelectedCoin}
                  watchedSymbols={watchedSymbols}
                  onToggleWatch={toggleWatch}
                />
              )}
            </div>

            <aside className="min-w-0 space-y-4">
              <WatchlistPanel
                watches={watches}
                useAtl={useAtl}
                colorFor={colorFor}
                onSelect={selectBySymbol}
                onRemove={(symbol) => {
                  const coin = coins.find((entry) => entry.symbol === symbol);
                  if (coin) {
                    void toggleWatch(coin);
                  } else {
                    void fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' }).then(
                      refreshWatchlist,
                    );
                  }
                }}
                onThresholdChange={updateWatchThreshold}
              />
              <RankedList
                coins={filteredCoins}
                useAtl={useAtl}
                referenceLabel={referenceLabel}
                colorFor={colorFor}
                onSelect={setSelectedCoin}
              />
            </aside>
          </section>
        </>
      )}

      {selectedCoin && (
        <CoinModal
          coin={selectedCoin}
          useAtl={useAtl}
          colorFor={colorFor}
          onClose={() => setSelectedCoin(null)}
          onCompareToggle={toggleCompare}
          isCompared={compareSymbols.includes(selectedCoin.symbol)}
          onWatchToggle={toggleWatch}
          isWatched={watchedSymbols.has(selectedCoin.symbol)}
          referenceLabel={referenceLabel}
          asOf={asOf}
        />
      )}
    </div>
  );
}
