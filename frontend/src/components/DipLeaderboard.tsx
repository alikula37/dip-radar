'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';

import { DistanceBadge, Segmented, TrendBadge } from '@/components/ui';
import { trendDelta, VALUATION_WINDOW_LABELS, valuationPct } from '@/lib/coins';
import { formatUsdCompact, percentile } from '@/lib/colors';
import type { Coin } from '@/types';
import type { ValuationWindow } from '@/lib/coins';

type Mode = 'closest' | 'falling' | 'cheapest' | 'basing' | 'value';

const MODE_HEADINGS: Record<Mode, { title: string; sub: string }> = {
  closest: { title: 'Closest to their dip', sub: 'sorted by distance to the low' },
  falling: { title: 'Falling fastest toward their dip', sub: 'sorted by 7-day change' },
  cheapest: { title: 'Cheapest vs their own history', sub: 'lowest valuation percentile' },
  basing: { title: 'Basing at their lows', sub: 'most days spent in the bottom quartile' },
  value: {
    title: 'Best Value Scores',
    sub: 'composite cheapness percentile (dip respect included); unscored coins sort last',
  },
};

interface DipLeaderboardProps {
  coins: Coin[];
  useAtl: boolean;
  referenceLabel: string;
  colorFor: (distance: number) => string;
  onSelect: (coin: Coin) => void;
  limit?: number;
}

export default function DipLeaderboard({
  coins,
  useAtl,
  referenceLabel,
  colorFor,
  onSelect,
  limit = 10,
}: DipLeaderboardProps) {
  const [mode, setMode] = useState<Mode>('closest');
  const [window, setWindow] = useState<ValuationWindow>(3);
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
    if (mode === 'falling') {
      return [...coins]
        .filter((coin) => trendDelta(coin, useAtl, 7) !== null)
        .sort((a, b) => (trendDelta(a, useAtl, 7) ?? Infinity) - (trendDelta(b, useAtl, 7) ?? Infinity));
    }
    if (mode === 'cheapest') {
      return [...coins]
        .filter((coin) => valuationPct(coin, window) !== null)
        .sort((a, b) => (valuationPct(a, window) ?? Infinity) - (valuationPct(b, window) ?? Infinity));
    }
    if (mode === 'value') {
      return [...coins]
        .filter((coin) => coin.value_score != null)
        .sort((a, b) => (b.value_score ?? -1) - (a.value_score ?? -1));
    }
    return [...coins]
      .filter((coin) => coin.basing_pct_90d != null)
      .sort((a, b) => (b.basing_pct_90d ?? -1) - (a.basing_pct_90d ?? -1));
  }, [coins, mode, useAtl, window, distanceOf]);

  const barDomain = useMemo(() => {
    const values = ranked
      .map((coin) => {
        if (mode === 'closest') return distanceOf(coin);
        if (mode === 'falling') return Math.abs(trendDelta(coin, useAtl, 7) ?? 0);
        if (mode === 'cheapest') return valuationPct(coin, window);
        if (mode === 'value') return 100 - (coin.value_score ?? 0);
        return coin.basing_pct_90d;
      })
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const robust = Math.max(percentile(values, 95), 5);
    if (mode === 'value') return 100;
    return mode === 'cheapest' || mode === 'basing' ? Math.min(robust, 100) || 100 : robust;
  }, [ranked, mode, useAtl, window, distanceOf]);

  const visible = expanded ? ranked : ranked.slice(0, limit);
  const metricHeader =
    mode === 'closest'
      ? 'Distance to dip'
      : mode === 'falling'
        ? '7d change'
        : mode === 'cheapest'
          ? `Valuation ${VALUATION_WINDOW_LABELS[String(window)]}`
          : mode === 'value'
            ? 'Value score'
            : 'Time at lows (90d)';

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
          <h2 className="text-sm font-semibold text-content">{MODE_HEADINGS[mode].title}</h2>
          <p className="text-[11px] text-content-muted">
            {referenceLabel} · {MODE_HEADINGS[mode].sub} · click a row for details
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'cheapest' && (
            <Segmented
              ariaLabel="Valuation window"
              value={String(window)}
              onChange={(value) => setWindow(value === 'all' ? 'all' : (Number(value) as 1 | 3))}
              options={[
                { value: '1', label: '1y' },
                { value: '3', label: '3y' },
                { value: 'all', label: 'All' },
              ]}
            />
          )}
          <Segmented
            ariaLabel="Leaderboard mode"
            value={mode}
            onChange={(value) => {
              setMode(value as Mode);
              setExpanded(false);
            }}
            options={[
              { value: 'closest', label: 'Closest' },
              { value: 'falling', label: 'Falling' },
              { value: 'cheapest', label: 'Cheapest' },
              { value: 'basing', label: 'Basing' },
              { value: 'value', label: 'Value' },
            ]}
          />
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="py-16 text-center text-sm text-content-muted">
          {mode === 'cheapest' || mode === 'basing' || mode === 'value'
            ? 'No coins have enough history for this view.'
            : 'No coins match the current filters.'}
        </p>
      ) : (
        <>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-outline text-left">
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-content-muted">Coin</th>
                <th className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-content-muted">
                  {metricHeader}
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
                  Value
                </th>
                <th className="hidden px-2 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-content-muted lg:table-cell">
                  Market cap
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((coin, index) => {
                const distance = distanceOf(coin);
                const color = colorFor(distance ?? 0);
                const pct = valuationPct(coin, window);
                const metric =
                  mode === 'closest'
                    ? (distance ?? 0)
                    : mode === 'falling'
                      ? Math.abs(trendDelta(coin, useAtl, 7) ?? 0)
                      : mode === 'cheapest'
                        ? (pct ?? 0)
                        : mode === 'value'
                          ? (coin.value_score ?? 0)
                          : (coin.basing_pct_90d ?? 0);
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
                        {mode === 'closest' && <DistanceBadge value={distance} color={color} />}
                        {mode === 'falling' && <TrendBadge value={trendDelta(coin, useAtl, 7)} />}
                        {mode === 'cheapest' && (
                          <span
                            className="inline-flex min-w-[76px] items-center justify-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold text-[#12100b]"
                            style={{ backgroundColor: color }}
                            title={`Cheaper than ${(100 - (pct ?? 0)).toFixed(0)}% of the last ${
                              VALUATION_WINDOW_LABELS[String(window)]
                            }`}
                          >
                            P{Math.round(pct ?? 0)} · {VALUATION_WINDOW_LABELS[String(window)]}
                          </span>
                        )}
                        {mode === 'basing' && (
                          <span
                            className="inline-flex min-w-[76px] items-center justify-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold text-[#12100b]"
                            style={{ backgroundColor: color }}
                            title="Share of the last 90 days spent in the bottom price quartile"
                          >
                            {Math.round(coin.basing_pct_90d ?? 0)}% at lows
                          </span>
                        )}
                        {mode === 'value' && (
                          <span
                            className="inline-flex min-w-[76px] items-center justify-center rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary"
                            title={`Value Score ${coin.value_score} — composite cheapness percentile (valuation, distance to dip, median gap, basing, range position and dip respect)`}
                          >
                            {Math.round(coin.value_score ?? 0)} · value
                          </span>
                        )}
                        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-3 sm:block">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${barWidth}%`, backgroundColor: color }}
                          />
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
                    <td className="px-2 py-2 text-right">
                      {coin.value_score == null ? (
                        <span className="font-mono text-xs text-content-muted">—</span>
                      ) : (
                        <span
                          className="inline-flex min-w-[44px] items-center justify-center rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary"
                          title={`Value score ${coin.value_score} — cheapness blended from valuation percentile, distance to dip, median gap, basing, range position and dip respect (proven bounces from the dip); trend acts only as a knife-risk penalty.`}
                        >
                          {Math.round(coin.value_score)}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-2 py-2 text-right font-mono text-xs text-content lg:table-cell">
                      {formatUsdCompact(coin.market_cap)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-3 flex items-center justify-between px-1">
            <p className="text-[11px] text-content-muted">
              {expanded ? `Showing all ${ranked.length} coins` : `Top ${visible.length} of ${ranked.length} coins`}
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
