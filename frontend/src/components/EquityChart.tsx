'use client';

import * as d3 from 'd3';
import React, { useMemo, useState } from 'react';

import type { BacktestPoint } from '@/types';

const WIDTH = 800;
const HEIGHT = 360;
const MARGIN = { top: 14, right: 16, bottom: 22, left: 54 };
const DRAWDOWN_HEIGHT = 68;
const PANEL_GAP = 26;

interface ChartPoint {
  date: Date;
  time: number;
  strategy: number;
  benchmark: number;
  drawdown: number;
}

function pct(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

/**
 * Strategy equity vs the BTC baseline (log scale) with an underwater
 * drawdown panel. Values are multiples of the starting capital.
 */
export default function EquityChart({ curve, mode }: { curve: BacktestPoint[]; mode: 'btc' | 'usd' }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (curve.length < 2) return null;

    const hasUsd = curve.every((point) => point.equity_usd !== null && point.benchmark_usd !== null);
    const useUsd = mode === 'usd' && hasUsd;

    const peaks = curve.map((_, index) =>
      Math.max(...curve.slice(0, index + 1).map((entry) => entry.equity)),
    );

    const points: ChartPoint[] = curve.map((point, index) => {
      const peak = peaks[index];
      return {
        date: new Date(point.date),
        time: new Date(point.date).getTime(),
        strategy: useUsd ? (point.equity_usd as number) : point.equity,
        benchmark: useUsd ? (point.benchmark_usd as number) : 1,
        drawdown: peak > 0 ? point.equity / peak - 1 : 0,
      };
    });

    const mainBottom = HEIGHT - MARGIN.bottom - DRAWDOWN_HEIGHT - PANEL_GAP;
    const x = d3
      .scaleTime()
      .domain([points[0].date, points[points.length - 1].date])
      .range([MARGIN.left, WIDTH - MARGIN.right]);

    const values = points.flatMap((point) => [point.strategy, point.benchmark]);
    const [min, max] = d3.extent(values) as [number, number];
    const y = d3
      .scaleLog()
      .domain([Math.max(min * 0.9, 1e-6), max * 1.1])
      .nice()
      .range([mainBottom, MARGIN.top]);

    const step = points.length > 1 ? (WIDTH - MARGIN.left - MARGIN.right) / (points.length - 1) : 0;
    const xIndex = (index: number) => MARGIN.left + index * step;

    const strategyLine =
      d3
        .line<ChartPoint>()
        .x((_, index) => xIndex(index))
        .y((point) => y(point.strategy))
        .curve(d3.curveMonotoneX)(points) ?? '';
    const benchmarkLine =
      d3
        .line<ChartPoint>()
        .x((_, index) => xIndex(index))
        .y((point) => y(point.benchmark))
        .curve(d3.curveMonotoneX)(points) ?? '';

    const drawdownLow = Math.min(...points.map((point) => point.drawdown), -0.01);
    const drawdownTop = mainBottom + PANEL_GAP;
    const drawdownBottom = HEIGHT - MARGIN.bottom;
    const drawdownY = d3.scaleLinear().domain([drawdownLow, 0]).range([drawdownBottom, drawdownTop]);
    const drawdownArea =
      d3
        .area<ChartPoint>()
        .x((_, index) => xIndex(index))
        .y0(drawdownTop)
        .y1((point) => drawdownY(point.drawdown))
        .curve(d3.curveMonotoneX)(points) ?? '';

    return {
      points,
      useUsd,
      x,
      y,
      xIndex,
      strategyLine,
      benchmarkLine,
      drawdownY,
      drawdownArea,
      drawdownTop,
      drawdownBottom,
      mainBottom,
      yTicks: y.ticks(4),
      xTicks: x.ticks(6),
    };
  }, [curve, mode]);

  if (!chart) {
    return <p className="p-6 text-center text-sm text-content-muted">Not enough data to draw the equity curve.</p>;
  }

  const updateHover = (element: SVGSVGElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    const scale = rect.width > 0 ? WIDTH / rect.width : 1;
    const svgX = (clientX - rect.left) * scale;
    const target = chart.x.invert(svgX).getTime();
    const times = chart.points.map((point) => point.time);
    setHoverIndex(d3.bisectCenter(times, target));
  };

  const hovered = hoverIndex !== null ? chart.points[hoverIndex] : null;
  const tooltipX = hovered && chart.xIndex(hoverIndex as number) > WIDTH * 0.62 ? chart.xIndex(hoverIndex as number) - 168 : (hovered ? chart.xIndex(hoverIndex as number) + 10 : 0);
  const strategyLabel = chart.useUsd ? 'Strategy (USD)' : 'Strategy (BTC)';
  const benchmarkLabel = chart.useUsd ? 'BTC (USD)' : 'Hold BTC';

  return (
    <svg
      data-testid="equity-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      role="img"
      aria-label={`Backtest equity curve in ${chart.useUsd ? 'USD' : 'BTC'}`}
      style={{ touchAction: 'pan-y' }}
      onMouseMove={(event) => updateHover(event.currentTarget, event.clientX)}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (touch) updateHover(event.currentTarget, touch.clientX);
      }}
      onTouchMove={(event) => {
        const touch = event.touches[0];
        if (touch) updateHover(event.currentTarget, touch.clientX);
      }}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <rect width={WIDTH} height={HEIGHT} fill="transparent" />

      {chart.yTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={chart.y(tick)}
            y2={chart.y(tick)}
            stroke="var(--color-outline)"
            strokeOpacity={0.35}
            strokeDasharray="3 4"
          />
          <text x={MARGIN.left - 6} y={chart.y(tick) + 3} fontSize={9} fill="var(--color-content-muted)" textAnchor="end">
            ×{tick.toFixed(2)}
          </text>
        </g>
      ))}

      {chart.xTicks.map((tick) => (
        <text
          key={tick.getTime()}
          x={chart.x(tick)}
          y={HEIGHT - 6}
          fontSize={9}
          fill="var(--color-content-muted)"
          textAnchor="middle"
        >
          {d3.timeFormat('%b %Y')(tick)}
        </text>
      ))}

      <g aria-hidden="true">
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + 22}
          y1={MARGIN.top - 2}
          y2={MARGIN.top - 2}
          stroke="var(--color-accent)"
          strokeWidth={2}
        />
        <text x={MARGIN.left + 27} y={MARGIN.top + 1} fontSize={9} fill="var(--color-content-muted)">
          {strategyLabel}
        </text>
        <line
          x1={MARGIN.left + 150}
          x2={MARGIN.left + 172}
          y1={MARGIN.top - 2}
          y2={MARGIN.top - 2}
          stroke="var(--color-content-muted)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <text x={MARGIN.left + 177} y={MARGIN.top + 1} fontSize={9} fill="var(--color-content-muted)">
          {benchmarkLabel}
        </text>
      </g>

      <path d={chart.benchmarkLine} fill="none" stroke="var(--color-content-muted)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={chart.strategyLine} fill="none" stroke="var(--color-accent)" strokeWidth={2.2} strokeLinecap="round" />

      <path d={chart.drawdownArea} fill="#f87171" opacity={0.22} />
      <line
        x1={MARGIN.left}
        x2={WIDTH - MARGIN.right}
        y1={chart.drawdownTop}
        y2={chart.drawdownTop}
        stroke="#f87171"
        strokeOpacity={0.5}
        strokeWidth={1}
      />
      <text x={MARGIN.left - 6} y={chart.drawdownTop + 4} fontSize={9} fill="#f87171" textAnchor="end">
        0%
      </text>
      <text x={MARGIN.left - 6} y={chart.drawdownBottom + 4} fontSize={9} fill="#f87171" textAnchor="end">
        {(chart.drawdownY.domain()[0] * 100).toFixed(0)}%
      </text>
      <text x={WIDTH - MARGIN.right} y={chart.drawdownTop + 10} fontSize={9} fill="#f87171" textAnchor="end">
        Drawdown
      </text>

      {hovered && hoverIndex !== null && (
        <g pointerEvents="none">
          <line
            x1={chart.xIndex(hoverIndex)}
            x2={chart.xIndex(hoverIndex)}
            y1={MARGIN.top}
            y2={chart.drawdownBottom}
            stroke="#6e6248"
            strokeDasharray="3 3"
          />
          <circle
            cx={chart.xIndex(hoverIndex)}
            cy={chart.y(hovered.strategy)}
            r={3}
            fill="var(--color-accent)"
            stroke="#12100b"
            strokeWidth={1}
          />
          <circle
            cx={chart.xIndex(hoverIndex)}
            cy={chart.y(hovered.benchmark)}
            r={2.5}
            fill="var(--color-content-muted)"
            stroke="#12100b"
            strokeWidth={1}
          />
          <g transform={`translate(${tooltipX},${MARGIN.top + 14})`}>
            <rect width={158} height={62} rx={6} fill="#1a170f" stroke="#4d4533" />
            <text x={8} y={14} fontSize={9} fill="#b3a68c">
              {hovered.date.toISOString().slice(0, 10)}
            </text>
            <text x={8} y={28} fontSize={10} fill="#f1e8d7" fontWeight={600}>
              Strategy ×{hovered.strategy.toFixed(3)} ({pct(hovered.strategy - 1, 0)})
            </text>
            <text x={8} y={41} fontSize={10} fill="#b3a68c">
              {benchmarkLabel} ×{hovered.benchmark.toFixed(3)} ({pct(hovered.benchmark - 1, 0)})
            </text>
            <text x={8} y={54} fontSize={10} fill="#f87171">
              Drawdown {pct(hovered.drawdown)}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
