'use client';

import { Star, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import HistoryChart from '@/components/HistoryChart';
import DipHistoryChart from '@/components/DipHistoryChart';
import DistributionStrip from '@/components/DistributionStrip';
import { DistanceBadge, Segmented } from '@/components/ui';
import { scoreBreakdown } from '@/lib/coins';
import { formatBtc, formatUsd, formatUsdValue } from '@/lib/colors';
import { buildCoinCardSvg, coinTweetText, copyText, downloadSvgAsPng } from '@/lib/shareCard';
import type { Coin, DipHistoryPoint } from '@/types';

interface CoinModalProps {
  coin: Coin;
  useAtl: boolean;
  colorFor: (distance: number) => string;
  onClose: () => void;
  onCompareToggle?: (coin: Coin) => void;
  isCompared?: boolean;
  onWatchToggle?: (coin: Coin) => void;
  isWatched?: boolean;
  referenceLabel?: string;
  asOf?: string | null;
}

export default function CoinModal({
  coin,
  useAtl,
  colorFor,
  onClose,
  onCompareToggle,
  isCompared = false,
  onWatchToggle,
  isWatched = false,
  referenceLabel = 'Since 2021',
  asOf = null,
}: CoinModalProps) {
  const [rangeDays, setRangeDays] = useState<'90' | '365' | '5000'>('365');
  const [currency, setCurrency] = useState<'btc' | 'usd'>('usd');
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  const shareDateLabel = asOf ? `${asOf} (as of)` : new Date().toISOString().slice(0, 10);

  const handleShareCard = async () => {
    setShareStatus('Building card…');
    try {
      let dipHistory: DipHistoryPoint[] = [];
      try {
        const response = await fetch(`/api/coins/${encodeURIComponent(coin.symbol)}/dip-history?limit=365`, {
          cache: 'no-store',
        });
        if (response.ok) dipHistory = (await response.json()) as DipHistoryPoint[];
      } catch {
        // The sparkline is optional; the card renders without it.
      }
      const svg = buildCoinCardSvg(coin, {
        dateLabel: shareDateLabel,
        referenceLabel: useAtl ? 'All-time low' : referenceLabel,
        dipHistory,
      });
      const symbol = coin.base_asset ?? coin.symbol.replace(/(USDT|BTC)$/, '');
      await downloadSvgAsPng(svg, `dip-radar-${symbol.toLowerCase()}-${asOf ?? new Date().toISOString().slice(0, 10)}.png`);
      await copyText(coinTweetText(coin));
      setShareStatus('Card downloaded · tweet text copied');
    } catch {
      setShareStatus('Could not build the card');
    }
  };

  const handleCopyTweet = async () => {
    try {
      await copyText(coinTweetText(coin));
      setShareStatus('Tweet text copied');
    } catch {
      setShareStatus('Could not copy the tweet text');
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const activeDistance = (useAtl ? coin.distance_pct_atl : coin.distance_pct_event) ?? 0;
  const label = coin.name ?? coin.symbol;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} details`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-outline bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {coin.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coin.logo_url} alt="" width={44} height={44} className="h-11 w-11 rounded-full" />
            ) : (
              <span className="h-11 w-11 rounded-full bg-surface-3" />
            )}
            <div>
              <h2 className="text-lg font-semibold text-content">{label}</h2>
              <p className="font-mono text-xs text-content-muted">{coin.symbol}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onWatchToggle && (
              <button
                type="button"
                onClick={() => onWatchToggle(coin)}
                aria-pressed={isWatched}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  isWatched
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-outline text-content-muted hover:border-outline-strong hover:text-content'
                }`}
              >
                <Star size={12} className={isWatched ? 'fill-current' : undefined} />
                {isWatched ? 'Watching' : 'Watch'}
              </button>
            )}
            {onCompareToggle && (
              <button
                type="button"
                onClick={() => onCompareToggle(coin)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  isCompared
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-outline text-content-muted hover:border-outline-strong hover:text-content'
                }`}
              >
                {isCompared ? 'Remove from compare' : 'Compare'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleShareCard()}
              className="rounded-lg border border-outline px-2.5 py-1.5 text-[11px] font-medium text-content-muted transition-colors hover:border-outline-strong hover:text-content"
              title="Download a 1200×675 report card (PNG) and copy a ready-to-post tweet with this coin's numbers"
            >
              Share card
            </button>
            <button
              type="button"
              onClick={() => void handleCopyTweet()}
              className="rounded-lg border border-outline px-2.5 py-1.5 text-[11px] font-medium text-content-muted transition-colors hover:border-outline-strong hover:text-content"
              title="Copy a ready-to-post tweet with this coin's numbers"
            >
              Tweet
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-2 text-content-muted transition-colors hover:bg-surface-2 hover:text-content"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {shareStatus && <p className="mt-2 text-[11px] text-content-muted">{shareStatus}</p>}

        <div className="mt-4 rounded-xl border border-outline bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wide text-content-muted">Current price</p>
            <Segmented
              ariaLabel="Price currency"
              value={currency}
              onChange={setCurrency}
              options={[
                { value: 'usd', label: 'USD' },
                { value: 'btc', label: 'BTC' },
              ]}
            />
          </div>
          <p data-testid="modal-price" className="mt-1 font-mono text-2xl font-semibold text-primary">
            {currency === 'usd' ? (
              formatUsdValue(coin.current_price_usd)
            ) : (
              <>
                {formatBtc(coin.current_price_btc)} <span className="text-sm">BTC</span>
              </>
            )}
          </p>
          <p className="mt-1 font-mono text-[11px] text-content-muted">
            {currency === 'usd'
              ? `${formatBtc(coin.current_price_btc)} BTC parity`
              : formatUsdValue(coin.current_price_usd)}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-outline bg-surface-2 p-3">
            <p className="text-[11px] uppercase tracking-wide text-content-muted">From {referenceLabel}</p>
            <div className="mt-1">
              <DistanceBadge value={activeDistance} color={colorFor(activeDistance)} />
            </div>
          </div>
          <div className="rounded-xl border border-outline bg-surface-2 p-3">
            <p className="text-[11px] uppercase tracking-wide text-content-muted">Market cap</p>
            <p className="mt-1 font-mono text-sm text-content">{formatUsd(coin.market_cap)}</p>
          </div>
        </div>

        <div className="mt-3 space-y-1.5 rounded-xl border border-outline bg-surface-2 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-content-muted">{referenceLabel}</span>
            <span className="font-mono text-content">{useAtl ? '' : '• '}{formatPercentValue(coin.distance_pct_event)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-content-muted">All-time low</span>
            <span className="font-mono text-content">{useAtl ? '• ' : ''}{formatPercentValue(coin.distance_pct_atl)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-content-muted">2021 low</span>
            <span className="font-mono text-content-muted">{coin.event_low?.toFixed(8) ?? 'N/A'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-content-muted">All-time low price</span>
            <span className="font-mono text-content-muted">{coin.all_time_low?.toFixed(8) ?? 'N/A'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-content-muted">24h volume</span>
            <span className="font-mono text-content-muted">{formatUsd(coin.volume_24h)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-content-muted">Listed</span>
            <span className="font-mono text-content-muted">
              {coin.listing_date ? new Date(coin.listing_date).toLocaleDateString() : 'N/A'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-content-muted">Price check</span>
            <span
              className={`font-mono ${
                coin.price_verified === false
                  ? 'text-[#f87171]'
                  : coin.price_verified === true
                    ? 'text-[#4ade80]'
                    : 'text-content-muted'
              }`}
            >
              {coin.price_verified === false
                ? `⚠ ${coin.price_deviation_pct?.toFixed(2) ?? '?'}% deviation`
                : coin.price_verified === true
                  ? '✓ verified'
                  : 'N/A'}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {coin.value_score != null && (
            <span
              className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 font-semibold text-primary"
              title={scoreBreakdown(coin)}
            >
              Value {Math.round(coin.value_score)}
            </span>
          )}
          {coin.valuation_pct_3y != null && (
            <span
              className="rounded-full border border-outline px-2 py-0.5 text-content-muted"
              title="Share of the last 3 years spent above today's price (lower = cheaper)"
            >
              P{Math.round(coin.valuation_pct_3y)} · 3y
            </span>
          )}
          {coin.median_dist_3y != null && (
            <span
              className="rounded-full border border-outline px-2 py-0.5 text-content-muted"
              title="Distance from the 3-year median close"
            >
              {coin.median_dist_3y > 0 ? '+' : ''}
              {coin.median_dist_3y.toFixed(0)}% vs median
            </span>
          )}
          {coin.range_position != null && (
            <span
              className="rounded-full border border-outline px-2 py-0.5 text-content-muted"
              title="0% = all-time low close, 100% = all-time high close"
            >
              Range {Math.round(coin.range_position * 100)}%
            </span>
          )}
          {coin.basing_pct_90d != null && (
            <span
              className="rounded-full border border-outline px-2 py-0.5 text-content-muted"
              title="Share of the last 90 days spent in the bottom price quartile"
            >
              Basing {Math.round(coin.basing_pct_90d)}%
            </span>
          )}
          {coin.dip_bounces != null && (coin.dip_bounces > 0 || coin.dip_touches) && (
            <span
              className="rounded-full border border-outline px-2 py-0.5 text-content-muted"
              title="How often the coin touched its dip (within 15%) and then rallied at least 30% within 180 days — a proven dip earns a higher Value Score, new coins earn less"
            >
              Dip bounced {coin.dip_bounces}×{coin.dip_bounce_avg != null ? ` (avg +${Math.round(coin.dip_bounce_avg)}%)` : ''}
            </span>
          )}
          {coin.days_since_atl != null && (
            <span
              className="rounded-full border border-outline px-2 py-0.5 text-content-muted"
              title="Days since the all-time low"
            >
              ATL {coin.days_since_atl}d ago
            </span>
          )}
          {coin.trend_90d_pct != null && (
            <span
              className="rounded-full border border-outline px-2 py-0.5 text-content-muted"
              title="90-day price change"
            >
              90d {coin.trend_90d_pct > 0 ? '+' : ''}
              {coin.trend_90d_pct.toFixed(0)}%
            </span>
          )}
          {coin.above_sma200 === false && (
            <span
              className="rounded-full border border-[#f87171]/60 px-2 py-0.5 text-[#f87171]"
              title="Price is below its 200-day average — the trend gate flags a possible value trap"
            >
              below 200DMA
            </span>
          )}
        </div>

        <div className="mt-4">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-content-muted">
            Where today&apos;s price sits (3y closes · BTC parity)
          </p>
          <DistributionStrip symbol={coin.symbol} currentPrice={coin.current_price_btc} />
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wide text-content-muted">
              Price history ({currency.toUpperCase()})
            </p>
            <Segmented
              ariaLabel="History range"
              value={rangeDays}
              onChange={setRangeDays}
              options={[
                { value: '90', label: '90d' },
                { value: '365', label: '1y' },
                { value: '5000', label: 'All' },
              ]}
            />
          </div>
          <HistoryChart symbol={coin.symbol} limit={Number(rangeDays)} marker={asOf} vs={currency} />
        </div>

        <div className="mt-4">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-content-muted">
            Distance from dip (BTC parity)
          </p>
          <DipHistoryChart symbol={coin.symbol} limit={Number(rangeDays)} marker={asOf} />
        </div>
      </div>
    </div>
  );
}

function formatPercentValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
  return `+${value.toFixed(2)}%`;
}
