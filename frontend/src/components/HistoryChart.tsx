'use client';

import * as d3 from 'd3';
import React, { useEffect, useMemo, useState } from 'react';

import type { Kline } from '@/types';

const WIDTH = 360;
const HEIGHT = 140;
const MARGIN = { top: 10, right: 8, bottom: 18, left: 8 };

interface ChartState {
  symbol: string;
  klines: Kline[] | null;
  failed: boolean;
}

export default function HistoryChart({ symbol }: { symbol: string }) {
  const [state, setState] = useState<ChartState | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/coins/${encodeURIComponent(symbol)}/history?limit=365`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: Kline[]) => {
        if (!cancelled) setState({ symbol, klines: data, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ symbol, klines: null, failed: true });
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const current = state?.symbol === symbol ? state : null;

  const paths = useMemo(() => {
    if (!current?.klines || current.klines.length === 0) return null;

    const times = current.klines.map((kline) => new Date(kline.timestamp));
    const x = d3
      .scaleTime()
      .domain(d3.extent(times) as [Date, Date])
      .range([MARGIN.left, WIDTH - MARGIN.right]);

    const [minClose, maxClose] = d3.extent(current.klines, (kline) => kline.close) as [number, number];
    const padding = (maxClose - minClose) * 0.1 || maxClose * 0.05 || 1;
    const y = d3
      .scaleLinear()
      .domain([Math.max(0, minClose - padding), maxClose + padding])
      .range([HEIGHT - MARGIN.bottom, MARGIN.top]);

    const area = d3
      .area<Kline>()
      .x((kline) => x(new Date(kline.timestamp)))
      .y0(HEIGHT - MARGIN.bottom)
      .y1((kline) => y(kline.close))
      .curve(d3.curveMonotoneX);

    const line = d3
      .line<Kline>()
      .x((kline) => x(new Date(kline.timestamp)))
      .y((kline) => y(kline.close))
      .curve(d3.curveMonotoneX);

    return { area: area(current.klines) ?? '', line: line(current.klines) ?? '' };
  }, [current]);

  if (current?.failed) {
    return <p className="text-xs text-content-muted">Price history unavailable.</p>;
  }

  if (!paths) {
    return <p className="text-xs text-content-muted">Loading price history…</p>;
  }

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label={`${symbol} price history`}>
      <path d={paths.area} fill="var(--color-accent)" opacity={0.18} />
      <path d={paths.line} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
    </svg>
  );
}
