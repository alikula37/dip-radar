'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface Coin {
    symbol: string;
    name: string;
    logo_url: string;
    current_price_btc: number;
    distance_pct_event: number;
    distance_pct_atl: number;
    bubble_size_event: number;
    bubble_size_atl: number;
    market_cap: number;
    volume_24h: number;
}

interface BubbleChartProps {
    data: Coin[];
    useAtl: boolean;
    onCoinClick: (coin: Coin) => void;
}

export default function BubbleChart({ data, useAtl, onCoinClick }: BubbleChartProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (let entry of entries) {
                setDimensions({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height || 600,
                });
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!svgRef.current || data.length === 0) return;

        const { width, height } = dimensions;
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        // Prepare nodes
        const nodes = data.map(d => ({
            ...d,
            radius: useAtl ? d.bubble_size_atl : d.bubble_size_event,
            x: Math.random() * width,
            y: Math.random() * height,
        }));

        // Setup simulation
        const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
            .force("charge", d3.forceManyBody().strength(5))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide().radius((d: any) => d.radius + 2))
            .force("x", d3.forceX(width / 2).strength(0.05))
            .force("y", d3.forceY(height / 2).strength(0.05));

        // Create groups for bubbles
        const nodeGroup = svg.append("g")
            .selectAll("g")
            .data(nodes)
            .enter()
            .append("g")
            .attr("class", "bubble-node")
            .style("cursor", "pointer")
            .on("click", (event, d) => onCoinClick(d as Coin));

        // Add circles
        nodeGroup.append("circle")
            .attr("r", (d: any) => d.radius)
            .style("fill", "var(--surface-variant)")
            .style("stroke", "var(--primary)")
            .style("stroke-width", 2)
            .style("transition", "all 0.2s ease");

        // Add logos or text
        nodeGroup.each(function (d: any) {
            const g = d3.select(this);
            if (d.logo_url && d.radius > 15) {
                const size = d.radius * 1.2;
                g.append("image")
                    .attr("href", d.logo_url)
                    .attr("x", -size / 2)
                    .attr("y", -size / 2)
                    .attr("width", size)
                    .attr("height", size)
                    .attr("clip-path", "circle()");
            } else {
                g.append("text")
                    .text(d.symbol.replace('BTC', ''))
                    .attr("text-anchor", "middle")
                    .attr("dy", ".3em")
                    .style("fill", "var(--on-surface)")
                    .style("font-size", d.radius > 20 ? "12px" : "8px")
                    .style("font-family", "var(--font-mono)");
            }
        });

        // Add hover effects
        nodeGroup.on("mouseover", function () {
            d3.select(this).select("circle")
                .style("stroke", "var(--secondary)")
                .style("stroke-width", 3);
        }).on("mouseout", function () {
            d3.select(this).select("circle")
                .style("stroke", "var(--primary)")
                .style("stroke-width", 2);
        });

        // Tick function
        simulation.on("tick", () => {
            nodeGroup.attr("transform", (d: any) => {
                // Boundary constraints
                d.x = Math.max(d.radius, Math.min(width - d.radius, d.x));
                d.y = Math.max(d.radius, Math.min(height - d.radius, d.y));
                return `translate(${d.x},${d.y})`;
            });
        });

        return () => {
            simulation.stop();
        };
    }, [data, dimensions, useAtl, onCoinClick]);

    return (
        <div ref={containerRef} style={{ width: '100%', height: '600px', position: 'relative' }}>
            <svg ref={svgRef} width="100%" height="100%" />
        </div>
    );
}
