'use client';

import * as d3 from 'd3';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  distanceLegendGradient,
  formatBtc,
  formatPct,
  formatUsd,
  formatUsdCompact,
  makeDistanceColorScale,
  percentile,
} from '@/lib/colors';
import type { Coin } from '@/types';

const MARGIN = { top: 28, right: 28, bottom: 48, left: 76 };
const ZONE_MIN_CAP = 50_000_000;
const ZONE_MAX_DISTANCE = 50;
const NEAR_DISTANCE = 25;
const MAX_LABELS = 14;

interface ScatterPoint {
  coin: Coin;
  distance: number;
  marketCap: number;
}

interface LabelPlacement {
  point: ScatterPoint;
  anchor: 'start' | 'end';
  width: number;
  text: string;
}

interface HoverState {
  point: ScatterPoint;
  left: number;
  top: number;
}

interface ScatterChartProps {
  coins: Coin[];
  useAtl: boolean;
  onCoinClick: (coin: Coin) => void;
}

function labelFor(point: ScatterPoint): string {
  return point.coin.base_asset ?? point.coin.symbol.replace(/BTC$/, '');
}

export default function ScatterChart({ coins, useAtl, onCoinClick }: ScatterChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
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

  const points = useMemo<ScatterPoint[]>(() => {
    const result: ScatterPoint[] = [];
    for (const coin of coins) {
      const marketCap = coin.market_cap ?? 0;
      const distance = (useAtl ? coin.distance_pct_atl : coin.distance_pct_event) ?? null;
      if (marketCap <= 0 || distance === null || !Number.isFinite(distance)) continue;
      result.push({ coin, marketCap, distance });
    }
    return result;
  }, [coins, useAtl]);

  const hiddenCount = coins.length - points.length;

  const robustMax = useMemo(() => {
    const distances = points.map((point) => point.distance);
    return Math.max(percentile(distances, 90), 25);
  }, [points]);

  const colorScale = useMemo(() => makeDistanceColorScale(robustMax), [robustMax]);
  const legendGradient = useMemo(() => distanceLegendGradient(robustMax), [robustMax]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || points.length === 0) return;

    const { width, height } = dimensions;
    const innerWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
    const innerHeight = Math.max(10, height - MARGIN.top - MARGIN.bottom);

    const caps = points.map((point) => point.marketCap);
    const distances = points.map((point) => point.distance);
    const maxDistance = Math.max(d3.max(distances) ?? 1, 1);

    const x = d3
      .scaleLog()
      .domain([Math.max((d3.min(caps) ?? 1) * 0.8, 1), (d3.max(caps) ?? 1) * 1.2])
      .range([MARGIN.left, width - MARGIN.right])
      .clamp(true);

    const y = d3
      .scaleSqrt()
      .domain([0, maxDistance])
      .range([height - MARGIN.bottom, MARGIN.top])
      .clamp(true);

    // Size emphasizes proximity to the dip: closer = bigger.
    const radius = d3
      .scaleSqrt()
      .domain([0, 1])
      .range([4, 17]);

    const closeness = (distance: number) =>
      Math.max(0, 1 - Math.min(distance, robustMax) / robustMax);

    const yTicks = [0, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000].filter(
      (value) => value <= maxDistance * 1.05,
    );

    const xAxis = d3
      .axisBottom(x)
      .ticks(5)
      .tickSize(-innerHeight)
      .tickFormat((value) => formatUsdCompact(Number(value)));

    const yAxis = d3
      .axisLeft(y)
      .tickValues(yTicks)
      .tickSize(-innerWidth)
      .tickFormat((value) => `${value}%`);

    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    const zoneGroup = svg.append('g');
    const axisGroup = svg.append('g');
    const xAxisGroup = axisGroup
      .append('g')
      .attr('class', 'scatter-axis')
      .attr('transform', `translate(0,${height - MARGIN.bottom})`);
    const yAxisGroup = axisGroup.append('g').attr('class', 'scatter-axis').attr('transform', `translate(${MARGIN.left},0)`);
    const marksGroup = svg.append('g');
    const labelsGroup = svg.append('g');
    const axisLabels = svg.append('g');

    axisLabels
      .append('text')
      .attr('x', MARGIN.left + innerWidth / 2)
      .attr('y', height - 10)
      .attr('text-anchor', 'middle')
      .attr('class', 'scatter-axis-label')
      .text('Market cap (USD, log scale)');

    axisLabels
      .append('text')
      .attr('transform', `translate(18,${MARGIN.top + innerHeight / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('class', 'scatter-axis-label')
      .text('Distance from dip (%)');

    const markSelection = marksGroup
      .selectAll<SVGCircleElement, ScatterPoint>('circle')
      .data(points)
      .join('circle')
      .attr('r', (point) => radius(closeness(point.distance)))
      .attr('fill', (point) => colorScale(point.distance))
      .attr('fill-opacity', 0.85)
      .attr('stroke', 'rgba(18,16,11,0.9)')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('click', (event, point) => {
        event.stopPropagation();
        onCoinClickRef.current(point.coin);
      })
      .on('mouseenter', function (event, point) {
        d3.select(this).attr('stroke', 'var(--color-primary)').attr('stroke-width', 2);
        updateHover(event as MouseEvent, point);
      })
      .on('mousemove', (event, point) => updateHover(event as MouseEvent, point))
      .on('mouseleave', function () {
        d3.select(this).attr('stroke', 'rgba(18,16,11,0.9)').attr('stroke-width', 1);
        setHover(null);
      });

    function updateHover(event: MouseEvent, point: ScatterPoint) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHover({ point, left: event.clientX - rect.left, top: event.clientY - rect.top });
    }

    // Greedy label placement: interesting coins first, no overlaps.
    const labelCandidates = [...points].sort((a, b) => {
      const zoneA = a.marketCap >= ZONE_MIN_CAP && a.distance <= ZONE_MAX_DISTANCE ? 1 : 0;
      const zoneB = b.marketCap >= ZONE_MIN_CAP && b.distance <= ZONE_MAX_DISTANCE ? 1 : 0;
      if (zoneA !== zoneB) return zoneB - zoneA;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.marketCap - a.marketCap;
    });

    const placements: LabelPlacement[] = [];
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];

    for (const point of labelCandidates) {
      if (placements.length >= MAX_LABELS) break;
      if (!(point.marketCap >= ZONE_MIN_CAP || point.distance <= NEAR_DISTANCE)) continue;

      const text = labelFor(point);
      const textWidth = text.length * 6.5 + 8;
      const pointX = x(point.marketCap);
      const pointY = y(point.distance);
      const boxHeight = 14;

      const candidates: { anchor: 'start' | 'end'; box: typeof boxes[number] }[] = [
        {
          anchor: 'start',
          box: { x1: pointX + 9, y1: pointY - boxHeight / 2, x2: pointX + 9 + textWidth, y2: pointY + boxHeight / 2 },
        },
        {
          anchor: 'end',
          box: { x1: pointX - 9 - textWidth, y1: pointY - boxHeight / 2, x2: pointX - 9, y2: pointY + boxHeight / 2 },
        },
      ];

      for (const candidate of candidates) {
        const { box } = candidate;
        const fits =
          box.x1 >= MARGIN.left &&
          box.x2 <= width - MARGIN.right &&
          !boxes.some((placed) => !(box.x2 < placed.x1 || box.x1 > placed.x2 || box.y2 < placed.y1 || box.y1 > placed.y2));
        if (fits) {
          boxes.push(box);
          placements.push({ point, anchor: candidate.anchor, width: textWidth, text });
          break;
        }
      }
    }

    const labelSelection = labelsGroup
      .selectAll<SVGGElement, LabelPlacement>('g')
      .data(placements)
      .join('g');

    labelSelection
      .append('rect')
      .attr('x', (placement) => (placement.anchor === 'start' ? -2 : -placement.width + 2))
      .attr('y', -9)
      .attr('width', (placement) => placement.width)
      .attr('height', 16)
      .attr('rx', 4)
      .attr('fill', 'rgba(18,16,11,0.75)');

    labelSelection
      .append('text')
      .attr('text-anchor', (placement) => placement.anchor)
      .attr('dy', '0.32em')
      .attr('class', 'scatter-label')
      .text((placement) => placement.text);

    function drawZone(xScale: d3.ScaleLogarithmic<number, number>, yScale: d3.ScalePower<number, number>) {
      zoneGroup.selectAll('*').remove();
      const zoneX = xScale(ZONE_MIN_CAP);
      const zoneY = yScale(ZONE_MAX_DISTANCE);
      const zoneWidth = Math.max(0, width - MARGIN.right - zoneX);
      const zoneHeight = Math.max(0, zoneY - MARGIN.top);

      zoneGroup
        .append('rect')
        .attr('x', zoneX)
        .attr('y', MARGIN.top)
        .attr('width', zoneWidth)
        .attr('height', zoneHeight)
        .attr('fill', '#4ade80')
        .attr('fill-opacity', 0.05)
        .attr('stroke', '#4ade80')
        .attr('stroke-opacity', 0.3)
        .attr('stroke-dasharray', '4 4');

      if (zoneWidth > 120 && zoneHeight > 24) {
        zoneGroup
          .append('text')
          .attr('x', Math.min(zoneX + 8, width - MARGIN.right - 8))
          .attr('y', MARGIN.top + 16)
          .attr('class', 'scatter-label')
          .style('fill', '#4ade80')
          .style('fill-opacity', 0.85)
          .text('Watch zone · ≥ $50M cap · ≤ 50% from dip');
      }
    }

    function positionLabels(
      xScale: d3.ScaleLogarithmic<number, number>,
      yScale: d3.ScalePower<number, number>,
    ) {
      labelSelection.attr('transform', (placement) => {
        const px = xScale(placement.point.marketCap);
        const py = yScale(placement.point.distance);
        const dx = placement.anchor === 'start' ? 7 : -7;
        return `translate(${px + dx},${py})`;
      });
    }

    function update(transform: d3.ZoomTransform) {
      const xScale = transform.rescaleX(x).clamp(true);
      const yScale = transform.rescaleY(y).clamp(true);

      xAxisGroup.call(xAxis.scale(xScale));
      yAxisGroup.call(yAxis.scale(yScale));
      drawZone(xScale, yScale);
      markSelection
        .attr('cx', (point) => xScale(point.marketCap))
        .attr('cy', (point) => yScale(point.distance));
      positionLabels(xScale, yScale);
      labelsGroup.attr('display', transform.k > 1.5 ? 'none' : null);
    }

    update(d3.zoomIdentity);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .translateExtent([
        [MARGIN.left - 60, MARGIN.top - 60],
        [width - MARGIN.right + 60, height - MARGIN.bottom + 60],
      ])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => update(event.transform));

    svg.call(zoom);

    return () => {
      svg.on('.zoom', null);
      svg.selectAll('*').remove();
    };
  }, [points, dimensions, colorScale, robustMax]);

  const activeHover = hover && points.some((point) => point.coin.symbol === hover.point.coin.symbol) ? hover : null;
  const tooltipLeft = activeHover ? Math.min(activeHover.left + 16, Math.max(dimensions.width - 240, 8)) : 0;
  const tooltipTop = activeHover ? Math.max(activeHover.top - 12, 8) : 0;

  return (
    <div ref={containerRef} className="relative h-[560px] w-full">
      <svg ref={svgRef} className="h-full w-full" role="img" aria-label="Altcoin dip scatter chart" />

      {activeHover && (
        <div
          className="pointer-events-none absolute z-20 w-60 rounded-xl border border-outline bg-surface/95 p-3 shadow-2xl backdrop-blur"
          style={{ left: tooltipLeft, top: tooltipTop }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-content">
              {activeHover.point.coin.name ?? activeHover.point.coin.symbol}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-content-muted">
              {labelFor(activeHover.point)}
            </span>
          </div>
          <dl className="mt-2 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <dt className="text-content-muted">Distance to dip</dt>
              <dd className="font-mono font-semibold" style={{ color: colorScale(activeHover.point.distance) }}>
                {formatPct(activeHover.point.distance)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-content-muted">Market cap</dt>
              <dd className="font-mono">{formatUsd(activeHover.point.marketCap)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-content-muted">24h volume</dt>
              <dd className="font-mono">{formatUsd(activeHover.point.coin.volume_24h)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-content-muted">Price</dt>
              <dd className="font-mono">{formatBtc(activeHover.point.coin.current_price_btc)} BTC</dd>
            </div>
          </dl>
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="absolute left-3 top-3 rounded-md border border-outline bg-surface/80 px-2 py-1 text-[11px] text-content-muted">
          {hiddenCount} coin{hiddenCount > 1 ? 's' : ''} hidden (no market data)
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex flex-col gap-2 rounded-xl border border-outline bg-surface/85 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2 text-[11px] text-content-muted">
          <span>Close to dip</span>
          <span className="h-2 w-24 rounded-full" style={{ background: legendGradient }} />
          <span>Far</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-content-muted">
          <svg width="52" height="20" aria-hidden="true">
            <circle cx="7" cy="10" r="3" fill="var(--color-content-muted)" opacity="0.7" />
            <circle cx="22" cy="10" r="6" fill="var(--color-content-muted)" opacity="0.7" />
            <circle cx="41" cy="10" r="9.5" fill="var(--color-content-muted)" opacity="0.7" />
          </svg>
          <span>Closer to dip = bigger</span>
        </div>
        <div className="text-[10px] text-content-muted/80">Scroll to zoom · click a bubble for details</div>
      </div>
    </div>
  );
}
