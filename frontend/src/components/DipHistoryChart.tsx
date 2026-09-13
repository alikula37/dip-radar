'use client';

import * as d3 from 'd3';
import React, { useEffect, useMemo, useState } from 'react';

import { formatPct } from '@/lib/colors';
import type { DipHistoryPoint } from '@/types';

const WIDTH = 360;
const HEIGHT = 150;
const MARGIN = { top: 10, right: 10, bottom: 20, left: 10 };

interface ChartState {
  symbol: string;
  points: DipHistoryPoint[] | null;
  failed: boolean;
}

interface DipHistoryChartProps {
  symbol: string;
  limit?: number;
  marker?: string | null;
}

export default function DipHistoryChart({ symbol, limit = 365, marker = null }: DipHistoryChartProps) {
  const [state, setState] = useState<ChartState | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/coins/${encodeURIComponent(symbol)}/dip-history?limit=${limit}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: DipHistoryPoint[]) => {
        if (!cancelled) setState({ symbol, points: data, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ symbol, points: null, failed: true });
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, limit]);

  const current = state?.symbol === symbol ? state : null;

  const chart = useMemo(() => {
    if (!current?.points || current.points.length === 0) return null;

    const points = current.points;
    const times = points.map((point) => new Date(point.timestamp).getTime());
    const x = d3
      .scaleTime()
      .domain([times[0], times[times.length - 1]])
      .range([MARGIN.left, WIDTH - MARGIN.right]);

    const maxDistance = Math.max(d3.max(points, (point) => point.distance_pct_event) ?? 0, 1);
    const y = d3
      .scaleLinear()
      .domain([0, maxDistance * 1.05])
      .range([HEIGHT - MARGIN.bottom, MARGIN.top]);

    const area = d3
      .area<DipHistoryPoint>()
      .x((point) => x(new Date(point.timestamp)))
      .y0(HEIGHT - MARGIN.bottom)
      .y1((point) => y(point.distance_pct_event))
      .curve(d3.curveMonotoneX);

    const line = d3
      .line<DipHistoryPoint>()
      .x((point) => x(new Date(point.timestamp)))
      .y((point) => y(point.distance_pct_event))
      .curve(d3.curveMonotoneX);

    const markerTime = marker ? +new Date(`${marker}T00:00:00`) : null;
    const markerX =
      markerTime !== null && Number.isFinite(markerTime) && markerTime >= +x.domain()[0] && markerTime <= +x.domain()[1]
        ? x(markerTime)
        : null;

    return { points, times, x, y, area: area(points) ?? '', line: line(points) ?? '', markerX };
  }, [current, marker]);

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
    return <p className="text-xs text-content-muted">Dip history unavailable.</p>;
  }

  if (!chart) {
    return <p className="text-xs text-content-muted">Loading dip history…</p>;
  }

  const hovered =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < chart.points.length
      ? {
          point: chart.points[hoverIndex],
          x: chart.x(chart.times[hoverIndex]),
          y: chart.y(chart.points[hoverIndex].distance_pct_event),
        }
      : null;

  const tooltipX = hovered && hovered.x > WIDTH * 0.6 ? hovered.x - 124 : (hovered?.x ?? 0) + 8;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={`${symbol} dip distance`}
      style={{ touchAction: 'pan-y' }}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouch}
      onTouchMove={handleTouch}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <rect width={WIDTH} height={HEIGHT} fill="transparent" />
      <path d={chart.area} fill="#4ade80" opacity={0.15} />
      <path d={chart.line} fill="none" stroke="#4ade80" strokeWidth={2} />

      {chart.markerX !== null && (
        <line
          data-testid="dip-history-marker"
          x1={chart.markerX}
          x2={chart.markerX}
          y1={MARGIN.top}
          y2={HEIGHT - MARGIN.bottom}
          stroke="#ffd87f"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}

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
          <circle cx={hovered.x} cy={hovered.y} r={3} fill="#4ade80" stroke="#12100b" strokeWidth={1} />
          <g transform={`translate(${tooltipX},${MARGIN.top})`}>
            <rect width={116} height={36} rx={6} fill="#1a170f" stroke="#4d4533" />
            <text x={8} y={14} fontSize={9} fill="#b3a68c">
              {hovered.point.timestamp.slice(0, 10)}
            </text>
            <text x={8} y={27} fontSize={10} fill="#f1e8d7" fontWeight={600}>
              {formatPct(hovered.point.distance_pct_event)} from dip
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
