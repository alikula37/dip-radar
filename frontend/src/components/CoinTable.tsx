'use client';

import React from 'react';

import { DistanceBadge } from '@/components/ui';
import { formatBtc, formatUsd, formatUsdCompact } from '@/lib/colors';
import type { Coin } from '@/types';

export type SortKey = 'symbol' | 'distance' | 'market_cap' | 'volume_24h';
export type SortDirection = 'asc' | 'desc';

interface CoinTableProps {
  coins: Coin[];
  useAtl: boolean;
  colorFor: (distance: number) => string;
  sort: { key: SortKey; direction: SortDirection };
  onToggleSort: (key: SortKey) => void;
  onSelect: (coin: Coin) => void;
}

const COLUMNS: { key: SortKey | null; label: string; align?: 'right' }[] = [
  { key: 'symbol', label: 'Coin' },
  { key: null, label: 'Price (BTC)', align: 'right' },
  { key: 'distance', label: 'Distance to dip' },
  { key: 'market_cap', label: 'Market cap', align: 'right' },
  { key: 'volume_24h', label: '24h volume', align: 'right' },
];

export default function CoinTable({ coins, useAtl, colorFor, sort, onToggleSort, onSelect }: CoinTableProps) {
  const distanceOf = (coin: Coin) => (useAtl ? coin.distance_pct_atl : coin.distance_pct_event);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-outline text-left">
            {COLUMNS.map((column) => (
              <th
                key={column.label}
                className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-content-muted ${
                  column.align === 'right' ? 'text-right' : ''
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
                      <p className="truncate text-sm text-content">
                        {coin.base_asset ?? coin.symbol.replace(/BTC$/, '')}
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
                <td className="px-3 py-2 text-right font-mono text-xs text-content">
                  {formatUsd(coin.market_cap)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-content-muted">
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
