'use client';

import * as d3 from 'd3';
import React, { useEffect, useMemo, useState } from 'react';

import { formatBtcValue } from '@/lib/colors';
import type { Kline } from '@/types';

const WIDTH = 360;
const HEIGHT = 150;
const MARGIN = { top: 10, right: 10, bottom: 20, left: 10 };

interface ChartState {
  symbol: string;
  klines: Kline[] | null;
  failed: boolean;
}

export default function HistoryChart({ symbol }: { symbol: string }) {
  const [state, setState] = useState<ChartState | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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

  const chart = useMemo(() => {
    if (!current?.klines || current.klines.length === 0) return null;

    const klines = current.klines;
    const times = klines.map((kline) => new Date(kline.timestamp).getTime());
    const x = d3
      .scaleTime()
      .domain([times[0], times[times.length - 1]])
      .range([MARGIN.left, WIDTH - MARGIN.right]);

    const [minClose, maxClose] = d3.extent(klines, (kline) => kline.close) as [number, number];
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

    return { klines, times, x, y, area: area(klines) ?? '', line: line(klines) ?? '' };
  }, [current]);

  const updateHoverFromClientX = (element: SVGSVGElement, clientX: number) => {
    if (!chart) return;
    const rect = element.getBoundingClientRect();
    const scale = rect.width > 0 ? WIDTH / rect.width : 1;
    const svgX = (clientX - rect.left) * scale;
    const target = chart.x.invert(svgX).getTime();
    setHoverIndex(d3.bisectCenter(chart.times, target));
  };

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    updateHoverFromClientX(event.currentTarget, event.clientX);
  };

  const handleTouch = (event: React.TouchEvent<SVGSVGElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    updateHoverFromClientX(event.currentTarget, touch.clientX);
  };

  if (current?.failed) {
    return <p className="text-xs text-content-muted">Price history unavailable.</p>;
  }

  if (!chart) {
    return <p className="text-xs text-content-muted">Loading price history…</p>;
  }

  const hovered =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < chart.klines.length
      ? {
          kline: chart.klines[hoverIndex],
          x: chart.x(chart.times[hoverIndex]),
          y: chart.y(chart.klines[hoverIndex].close),
        }
      : null;

  const tooltipX = hovered && hovered.x > WIDTH * 0.6 ? hovered.x - 124 : (hovered?.x ?? 0) + 8;
  const hoveredDate = hovered ? hovered.kline.timestamp.slice(0, 10) : '';

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={`${symbol} price history`}
      style={{ touchAction: 'pan-y' }}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouch}
      onTouchMove={handleTouch}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <rect width={WIDTH} height={HEIGHT} fill="transparent" />
      <path d={chart.area} fill="var(--color-accent)" opacity={0.18} />
      <path d={chart.line} fill="none" stroke="var(--color-accent)" strokeWidth={2} />

      {hovered && (
        <g pointerEvents="none">
          <line
            x1={hovered.x}
            x2={hovered.x}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke="#6e6248"
            strokeDasharray="3 3"
          />
          <circle cx={hovered.x} cy={hovered.y} r={3} fill="var(--color-accent)" stroke="#12100b" strokeWidth={1} />
          <g transform={`translate(${tooltipX},${MARGIN.top})`}>
            <rect width={116} height={36} rx={6} fill="#1a170f" stroke="#4d4533" />
            <text x={8} y={14} fontSize={9} fill="#b3a68c">
              {hoveredDate}
            </text>
            <text x={8} y={27} fontSize={10} fill="#f1e8d7" fontWeight={600}>
              {formatBtcValue(hovered.kline.close)} BTC
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
