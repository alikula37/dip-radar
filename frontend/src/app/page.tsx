'use client';

import React, { useEffect, useState } from 'react';
import BubbleChart from '@/components/BubbleChart';
import { Search, RefreshCw, List, Activity } from 'lucide-react';

interface Coin {
  symbol: string;
  name: string;
  logo_url: string;
  current_price_btc: number;
  distance_pct_event: number;
  distance_pct_atl: number;
  bubble_size_event: number;
  bubble_size_atl: number;
  market_cap: number;
  volume_24h: number;
}

export default function Home() {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [loading, setLoading] = useState(true);
  const [useAtl, setUseAtl] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'bubble' | 'table'>('bubble');
  const [selectedCoin, setSelectedCoin] = useState<Coin | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'info' | 'error' } | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/coins`);
      const data = await res.json();
      setCoins(data);
    } catch (error) {
      console.error("Failed to fetch coins", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Polling if no coins are loaded yet (initial sync)
  useEffect(() => {
    if (!loading && coins.length === 0) {
      const interval = setInterval(() => {
        fetchData();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [loading, coins.length]);

  const showToast = (message: string, type: 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleRefresh = async () => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/refresh`, { method: 'POST' });
      showToast('Refresh started in background. Data will update shortly.');
    } catch (error) {
      console.error("Failed to refresh", error);
      showToast('Failed to start refresh.', 'error');
    }
  };

  const filteredCoins = coins.filter(c =>
    c.symbol.toLowerCase().includes(search.toLowerCase()) ||
    (c.name && c.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="container stack-default" style={{ minHeight: '100vh', position: 'relative' }}>
      {toast && (
        <div style={{
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
          animation: 'slideDown 0.3s ease-out'
        }}>
          <Activity size={18} />
          {toast.message}
        </div>
      )}

      <header className="flex-between" style={{ padding: '1rem 0', borderBottom: '1px solid var(--outline)' }}>
        <div className="flex-center" style={{ gap: '0.5rem' }}>
          <Activity color="var(--primary)" size={32} />
          <h1 className="headline-md" style={{ color: 'var(--primary)' }}>Dip Radar</h1>
        </div>
        <div className="flex-center" style={{ gap: '1rem' }}>
          <button onClick={handleRefresh} className="flex-center" style={{ gap: '0.5rem', color: 'var(--on-surface)', padding: '8px 16px', background: 'var(--surface-variant)', borderRadius: '8px', border: '1px solid var(--outline)' }}>
            <RefreshCw size={18} />
            <span className="body-sm">Refresh Data</span>
          </button>
        </div>
      </header>

      <div className="flex-between" style={{ marginTop: '1rem' }}>
        <div className="flex-center" style={{ gap: '1rem' }}>
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--on-surface-variant)' }} />
            <input
              type="text"
              placeholder="Search coins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'var(--surface-variant)',
                border: '1px solid var(--outline)',
                color: 'var(--on-surface)',
                padding: '0.5rem 1rem 0.5rem 2.5rem',
                borderRadius: '8px',
                fontFamily: 'var(--font-inter)'
              }}
            />
          </div>
          <div className="flex-center" style={{ background: 'var(--surface-variant)', borderRadius: '8px', padding: '0.25rem' }}>
            <button
              onClick={() => setUseAtl(false)}
              style={{
                padding: '0.25rem 1rem',
                borderRadius: '6px',
                background: !useAtl ? 'var(--primary)' : 'transparent',
                color: !useAtl ? 'var(--on-primary)' : 'var(--on-surface)',
                fontWeight: !useAtl ? 600 : 400,
                transition: 'all 0.2s'
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
                transition: 'all 0.2s'
              }}
            >
              All Time Low
            </button>
          </div>
        </div>

        <div className="flex-center" style={{ gap: '0.5rem' }}>
          <button
            onClick={() => setViewMode('bubble')}
            style={{ color: viewMode === 'bubble' ? 'var(--primary)' : 'var(--on-surface-variant)', padding: '8px', background: 'var(--surface-variant)', borderRadius: '8px' }}
          >
            <Activity size={20} />
          </button>
          <button
            onClick={() => setViewMode('table')}
            style={{ color: viewMode === 'table' ? 'var(--primary)' : 'var(--on-surface-variant)', padding: '8px', background: 'var(--surface-variant)', borderRadius: '8px' }}
          >
            <List size={20} />
          </button>
        </div>
      </div>

      <main className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div className="flex-center stack-default" style={{ flex: 1 }}>
            <RefreshCw size={32} color="var(--primary)" style={{ animation: 'spin 2s linear infinite' }} />
            <p className="body-lg" style={{ color: 'var(--on-surface-variant)' }}>Loading radar data...</p>
          </div>
        ) : coins.length === 0 ? (
          <div className="flex-center stack-default" style={{ flex: 1 }}>
            <RefreshCw size={32} color="var(--secondary)" style={{ animation: 'spin 2s linear infinite' }} />
            <p className="body-lg" style={{ color: 'var(--on-surface)' }}>Initial data sync in progress...</p>
            <p className="body-sm" style={{ color: 'var(--on-surface-variant)', textAlign: 'center', maxWidth: '400px' }}>
              Fetching historical data from Binance and CoinGecko. This may take a few minutes. The page will automatically update when data is ready.
            </p>
          </div>
        ) : viewMode === 'bubble' ? (
          <BubbleChart data={filteredCoins} useAtl={useAtl} onCoinClick={setSelectedCoin} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--outline)', textAlign: 'left' }}>
                  <th style={{ padding: '1rem' }} className="label-mono">Coin</th>
                  <th style={{ padding: '1rem' }} className="label-mono">Price (BTC)</th>
                  <th style={{ padding: '1rem' }} className="label-mono">Distance to Dip</th>
                  <th style={{ padding: '1rem' }} className="label-mono">Market Cap</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoins.map(c => (
                  <tr key={c.symbol} style={{ borderBottom: '1px solid var(--surface-variant)', cursor: 'pointer' }} onClick={() => setSelectedCoin(c)}>
                    <td style={{ padding: '1rem' }} className="flex-center">
                      {c.logo_url ? <img src={c.logo_url} width={24} height={24} style={{ borderRadius: '50%', marginRight: '0.5rem' }} /> : <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--outline)', marginRight: '0.5rem' }} />}
                      <span className="body-sm">{c.symbol.replace('BTC', '')}</span>
                    </td>
                    <td style={{ padding: '1rem' }} className="label-mono">{c.current_price_btc?.toFixed(8)}</td>
                    <td style={{ padding: '1rem', color: 'var(--secondary)' }} className="label-mono">
                      +{useAtl ? c.distance_pct_atl?.toFixed(2) : c.distance_pct_event?.toFixed(2)}%
                    </td>
                    <td style={{ padding: '1rem' }} className="label-mono">${c.market_cap?.toLocaleString() || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {selectedCoin && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, backdropFilter: 'blur(4px)'
        }} onClick={() => setSelectedCoin(null)}>
          <div className="card stack-default" style={{ width: '400px', background: 'var(--surface)', border: '1px solid var(--outline)' }} onClick={e => e.stopPropagation()}>
            <div className="flex-between">
              <div className="flex-center" style={{ gap: '1rem' }}>
                {selectedCoin.logo_url ? <img src={selectedCoin.logo_url} width={48} height={48} style={{ borderRadius: '50%' }} /> : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--outline)' }} />}
                <div>
                  <h2 className="title-lg">{selectedCoin.name || selectedCoin.symbol}</h2>
                  <p className="label-mono" style={{ color: 'var(--on-surface-variant)' }}>{selectedCoin.symbol}</p>
                </div>
              </div>
              <button onClick={() => setSelectedCoin(null)} style={{ color: 'var(--on-surface)', padding: '8px', background: 'var(--surface-variant)', borderRadius: '50%' }}>✕</button>
            </div>

            <div style={{ background: 'var(--surface-variant)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--outline)' }}>
              <p className="body-sm" style={{ color: 'var(--on-surface-variant)', marginBottom: '4px' }}>Current Price</p>
              <p className="headline-md" style={{ color: 'var(--primary)' }}>{selectedCoin.current_price_btc?.toFixed(8)} BTC</p>
            </div>

            <div className="flex-between" style={{ padding: '0.5rem 0' }}>
              <div className="stack-compact">
                <p className="body-sm" style={{ color: 'var(--on-surface-variant)' }}>Distance to Dip</p>
                <p className="title-lg" style={{ color: 'var(--secondary)' }}>
                  +{useAtl ? selectedCoin.distance_pct_atl?.toFixed(2) : selectedCoin.distance_pct_event?.toFixed(2)}%
                </p>
              </div>
              <div className="stack-compact" style={{ textAlign: 'right' }}>
                <p className="body-sm" style={{ color: 'var(--on-surface-variant)' }}>Market Cap</p>
                <p className="label-mono" style={{ fontSize: '16px' }}>${selectedCoin.market_cap?.toLocaleString() || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes slideDown {
          from { transform: translate(-50%, -100%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}} />
    </div>
  );
}
