'use client';

import * as d3 from 'd3';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { makeDistanceColorScale } from '@/lib/colors';
import type { Coin } from '@/types';

interface BubbleChartProps {
  data: Coin[];
  useAtl: boolean;
  onCoinClick: (coin: Coin) => void;
}

interface BubbleNode extends Coin, d3.SimulationNodeDatum {
  radius: number;
  distance: number;
}

export default function BubbleChart({ data, useAtl, onCoinClick }: BubbleChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onCoinClickRef = useRef(onCoinClick);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Keep the click handler fresh without restarting the simulation.
  useEffect(() => {
    onCoinClickRef.current = onCoinClick;
  }, [onCoinClick]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions((current) => {
          const width = entry.contentRect.width;
          const height = entry.contentRect.height || 600;
          if (current.width === width && current.height === height) return current;
          return { width, height };
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const maxDistance = useMemo(() => {
    const distances = data
      .map((coin) => (useAtl ? coin.distance_pct_atl : coin.distance_pct_event))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return distances.length ? Math.max(...distances) : 100;
  }, [data, useAtl]);

  const colorScale = useMemo(() => makeDistanceColorScale(maxDistance), [maxDistance]);

  const legendGradient = useMemo(
    () =>
      `linear-gradient(90deg, ${colorScale(maxDistance)}, ${colorScale(maxDistance * 0.5)}, ${colorScale(0)})`,
    [colorScale, maxDistance],
  );

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const { width, height } = dimensions;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    const nodes: BubbleNode[] = data.map((coin) => {
      const distance = (useAtl ? coin.distance_pct_atl : coin.distance_pct_event) ?? 0;
      const size = useAtl ? coin.bubble_size_atl : coin.bubble_size_event;
      return {
        ...coin,
        distance,
        radius: Math.max(6, size ?? 10),
        x: width / 2 + (Math.random() - 0.5) * width * 0.6,
        y: height / 2 + (Math.random() - 0.5) * height * 0.6,
      };
    });

    const simulation = d3
      .forceSimulation<BubbleNode>(nodes)
      .force('charge', d3.forceManyBody<BubbleNode>().strength(-30))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<BubbleNode>().radius((node) => node.radius + 2))
      .force('x', d3.forceX<BubbleNode>(width / 2).strength(0.05))
      .force('y', d3.forceY<BubbleNode>(height / 2).strength(0.05));

    const nodeGroups = svg
      .append('g')
      .selectAll<SVGGElement, BubbleNode>('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'bubble-node')
      .style('cursor', 'pointer')
      .on('click', (event, node) => {
        event.stopPropagation();
        onCoinClickRef.current(node);
      })
      .on('mouseover', function () {
        d3.select(this).select('circle').attr('stroke-width', 3);
      })
      .on('mouseout', function () {
        d3.select(this).select('circle').attr('stroke-width', 2);
      });

    nodeGroups
      .append('title')
      .text(
        (node) =>
          `${node.name ?? node.symbol} (${node.symbol})\nDistance to dip: ${node.distance.toFixed(2)}%\nMarket cap: ${
            node.market_cap ? `$${node.market_cap.toLocaleString('en-US')}` : 'N/A'
          }`,
      );

    nodeGroups
      .append('circle')
      .attr('r', (node) => node.radius)
      .style('fill', (node) => colorScale(node.distance))
      .style('stroke', 'var(--primary)')
      .style('stroke-width', 2)
      .style('transition', 'stroke-width 0.15s ease');

    nodeGroups.each(function (node) {
      const group = d3.select(this);
      const appendLabel = () => {
        group
          .append('text')
          .text(node.symbol.replace(/BTC$/, ''))
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .style('fill', 'var(--on-surface)')
          .style('font-size', node.radius > 20 ? '12px' : '9px')
          .style('font-family', 'var(--font-mono)')
          .style('pointer-events', 'none');
      };

      if (!node.logo_url || node.radius <= 15) {
        appendLabel();
        return;
      }

      const clipId = `bubble-clip-${node.symbol}`;
      defs.append('clipPath').attr('id', clipId).append('circle').attr('r', node.radius * 0.65);

      const size = node.radius * 1.3;
      group
        .append('image')
        .attr('href', node.logo_url)
        .attr('x', -size / 2)
        .attr('y', -size / 2)
        .attr('width', size)
        .attr('height', size)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('clip-path', `url(#${clipId})`)
        .style('pointer-events', 'none')
        .on('error', function () {
          d3.select(this).remove();
          appendLabel();
        });
    });

    simulation.on('tick', () => {
      nodeGroups.attr('transform', (node) => {
        node.x = Math.max(node.radius, Math.min(width - node.radius, node.x ?? width / 2));
        node.y = Math.max(node.radius, Math.min(height - node.radius, node.y ?? height / 2));
        return `translate(${node.x},${node.y})`;
      });
    });

    return () => {
      simulation.stop();
    };
  }, [data, dimensions, useAtl, colorScale]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '600px', position: 'relative' }}
      aria-label="Altcoin dip bubble chart"
    >
      <svg ref={svgRef} width="100%" height="100%" role="img" />
      <div
        className="flex-center"
        style={{
          position: 'absolute',
          bottom: '0.75rem',
          right: '0.75rem',
          gap: '0.5rem',
          background: 'rgba(23, 19, 9, 0.85)',
          border: '1px solid var(--outline)',
          borderRadius: '8px',
          padding: '0.35rem 0.6rem',
        }}
      >
        <span className="label-mono">Close to dip</span>
        <div
          style={{
            width: '90px',
            height: '10px',
            borderRadius: '999px',
            background: legendGradient,
          }}
        />
        <span className="label-mono">Far</span>
      </div>
    </div>
  );
}
