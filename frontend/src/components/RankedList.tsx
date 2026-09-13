'use client';

import React, { useCallback, useMemo, useState } from 'react';

import { DistanceBadge, Segmented, TrendBadge } from '@/components/ui';
import { trendDelta } from '@/lib/coins';
import { formatUsdCompact } from '@/lib/colors';
import type { Coin } from '@/types';

type Mode = 'closest' | 'approaching';

interface RankedListProps {
  coins: Coin[];
  useAtl: boolean;
  referenceLabel: string;
  colorFor: (distance: number) => string;
  onSelect: (coin: Coin) => void;
  limit?: number;
}

export default function RankedList({
  coins,
  useAtl,
  referenceLabel,
  colorFor,
  onSelect,
  limit = 8,
}: RankedListProps) {
  const [mode, setMode] = useState<Mode>('closest');

  const distanceOf = useCallback(
    (coin: Coin) => (useAtl ? coin.distance_pct_atl : coin.distance_pct_event) ?? null,
    [useAtl],
  );

  const ranked = useMemo(() => {
    if (mode === 'closest') {
      return coins
        .filter((coin) => distanceOf(coin) !== null)
        .sort((a, b) => (distanceOf(a) ?? Infinity) - (distanceOf(b) ?? Infinity))
        .slice(0, limit);
    }

    return coins
      .filter((coin) => trendDelta(coin, useAtl, 7) !== null)
      .sort((a, b) => (trendDelta(a, useAtl, 7) ?? Infinity) - (trendDelta(b, useAtl, 7) ?? Infinity))
      .slice(0, limit);
  }, [coins, mode, useAtl, limit, distanceOf]);

  const domain = useMemo(() => {
    if (mode === 'closest') {
      return Math.max(...ranked.map((coin) => distanceOf(coin) ?? 0), 25);
    }
    return Math.max(...ranked.map((coin) => Math.abs(trendDelta(coin, useAtl, 7) ?? 0)), 5);
  }, [ranked, mode, useAtl, distanceOf]);

  return (
    <div className="rounded-xl border border-outline bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-content">
          {mode === 'closest' ? 'Closest to dip' : 'Falling toward dip'}
        </h2>
        <span className="text-[11px] text-content-muted">{referenceLabel}</span>
      </div>

      <div className="mt-2">
        <Segmented
          ariaLabel="Ranking mode"
          value={mode}
          onChange={(value) => setMode(value as Mode)}
          options={[
            { value: 'closest', label: 'Closest' },
            { value: 'approaching', label: 'Falling' },
          ]}
        />
      </div>

      {ranked.length === 0 ? (
        <p className="mt-3 text-xs text-content-muted">No coins match the current filters.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {ranked.map((coin, index) => {
            const distance = distanceOf(coin) ?? 0;
            const trend = trendDelta(coin, useAtl, 7);
            const metric = mode === 'closest' ? distance : Math.abs(trend ?? 0);
            const color = colorFor(distance);
            const barWidth = Math.max(4, Math.min(100, (metric / domain) * 100));

            return (
              <li key={coin.symbol}>
                <button
                  type="button"
                  onClick={() => onSelect(coin)}
                  className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-4 text-center font-mono text-[11px] text-content-muted">{index + 1}</span>
                    {coin.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={coin.logo_url}
                        alt=""
                        width={20}
                        height={20}
                        loading="lazy"
                        className="h-5 w-5 rounded-full"
                      />
                    ) : (
                      <span className="h-5 w-5 rounded-full bg-surface-3" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-content">
                      {coin.base_asset ?? coin.symbol.replace(/BTC$/, '')}
                      <span className="ml-1 text-[11px] text-content-muted">{formatUsdCompact(coin.market_cap)}</span>
                    </span>
                    {mode === 'closest' ? (
                      <DistanceBadge value={distance} color={color} />
                    ) : (
                      <TrendBadge value={trend} />
                    )}
                  </div>
                  <div className="mt-1 ml-6 h-1 rounded-full bg-surface-3">
                    <div className="h-1 rounded-full" style={{ width: `${barWidth}%`, backgroundColor: color }} />
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-content-muted">
        {mode === 'closest'
          ? 'Lower is closer to the historical bottom. Click a coin for details.'
          : 'Biggest 7-day drops toward the dip come first. Click a coin for details.'}
      </p>
    </div>
  );
}
