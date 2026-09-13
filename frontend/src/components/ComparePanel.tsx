'use client';

import * as d3 from 'd3';
import { X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import type { Kline } from '@/types';

const WIDTH = 900;
const HEIGHT = 220;
const MARGIN = { top: 16, right: 24, bottom: 24, left: 44 };
const COLORS = ['#ffd87f', '#54d7ee', '#4ade80'];

interface ComparePanelProps {
  symbols: string[];
  onRemove: (symbol: string) => void;
  onClear: () => void;
}

type SeriesValue = Kline[] | 'error';

export default function ComparePanel({ symbols, onRemove, onClear }: ComparePanelProps) {
  const [series, setSeries] = useState<Record<string, SeriesValue>>({});
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

  const paths = useMemo(() => {
    const loaded = symbols
      .map((symbol, index) => ({ symbol, color: COLORS[index % COLORS.length], klines: series[symbol] }))
      .filter((entry): entry is { symbol: string; color: string; klines: Kline[] } => Array.isArray(entry.klines));

    if (loaded.length === 0) return null;

    const allTimes = loaded.flatMap((entry) => entry.klines.map((kline) => +new Date(kline.timestamp)));
    const x = d3
      .scaleTime()
      .domain(d3.extent(allTimes) as [number, number])
      .range([MARGIN.left, WIDTH - MARGIN.right]);

    const normalized = loaded.map((entry) => {
      const base = entry.klines[0].close;
      return {
        ...entry,
        points: entry.klines.map((kline) => ({
          time: +new Date(kline.timestamp),
          value: base ? (kline.close / base) * 100 : 100,
        })),
      };
    });

    const values = normalized.flatMap((entry) => entry.points.map((point) => point.value));
    const y = d3
      .scaleLinear()
      .domain([Math.min(...values) * 0.98, Math.max(...values) * 1.02])
      .range([HEIGHT - MARGIN.bottom, MARGIN.top]);

    const line = d3
      .line<{ time: number; value: number }>()
      .x((point) => x(point.time))
      .y((point) => y(point.value))
      .curve(d3.curveMonotoneX);

    return normalized.map((entry) => ({
      symbol: entry.symbol,
      color: entry.color,
      path: line(entry.points) ?? '',
    }));
  }, [symbols, series]);

  return (
    <section className="mt-4 rounded-2xl border border-outline bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-content">Comparison (365d, start = 100)</h2>
          <p className="text-[11px] text-content-muted">Normalized price performance of selected coins.</p>
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

      {!paths ? (
        <p className="py-10 text-center text-xs text-content-muted">Loading comparison…</p>
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-2 w-full" role="img" aria-label="Coin comparison chart">
          {paths.map((entry) => (
            <path key={entry.symbol} d={entry.path} fill="none" stroke={entry.color} strokeWidth={2} />
          ))}
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={HEIGHT - MARGIN.bottom}
            y2={HEIGHT - MARGIN.bottom}
            stroke="#4d4533"
          />
        </svg>
      )}
    </section>
  );
}
