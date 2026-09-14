'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

import { DistanceBadge, Segmented, TrendBadge } from '@/components/ui';
import { trendDelta } from '@/lib/coins';
import { formatPct, formatUsdCompact, percentile } from '@/lib/colors';
import type { Coin } from '@/types';

type Mode = 'closest' | 'approaching';

interface DipLeaderboardProps {
  coins: Coin[];
  useAtl: boolean;
  referenceLabel: string;
  colorFor: (distance: number) => string;
  onSelect: (coin: Coin) => void;
  limit?: number;
}

/**
 * Answer-first hero view: ranks coins by how close they are to their dip
 * (or by how fast they are falling toward it) with the numbers that matter
 * in one scannable row.
 */
export default function DipLeaderboard({
  coins,
  useAtl,
  referenceLabel,
  colorFor,
  onSelect,
  limit = 10,
}: DipLeaderboardProps) {
  const [mode, setMode] = useState<Mode>('closest');
  const [expanded, setExpanded] = useState(false);

  const distanceOf = useCallback(
    (coin: Coin) => (useAtl ? coin.distance_pct_atl : coin.distance_pct_event) ?? null,
    [useAtl],
  );

  const ranked = useMemo(() => {
    if (mode === 'closest') {
      return [...coins]
        .filter((coin) => distanceOf(coin) !== null)
        .sort((a, b) => (distanceOf(a) ?? Infinity) - (distanceOf(b) ?? Infinity));
    }
    return [...coins]
      .filter((coin) => trendDelta(coin, useAtl, 7) !== null)
      .sort((a, b) => (trendDelta(a, useAtl, 7) ?? Infinity) - (trendDelta(b, useAtl, 7) ?? Infinity));
  }, [coins, mode, useAtl, distanceOf]);

  const barDomain = useMemo(() => {
    const values = ranked
      .map((coin) => (mode === 'closest' ? distanceOf(coin) : Math.abs(trendDelta(coin, useAtl, 7) ?? 0)))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return Math.max(percentile(values, 95), mode === 'closest' ? 25 : 5);
  }, [ranked, mode, distanceOf, useAtl]);

  const visible = expanded ? ranked : ranked.slice(0, limit);

  const dropToDip = (coin: Coin): number | null => {
    const distance = distanceOf(coin);
    const price = coin.current_price_btc;
    if (distance === null || !price) return null;
    return (distance / (100 + distance)) * 100;
  };

  return (
    <div data-testid="dip-leaderboard">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-sm font-semibold text-content">
            {mode === 'closest' ? 'Closest to their dip' : 'Falling fastest toward their dip'}
          </h2>
          <p className="text-[11px] text-content-muted">
            {referenceLabel} · sorted {mode === 'closest' ? 'by distance' : 'by 7-day change'} · click a row for
            details
          </p>
        </div>
        <Segmented
          ariaLabel="Leaderboard mode"
          value={mode}
          onChange={(value) => {
            setMode(value as Mode);
            setExpanded(false);
          }}
          options={[
            { value: 'closest', label: 'Closest' },
            { value: 'approaching', label: 'Falling' },
          ]}
        />
      </div>

      {ranked.length === 0 ? (
        <p className="py-16 text-center text-sm text-content-muted">No coins match the current filters.</p>
      ) : (
        <>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-outline text-left">
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-content-muted">Coin</th>
                <th className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-content-muted">
                  {mode === 'closest' ? 'Distance to dip' : '7d change'}
                </th>
                <th className="hidden px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-content-muted sm:table-cell">
                  To dip
                </th>
                <th className="hidden px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-content-muted md:table-cell">
                  7d
                </th>
                <th className="hidden px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-content-muted md:table-cell">
                  30d
                </th>
                <th className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-content-muted">
                  Market cap
                </th>
                <th className="hidden px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-content-muted lg:table-cell">
                  24h volume
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((coin, index) => {
                const distance = distanceOf(coin);
                const metric = mode === 'closest' ? distance ?? 0 : Math.abs(trendDelta(coin, useAtl, 7) ?? 0);
                const color = colorFor(distance ?? 0);
                const barWidth = Math.max(4, Math.min(100, (metric / barDomain) * 100));
                const drop = dropToDip(coin);

                return (
                  <tr
                    key={coin.symbol}
                    onClick={() => onSelect(coin)}
                    className="cursor-pointer border-b border-surface-3/60 transition-colors hover:bg-surface-2"
                  >
                    <td className="px-2 py-2 text-center font-mono text-[11px] text-content-muted">{index + 1}</td>
                    <td className="px-2 py-2">
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
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        {mode === 'closest' ? (
                          <DistanceBadge value={distance} color={color} />
                        ) : (
                          <TrendBadge value={trendDelta(coin, useAtl, 7)} />
                        )}
                        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-3 sm:block">
                          <div className="h-full rounded-full" style={{ width: `${barWidth}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-2 py-2 text-right font-mono text-xs text-content sm:table-cell">
                      {drop === null ? '—' : `−${drop.toFixed(1)}%`}
                    </td>
                    <td className="hidden px-2 py-2 text-right md:table-cell">
                      <TrendBadge value={trendDelta(coin, useAtl, 7)} />
                    </td>
                    <td className="hidden px-2 py-2 text-right md:table-cell">
                      <TrendBadge value={trendDelta(coin, useAtl, 30)} />
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs text-content">
                      {formatUsdCompact(coin.market_cap)}
                    </td>
                    <td className="hidden px-2 py-2 text-right font-mono text-xs text-content-muted lg:table-cell">
                      {formatUsdCompact(coin.volume_24h)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-3 flex items-center justify-between px-1">
            <p className="text-[11px] text-content-muted">
              {expanded
                ? `Showing all ${ranked.length} coins`
                : `Top ${visible.length} of ${ranked.length} coins`}
              {mode === 'closest' && ranked.length > 0 ? ` · ${formatPct(distanceOf(ranked[0]))} is the closest` : ''}
            </p>
            {ranked.length > limit && (
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="flex items-center gap-1 rounded-lg border border-outline px-2.5 py-1.5 text-[11px] font-medium text-content-muted transition-colors hover:text-content"
              >
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {expanded ? 'Show top 10' : `Show all ${ranked.length}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
