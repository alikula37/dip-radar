'use client';

import { AlertTriangle, Star } from 'lucide-react';
import React from 'react';

import { DistanceBadge, TrendBadge } from '@/components/ui';
import { scoreBreakdown, trendDelta } from '@/lib/coins';
import { formatBtc, formatUsd, formatUsdCompact } from '@/lib/colors';
import type { Coin } from '@/types';

export type SortKey =
  | 'symbol'
  | 'distance'
  | 'trend_7d'
  | 'market_cap'
  | 'volume_24h'
  | 'value_score'
  | 'valuation_3y'
  | 'range_position';
export type SortDirection = 'asc' | 'desc';

interface CoinTableProps {
  coins: Coin[];
  useAtl: boolean;
  colorFor: (distance: number) => string;
  sort: { key: SortKey; direction: SortDirection };
  onToggleSort: (key: SortKey) => void;
  onSelect: (coin: Coin) => void;
  watchedSymbols: Set<string>;
  onToggleWatch: (coin: Coin) => void;
}

const COLUMNS: { key: SortKey | null; label: string; align?: 'right'; hideBelow?: 'md' | 'lg' }[] = [
  { key: 'symbol', label: 'Coin' },
  { key: null, label: 'Price (BTC)', align: 'right' },
  { key: 'distance', label: 'Distance to dip' },
  { key: 'trend_7d', label: '7d trend' },
  { key: 'value_score', label: 'Value', align: 'right' },
  { key: 'valuation_3y', label: '3y pct', align: 'right', hideBelow: 'md' },
  { key: 'range_position', label: 'Range pos', align: 'right', hideBelow: 'md' },
  { key: 'market_cap', label: 'Market cap', align: 'right' },
  { key: 'volume_24h', label: '24h volume', align: 'right', hideBelow: 'lg' },
];

export default function CoinTable({
  coins,
  useAtl,
  colorFor,
  sort,
  onToggleSort,
  onSelect,
  watchedSymbols,
  onToggleWatch,
}: CoinTableProps) {
  const distanceOf = (coin: Coin) => (useAtl ? coin.distance_pct_atl : coin.distance_pct_event);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-outline text-left">
            <th className="w-8 px-2 py-2" aria-label="Watchlist" />
            {COLUMNS.map((column) => (
              <th
                key={column.label}
                className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-content-muted ${
                  column.align === 'right' ? 'text-right' : ''
                } ${column.hideBelow === 'md' ? 'hidden md:table-cell' : ''} ${
                  column.hideBelow === 'lg' ? 'hidden lg:table-cell' : ''
                }`}
              >
                {column.key ? (
                  <button
                    type="button"
                    onClick={() => onToggleSort(column.key as SortKey)}
                    className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-content"
                  >
                    {column.label}
                    {sort.key === column.key ? <span>{sort.direction === 'asc' ? '↑' : '↓'}</span> : null}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coins.map((coin) => {
            const distance = distanceOf(coin);
            return (
              <tr
                key={coin.symbol}
                onClick={() => onSelect(coin)}
                className="cursor-pointer border-b border-surface-3/60 transition-colors hover:bg-surface-2"
              >
                <td className="px-2 py-2">
                  <button
                    type="button"
                    aria-label={
                      watchedSymbols.has(coin.symbol)
                        ? `Remove ${coin.symbol} from watchlist`
                        : `Add ${coin.symbol} to watchlist`
                    }
                    aria-pressed={watchedSymbols.has(coin.symbol)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleWatch(coin);
                    }}
                    className="rounded-full p-1 transition-colors hover:bg-surface-3"
                  >
                    <Star
                      size={14}
                      className={watchedSymbols.has(coin.symbol) ? 'fill-primary text-primary' : 'text-content-muted'}
                    />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {coin.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={coin.logo_url}
                        alt=""
                        width={22}
                        height={22}
                        loading="lazy"
                        className="h-[22px] w-[22px] rounded-full"
                      />
                    ) : (
                      <span className="h-[22px] w-[22px] rounded-full bg-surface-3" />
                    )}
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 truncate text-sm text-content">
                        {coin.base_asset ?? coin.symbol.replace(/BTC$/, '')}
                        {coin.price_verified === false && (
                          <AlertTriangle
                            size={13}
                            className="shrink-0 text-[#f87171]"
                            aria-label={`Price differs from CoinGecko by ${coin.price_deviation_pct ?? '?'}%`}
                          />
                        )}
                      </p>
                      <p className="truncate text-[11px] text-content-muted">{coin.name ?? coin.symbol}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-content-muted">
                  {formatBtc(coin.current_price_btc)}
                </td>
                <td className="px-3 py-2">
                  <DistanceBadge value={distance} color={colorFor(distance ?? 0)} />
                </td>
                <td className="px-3 py-2">
                  <TrendBadge value={trendDelta(coin, useAtl, 7)} />
                </td>
                <td className="px-3 py-2 text-right">
                  {coin.value_score == null ? (
                    <span className="font-mono text-xs text-content-muted">—</span>
                  ) : (
                    <span
                      className="inline-flex min-w-[40px] items-center justify-center rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary"
                      title={scoreBreakdown(coin)}
                    >
                      {Math.round(coin.value_score)}
                    </span>
                  )}
                </td>
                <td className="hidden px-3 py-2 text-right font-mono text-xs text-content md:table-cell">
                  {coin.valuation_pct_3y == null ? '—' : `P${Math.round(coin.valuation_pct_3y)}`}
                </td>
                <td className="hidden px-3 py-2 text-right font-mono text-xs text-content md:table-cell">
                  {coin.range_position == null ? '—' : `${Math.round(coin.range_position * 100)}%`}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-content">
                  {formatUsd(coin.market_cap)}
                </td>
                <td className="hidden px-3 py-2 text-right font-mono text-xs text-content-muted lg:table-cell">
                  {formatUsdCompact(coin.volume_24h)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
