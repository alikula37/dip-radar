'use client';

import * as d3 from 'd3';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { TrendBadge } from '@/components/ui';
import { trendDelta } from '@/lib/coins';
import { formatPct, formatUsd, formatUsdCompact } from '@/lib/colors';
import type { Coin } from '@/types';

interface TreemapProps {
  coins: Coin[];
  useAtl: boolean;
  colorFor: (distance: number) => string;
  onCoinClick: (coin: Coin) => void;
}

interface LeafData {
  coin: Coin;
  marketCap: number;
  distance: number;
  children?: LeafData[];
}

interface Tile {
  coin: Coin;
  distance: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface HoverState {
  coin: Coin;
  distance: number;
  left: number;
  top: number;
}

export default function Treemap({ coins, useAtl, colorFor, onCoinClick }: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCoinClickRef = useRef(onCoinClick);
  const [dimensions, setDimensions] = useState({ width: 900, height: 560 });
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    onCoinClickRef.current = onCoinClick;
  }, [onCoinClick]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions((current) => {
          const width = Math.max(320, entry.contentRect.width);
          const height = Math.max(360, entry.contentRect.height || 560);
          if (current.width === width && current.height === height) return current;
          return { width, height };
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const tiles = useMemo<Tile[]>(() => {
    const leaves: LeafData[] = [];
    for (const coin of coins) {
      const marketCap = coin.market_cap ?? 0;
      const distance = (useAtl ? coin.distance_pct_atl : coin.distance_pct_event) ?? null;
      if (marketCap <= 0 || distance === null || !Number.isFinite(distance)) continue;
      leaves.push({ coin, marketCap, distance });
    }
    if (leaves.length === 0) return [];

    const { width, height } = dimensions;
    const rootData: LeafData = { coin: leaves[0].coin, marketCap: 0, distance: 0, children: leaves };
    const root = d3
      .hierarchy<LeafData>(rootData)
      .sum((node) => node.marketCap)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3.treemap<LeafData>().size([width, height]).paddingInner(2).paddingOuter(2).round(true)(root);

    return (root.leaves() as d3.HierarchyRectangularNode<LeafData>[]).map((leaf) => ({
      coin: leaf.data.coin,
      distance: leaf.data.distance,
      x0: leaf.x0,
      y0: leaf.y0,
      x1: leaf.x1,
      y1: leaf.y1,
    }));
  }, [coins, useAtl, dimensions]);

  const updateHover = (event: React.MouseEvent, tile: Tile) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ coin: tile.coin, distance: tile.distance, left: event.clientX - rect.left, top: event.clientY - rect.top });
  };

  const activeHover = hover && tiles.some((tile) => tile.coin.symbol === hover.coin.symbol) ? hover : null;

  return (
    <div ref={containerRef} className="relative h-[440px] w-full sm:h-[560px]">
      <svg
        className="h-full w-full"
        role="img"
        aria-label="Altcoin dip treemap"
        data-exportable="true"
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      >
        {tiles.map((tile) => {
          const width = tile.x1 - tile.x0;
          const height = tile.y1 - tile.y0;
          const showLabel = width > 52 && height > 20;
          const showDistance = width > 64 && height > 40;

          return (
            <g
              key={tile.coin.symbol}
              transform={`translate(${tile.x0},${tile.y0})`}
              style={{ cursor: 'pointer' }}
              onClick={() => onCoinClickRef.current(tile.coin)}
              onMouseMove={(event) => updateHover(event, tile)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                width={width}
                height={height}
                rx={4}
                fill={colorFor(tile.distance)}
                fillOpacity={0.88}
                stroke="#12100b"
                strokeWidth={1.5}
              />
              {showLabel && (
                <text
                  x={width / 2}
                  y={showDistance ? height / 2 - 4 : height / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="treemap-label"
                >
                  {tile.coin.base_asset ?? tile.coin.symbol.replace(/BTC$/, '')}
                </text>
              )}
              {showDistance && (
                <text
                  x={width / 2}
                  y={height / 2 + 12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="treemap-sub"
                >
                  {formatPct(tile.distance)}
                </text>
              )}
              <title>
                {`${tile.coin.name ?? tile.coin.symbol} · ${formatPct(tile.distance)} from dip · ${formatUsd(
                  tile.coin.market_cap,
                )}`}
              </title>
            </g>
          );
        })}
      </svg>

      {activeHover && (
        <div
          className="pointer-events-none absolute z-20 w-52 rounded-xl border border-outline bg-surface/95 p-3 shadow-2xl backdrop-blur"
          style={{
            left: Math.min(activeHover.left + 16, Math.max(dimensions.width - 220, 8)),
            top: Math.max(activeHover.top - 12, 8),
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-content">
              {activeHover.coin.name ?? activeHover.coin.symbol}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-content-muted">
              {activeHover.coin.base_asset ?? activeHover.coin.symbol}
            </span>
          </div>
          <dl className="mt-2 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <dt className="text-content-muted">Distance</dt>
              <dd className="font-mono font-semibold" style={{ color: colorFor(activeHover.distance) }}>
                {formatPct(activeHover.distance)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-content-muted">Market cap</dt>
              <dd className="font-mono">{formatUsdCompact(activeHover.coin.market_cap)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-content-muted">7d trend</dt>
              <dd>
                <TrendBadge value={trendDelta(activeHover.coin, useAtl, 7)} />
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
