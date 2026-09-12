'use client';

import { Activity, List, RefreshCw, Search, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import BubbleChart from '@/components/BubbleChart';
import HistoryChart from '@/components/HistoryChart';
import { formatBtc, formatPct, formatUsd, makeDistanceColorScale } from '@/lib/colors';
import type { Coin, Meta } from '@/types';

type Toast = { message: string; type: 'info' | 'error' };
type SortKey = 'market_cap' | 'distance' | 'symbol';

const POLL_INTERVAL_MS = 10000;

export default function Home() {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [useAtl, setUseAtl] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'bubble' | 'table'>('bubble');
  const [selectedCoin, setSelectedCoin] = useState<Coin | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'market_cap',
    direction: 'desc',
  });

  const toastTimer = useRef<number | null>(null);
  const sawSyncRunning = useRef(false);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    setToast({ message, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchCoins = useCallback(async (initial = false) => {
    try {
      const response = await fetch('/api/coins', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: Coin[] = await response.json();
      setCoins(data);
      setError(null);
    } catch {
      if (initial) setError('Could not reach the backend API. Is it running?');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  const fetchMeta = useCallback(async () => {
    try {
      const response = await fetch('/api/meta', { cache: 'no-store' });
      if (response.ok) setMeta(await response.json());
    } catch {
      // Status polling is best-effort.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/coins', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: Coin[] = await response.json();
        if (!cancelled) {
          setCoins(data);
          setError(null);
        }
      } catch {
        if (!cancelled) setError('Could not reach the backend API. Is it running?');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const loadMeta = async () => {
      try {
        const response = await fetch('/api/meta', { cache: 'no-store' });
        if (response.ok && !cancelled) setMeta(await response.json());
      } catch {
        // Status polling is best-effort.
      }
    };

    load();
    loadMeta();

    return () => {
      cancelled = true;
    };
  }, []);

  const syncInProgress = refreshing || (meta?.sync_in_progress ?? false);
  const needsPolling = syncInProgress || coins.length === 0;

  useEffect(() => {
    if (!needsPolling) return;
    const interval = window.setInterval(() => {
      fetchMeta();
      fetchCoins();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [needsPolling, fetchCoins, fetchMeta]);

  // Detect the end of a user-triggered refresh (observe running, then done).
  useEffect(() => {
    if (!refreshing) {
      sawSyncRunning.current = false;
      return;
    }
    if (meta?.sync_in_progress) {
      sawSyncRunning.current = true;
    } else if (sawSyncRunning.current) {
      sawSyncRunning.current = false;
      setRefreshing(false);
      showToast('Data refreshed.');
    }
  }, [refreshing, meta, showToast]);

  useEffect(() => {
    if (!selectedCoin) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCoin(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCoin]);

  const handleRefresh = async () => {
    try {
      const response = await fetch('/api/refresh', { method: 'POST' });
      if (response.status === 409) {
        showToast('A sync is already running.');
        setRefreshing(true);
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setRefreshing(true);
      showToast('Refresh started. Data updates when the sync finishes.');
    } catch {
      showToast('Could not start refresh.', 'error');
    }
  };

  const distanceOf = useCallback(
    (coin: Coin) => (useAtl ? coin.distance_pct_atl : coin.distance_pct_event),
    [useAtl],
  );

  const maxDistance = useMemo(() => {
    const distances = coins
      .map(distanceOf)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return distances.length ? Math.max(...distances) : 100;
  }, [coins, distanceOf]);

  const distanceColor = useMemo(() => makeDistanceColorScale(maxDistance), [maxDistance]);

  const filteredCoins = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = query
      ? coins.filter(
          (coin) =>
            coin.symbol.toLowerCase().includes(query) || (coin.name ?? '').toLowerCase().includes(query),
        )
      : coins;

    const sorted = [...list].sort((a, b) => {
      let result = 0;
      if (sort.key === 'market_cap') {
        result = (a.market_cap ?? -1) - (b.market_cap ?? -1);
      } else if (sort.key === 'distance') {
        result = (distanceOf(a) ?? Number.MAX_VALUE) - (distanceOf(b) ?? Number.MAX_VALUE);
      } else {
        result = a.symbol.localeCompare(b.symbol);
      }
      return sort.direction === 'asc' ? result : -result;
    });

    return sorted;
  }, [coins, search, sort, distanceOf]);

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'symbol' ? 'asc' : 'desc' },
    );
  };

  const sortIndicator = (key: SortKey) => (sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <div className="container stack-default" style={{ minHeight: '100vh', position: 'relative' }}>
      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: toast.type === 'error' ? 'var(--error)' : 'var(--primary)',
            color: toast.type === 'error' ? 'var(--on-error)' : 'var(--on-primary)',
            padding: '12px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 500,
            animation: 'slideDown 0.3s ease-out',
          }}
        >
          <Activity size={18} />
          {toast.message}
        </div>
      )}

      <header className="flex-between" style={{ padding: '1rem 0', borderBottom: '1px solid var(--outline)' }}>
        <div className="flex-center" style={{ gap: '0.5rem' }}>
          <Activity color="var(--primary)" size={32} />
          <h1 className="headline-md" style={{ color: 'var(--primary)' }}>
            Dip Radar
          </h1>
        </div>
        <div className="flex-center" style={{ gap: '1rem' }}>
          {meta?.last_updated && (
            <span className="label-mono" style={{ color: 'var(--on-surface-variant)' }}>
              Updated: {new Date(meta.last_updated).toLocaleString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex-center"
            style={{
              gap: '0.5rem',
              color: 'var(--on-surface)',
              padding: '8px 16px',
              background: 'var(--surface-variant)',
              borderRadius: '8px',
              border: '1px solid var(--outline)',
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            <RefreshCw size={18} style={refreshing ? { animation: 'spin 2s linear infinite' } : undefined} />
            <span className="body-sm">{refreshing ? 'Syncing…' : 'Refresh Data'}</span>
          </button>
        </div>
      </header>

      <div className="flex-between" style={{ marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="flex-center" style={{ gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={18}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--on-surface-variant)',
              }}
            />
            <input
              type="text"
              placeholder="Search coins..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{
                background: 'var(--surface-variant)',
                border: '1px solid var(--outline)',
                color: 'var(--on-surface)',
                padding: '0.5rem 1rem 0.5rem 2.5rem',
                borderRadius: '8px',
                fontFamily: 'var(--font-inter)',
              }}
            />
          </div>
          <div
            className="flex-center"
            style={{ background: 'var(--surface-variant)', borderRadius: '8px', padding: '0.25rem' }}
          >
            <button
              onClick={() => setUseAtl(false)}
              style={{
                padding: '0.25rem 1rem',
                borderRadius: '6px',
                background: !useAtl ? 'var(--primary)' : 'transparent',
                color: !useAtl ? 'var(--on-primary)' : 'var(--on-surface)',
                fontWeight: !useAtl ? 600 : 400,
                transition: 'all 0.2s',
              }}
            >
              Since 2021
            </button>
            <button
              onClick={() => setUseAtl(true)}
              style={{
                padding: '0.25rem 1rem',
                borderRadius: '6px',
                background: useAtl ? 'var(--primary)' : 'transparent',
                color: useAtl ? 'var(--on-primary)' : 'var(--on-surface)',
                fontWeight: useAtl ? 600 : 400,
                transition: 'all 0.2s',
              }}
            >
              All Time Low
            </button>
          </div>
        </div>

        <div className="flex-center" style={{ gap: '0.5rem' }}>
          <button
            onClick={() => setViewMode('bubble')}
            aria-label="Bubble view"
            style={{
              color: viewMode === 'bubble' ? 'var(--primary)' : 'var(--on-surface-variant)',
              padding: '8px',
              background: 'var(--surface-variant)',
              borderRadius: '8px',
            }}
          >
            <Activity size={20} />
          </button>
          <button
            onClick={() => setViewMode('table')}
            aria-label="Table view"
            style={{
              color: viewMode === 'table' ? 'var(--primary)' : 'var(--on-surface-variant)',
              padding: '8px',
              background: 'var(--surface-variant)',
              borderRadius: '8px',
            }}
          >
            <List size={20} />
          </button>
        </div>
      </div>

      <main className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div className="flex-center stack-default" style={{ flex: 1, padding: '3rem 1rem' }}>
            <RefreshCw size={32} color="var(--primary)" style={{ animation: 'spin 2s linear infinite' }} />
            <p className="body-lg" style={{ color: 'var(--on-surface-variant)' }}>
              Loading radar data...
            </p>
          </div>
        ) : error ? (
          <div className="flex-center stack-default" style={{ flex: 1, padding: '3rem 1rem' }}>
            <p className="body-lg" style={{ color: 'var(--on-surface)' }}>
              {error}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                setError(null);
                fetchCoins(true);
                fetchMeta();
              }}
              style={{
                padding: '8px 16px',
                background: 'var(--primary)',
                color: 'var(--on-primary)',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              Retry
            </button>
          </div>
        ) : coins.length === 0 ? (
          <div className="flex-center stack-default" style={{ flex: 1, padding: '3rem 1rem' }}>
            <RefreshCw size={32} color="var(--secondary)" style={{ animation: 'spin 2s linear infinite' }} />
            <p className="body-lg" style={{ color: 'var(--on-surface)' }}>
              {syncInProgress ? 'Initial data sync in progress...' : 'No data yet.'}
            </p>
            <p
              className="body-sm"
              style={{ color: 'var(--on-surface-variant)', textAlign: 'center', maxWidth: '440px' }}
            >
              Historical data is fetched from Binance and CoinGecko. The first sync can take a few minutes; this page
              updates automatically when it is ready.
            </p>
          </div>
        ) : filteredCoins.length === 0 ? (
          <div className="flex-center stack-default" style={{ flex: 1, padding: '3rem 1rem' }}>
            <p className="body-lg">No coins match your search.</p>
          </div>
        ) : viewMode === 'bubble' ? (
          <BubbleChart data={filteredCoins} useAtl={useAtl} onCoinClick={setSelectedCoin} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--outline)', textAlign: 'left' }}>
                  <th style={{ padding: '1rem' }}>
                    <button className="label-mono" onClick={() => toggleSort('symbol')}>
                      Coin{sortIndicator('symbol')}
                    </button>
                  </th>
                  <th style={{ padding: '1rem' }} className="label-mono">
                    Price (BTC)
                  </th>
                  <th style={{ padding: '1rem' }}>
                    <button className="label-mono" onClick={() => toggleSort('distance')}>
                      Distance to Dip{sortIndicator('distance')}
                    </button>
                  </th>
                  <th style={{ padding: '1rem' }}>
                    <button className="label-mono" onClick={() => toggleSort('market_cap')}>
                      Market Cap{sortIndicator('market_cap')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCoins.map((coin) => {
                  const distance = distanceOf(coin);
                  return (
                    <tr
                      key={coin.symbol}
                      className="table-row"
                      style={{ borderBottom: '1px solid var(--surface-variant)', cursor: 'pointer' }}
                      onClick={() => setSelectedCoin(coin)}
                    >
                      <td style={{ padding: '1rem' }}>
                        <span className="flex-center" style={{ justifyContent: 'flex-start' }}>
                          {coin.logo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={coin.logo_url}
                              alt={`${coin.symbol} logo`}
                              width={24}
                              height={24}
                              loading="lazy"
                              style={{ borderRadius: '50%', marginRight: '0.5rem' }}
                            />
                          ) : (
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: '50%',
                                background: 'var(--outline)',
                                marginRight: '0.5rem',
                                display: 'inline-block',
                              }}
                            />
                          )}
                          <span className="body-sm">{coin.symbol.replace(/BTC$/, '')}</span>
                        </span>
                      </td>
                      <td style={{ padding: '1rem' }} className="label-mono">
                        {formatBtc(coin.current_price_btc)}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <span
                          className="label-mono"
                          style={{
                            background: distanceColor(distance ?? maxDistance),
                            color: '#101010',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontWeight: 600,
                          }}
                        >
                          {formatPct(distance)}
                        </span>
                      </td>
                      <td style={{ padding: '1rem' }} className="label-mono">
                        {formatUsd(coin.market_cap)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {selectedCoin && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedCoin.name ?? selectedCoin.symbol} details`}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
            padding: '1rem',
          }}
          onClick={() => setSelectedCoin(null)}
        >
          <div
            className="card stack-default"
            style={{ width: '420px', maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--outline)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex-between">
              <div className="flex-center" style={{ gap: '1rem' }}>
                {selectedCoin.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedCoin.logo_url}
                    alt={`${selectedCoin.symbol} logo`}
                    width={48}
                    height={48}
                    style={{ borderRadius: '50%' }}
                  />
                ) : (
                  <span
                    style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--outline)', display: 'inline-block' }}
                  />
                )}
                <div>
                  <h2 className="title-lg">{selectedCoin.name || selectedCoin.symbol}</h2>
                  <p className="label-mono" style={{ color: 'var(--on-surface-variant)' }}>
                    {selectedCoin.symbol}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCoin(null)}
                aria-label="Close"
                style={{
                  color: 'var(--on-surface)',
                  padding: '8px',
                  background: 'var(--surface-variant)',
                  borderRadius: '50%',
                  display: 'flex',
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                background: 'var(--surface-variant)',
                padding: '1.5rem',
                borderRadius: '8px',
                border: '1px solid var(--outline)',
              }}
            >
              <p className="body-sm" style={{ color: 'var(--on-surface-variant)', marginBottom: '4px' }}>
                Current Price
              </p>
              <p className="headline-md" style={{ color: 'var(--primary)' }}>
                {formatBtc(selectedCoin.current_price_btc)} BTC
              </p>
            </div>

            <div className="flex-between" style={{ padding: '0.5rem 0', gap: '1rem' }}>
              <div className="stack-compact">
                <p className="body-sm" style={{ color: 'var(--on-surface-variant)' }}>
                  Distance to Dip
                </p>
                <p className="title-lg" style={{ color: 'var(--secondary)' }}>
                  {formatPct(distanceOf(selectedCoin))}
                </p>
              </div>
              <div className="stack-compact" style={{ textAlign: 'right' }}>
                <p className="body-sm" style={{ color: 'var(--on-surface-variant)' }}>
                  Market Cap
                </p>
                <p className="label-mono" style={{ fontSize: '16px' }}>
                  {formatUsd(selectedCoin.market_cap)}
                </p>
              </div>
            </div>

            <div className="flex-between" style={{ padding: '0.5rem 0', gap: '1rem' }}>
              <div className="stack-compact">
                <p className="body-sm" style={{ color: 'var(--on-surface-variant)' }}>
                  Event Low
                </p>
                <p className="label-mono">{selectedCoin.event_low?.toFixed(8) ?? 'N/A'}</p>
              </div>
              <div className="stack-compact" style={{ textAlign: 'right' }}>
                <p className="body-sm" style={{ color: 'var(--on-surface-variant)' }}>
                  All-Time Low
                </p>
                <p className="label-mono">{selectedCoin.all_time_low?.toFixed(8) ?? 'N/A'}</p>
              </div>
            </div>

            <div>
              <p className="body-sm" style={{ color: 'var(--on-surface-variant)', marginBottom: '0.25rem' }}>
                Last 365 days
              </p>
              <HistoryChart symbol={selectedCoin.symbol} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
