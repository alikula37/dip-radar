'use client';

import * as d3 from 'd3';
import { X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { Kline } from '@/types';

const WIDTH = 900;
const HEIGHT = 240;
const MARGIN = { top: 16, right: 24, bottom: 28, left: 52 };
const COLORS = ['#ffd87f', '#54d7ee', '#4ade80'];
const Y_TICKS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

interface ComparePanelProps {
  symbols: string[];
  onRemove: (symbol: string) => void;
  onClear: () => void;
}

type SeriesValue = Kline[] | 'error';

interface LoadedSeries {
  symbol: string;
  color: string;
  points: { time: number; value: number; date: string }[];
}

interface HoverState {
  date: string;
  time: number;
  left: number;
  top: number;
  containerWidth: number;
  entries: { symbol: string; color: string; value: number }[];
}

export default function ComparePanel({ symbols, onRemove, onClear }: ComparePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [series, setSeries] = useState<Record<string, SeriesValue>>({});
  const [hover, setHover] = useState<HoverState | null>(null);
  const key = symbols.join(',');

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      symbols.map(async (symbol) => {
        try {
          const response = await fetch(`/api/coins/${encodeURIComponent(symbol)}/history?limit=365`, {
            cache: 'no-store',
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data: Kline[] = await response.json();
          return [symbol, data] as const;
        } catch {
          return [symbol, 'error'] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setSeries(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loaded = useMemo<LoadedSeries[]>(() => {
    return symbols
      .map((symbol, index) => ({ symbol, color: COLORS[index % COLORS.length], klines: series[symbol] }))
      .filter((entry): entry is { symbol: string; color: string; klines: Kline[] } => Array.isArray(entry.klines))
      .map((entry) => {
        const base = entry.klines[0].close || 1;
        return {
          symbol: entry.symbol,
          color: entry.color,
          points: entry.klines.map((kline) => ({
            time: new Date(kline.timestamp).getTime(),
            value: kline.close / base,
            date: kline.timestamp.slice(0, 10),
          })),
        };
      });
  }, [symbols, series]);
  const scales = useMemo(() => {
    if (loaded.length === 0) return null;

    const allTimes = loaded.flatMap((entry) => entry.points.map((point) => point.time));
    const allValues = loaded.flatMap((entry) => entry.points.map((point) => point.value));
    const [minValue, maxValue] = d3.extent(allValues) as [number, number];

    const x = d3
      .scaleTime()
      .domain(d3.extent(allTimes) as [number, number])
      .range([MARGIN.left, WIDTH - MARGIN.right]);

    // Log scale keeps both a flat line and a 100x spike readable.
    const y = d3
      .scaleLog()
      .domain([Math.max(minValue * 0.9, 0.01), maxValue * 1.1])
      .range([HEIGHT - MARGIN.bottom, MARGIN.top]);

    const line = d3
      .line<{ time: number; value: number }>()
      .x((point) => x(point.time))
      .y((point) => y(point.value))
      .curve(d3.curveMonotoneX);

    return {
      x,
      y,
      paths: loaded.map((entry) => ({ ...entry, path: line(entry.points) ?? '' })),
      yTicks: Y_TICKS.filter((tick) => tick >= y.domain()[0] && tick <= y.domain()[1]),
    };
  }, [loaded]);

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!scales || loaded.length === 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width > 0 ? WIDTH / rect.width : 1;
    const svgX = (event.clientX - rect.left) * scale;
    const target = scales.x.invert(svgX).getTime();

    const entries = loaded.map((entry) => {
      const index = d3.bisectCenter(
        entry.points.map((point) => point.time),
        target,
      );
      const point = entry.points[Math.max(0, Math.min(index, entry.points.length - 1))];
      return { symbol: entry.symbol, color: entry.color, value: point.value, time: point.time, date: point.date };
    });

    const containerRect = containerRef.current?.getBoundingClientRect();
    setHover({
      date: entries[0]?.date ?? '',
      time: entries[0]?.time ?? target,
      left: containerRect ? event.clientX - containerRect.left : 0,
      top: containerRect ? event.clientY - containerRect.top : 0,
      containerWidth: containerRect?.width ?? WIDTH,
      entries,
    });
  };

  return (
    <section className="mt-4 rounded-2xl border border-outline bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-content">Relative performance (start = 1x)</h2>
          <p className="text-[11px] text-content-muted">
            Each line starts at 1.0x; hover the chart to read exact multiples and percentage changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {symbols.map((symbol, index) => (
            <span
              key={symbol}
              className="flex items-center gap-1 rounded-full border border-outline px-2 py-0.5 font-mono text-[11px]"
              style={{ color: COLORS[index % COLORS.length] }}
            >
              {symbol}
              <button type="button" onClick={() => onRemove(symbol)} aria-label={`Remove ${symbol}`}>
                <X size={11} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-content-muted underline-offset-2 hover:text-content hover:underline"
          >
            Clear
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative">
        {!scales ? (
          <p className="py-10 text-center text-xs text-content-muted">Loading comparison…</p>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="mt-2 w-full"
            role="img"
            aria-label="Coin comparison chart"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHover(null)}
          >
            <g
              className="scatter-axis"
              transform={`translate(${MARGIN.left},0)`}
              ref={(node) => {
                if (!node) return;
                const group = d3.select(node);
                const tickValues = scales.yTicks;
                group.call(
                  d3
                    .axisLeft(scales.y)
                    .tickValues(tickValues)
                    .tickSize(-(WIDTH - MARGIN.left - MARGIN.right))
                    .tickFormat((value) => `${value}x`),
                );
              }}
            />
            <g
              className="scatter-axis"
              transform={`translate(0,${HEIGHT - MARGIN.bottom})`}
              ref={(node) => {
                if (!node) return;
                const group = d3.select(node);
                group.call(
                  d3
                    .axisBottom(scales.x)
                    .ticks(4)
                    .tickSizeOuter(0)
                    .tickFormat((value) => d3.timeFormat('%b %d')(value as Date)),
                );
              }}
            />

            {scales.paths.map((entry) => (
              <path key={entry.symbol} d={entry.path} fill="none" stroke={entry.color} strokeWidth={2} />
            ))}

            {hover && (
              <g pointerEvents="none">
                <line
                  x1={scales.x(hover.time)}
                  x2={scales.x(hover.time)}
                  y1={MARGIN.top}
                  y2={HEIGHT - MARGIN.bottom}
                  stroke="#6e6248"
                  strokeDasharray="3 3"
                />
                {hover.entries.map((entry) => (
                  <circle
                    key={entry.symbol}
                    cx={scales.x(hover.time)}
                    cy={scales.y(entry.value)}
                    r={3}
                    fill={entry.color}
                    stroke="#12100b"
                    strokeWidth={1}
                  />
                ))}
              </g>
            )}
          </svg>
        )}

        {hover && (
          <div
            data-testid="compare-tooltip"
            className="pointer-events-none absolute z-20 w-52 rounded-xl border border-outline bg-surface/95 p-3 shadow-2xl backdrop-blur"
            style={{
              left: Math.min(hover.left + 16, Math.max(hover.containerWidth - 220, 8)),
              top: Math.max(hover.top - 12, 8),
            }}
          >
            <p className="font-mono text-[11px] text-content-muted">{hover.date}</p>
            <ul className="mt-1.5 space-y-1">
              {hover.entries.map((entry) => {
                const change = (entry.value - 1) * 100;
                const sign = change > 0 ? '+' : '';
                return (
                  <li key={entry.symbol} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1.5 font-mono" style={{ color: entry.color }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                      {entry.symbol}
                    </span>
                    <span className="font-mono text-content">
                      {entry.value.toFixed(2)}x
                      <span className={change >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                        {' '}
                        ({sign}
                        {change.toFixed(1)}%)
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
