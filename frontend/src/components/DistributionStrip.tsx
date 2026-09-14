'use client';

import React, { useEffect, useState } from 'react';

import type { Kline } from '@/types';

const WIDTH = 360;
const HEIGHT = 64;

interface DistributionStripProps {
  symbol: string;
  currentPrice: number | null;
}

interface StripState {
  symbol: string;
  closes: number[] | null;
  failed: boolean;
}

/**
 * Horizontal strip showing where today's price sits inside the 3-year
 * close distribution (P05–P95 now spans the full band).
 */
export default function DistributionStrip({ symbol, currentPrice }: DistributionStripProps) {
  const [state, setState] = useState<StripState | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/coins/${encodeURIComponent(symbol)}/history?limit=1095`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: Kline[]) => {
        if (!cancelled) setState({ symbol, closes: data.map((kline) => kline.close), failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ symbol, closes: null, failed: true });
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const current = state?.symbol === symbol ? state : null;
  const closes = current?.closes ?? null;

  if (current?.failed) {
    return <p className="text-xs text-content-muted">Distribution unavailable.</p>;
  }
  if (!closes) {
    return <p className="text-xs text-content-muted">Loading distribution…</p>;
  }
  if (closes.length < 30) {
    return <p className="text-xs text-content-muted">Not enough history for a distribution.</p>;
  }

  const sorted = [...closes].sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p05 = quantile(0.05);
  const p25 = quantile(0.25);
  const p50 = quantile(0.5);
  const p75 = quantile(0.75);
  const p95 = quantile(0.95);

  const logMin = Math.log(Math.max(min, 1e-12));
  const logMax = Math.log(Math.max(max, 1e-11));
  const scale = (value: number) => {
    if (logMax <= logMin) return 0.5;
    const clamped = Math.min(Math.max(value, min), max);
    return (Math.log(Math.max(clamped, 1e-12)) - logMin) / (logMax - logMin);
  };
  const x = (value: number) => 10 + scale(value) * (WIDTH - 20);

  const hasCurrent = typeof currentPrice === 'number' && currentPrice > 0;
  const currentX = hasCurrent ? x(currentPrice) : null;
  const percentile =
    hasCurrent && closes.length > 0
      ? Math.round((100 * closes.filter((close) => close <= (currentPrice as number)).length) / closes.length)
      : null;

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label={`${symbol} price distribution`}>
        <line x1={x(p05)} x2={x(p95)} y1={34} y2={34} stroke="#4d4533" strokeWidth={2} strokeLinecap="round" />
        <line x1={x(p25)} x2={x(p75)} y1={34} y2={34} stroke="#6e6248" strokeWidth={10} strokeLinecap="round" />
        <line x1={x(p50)} x2={x(p50)} y1={24} y2={44} stroke="#b3a68c" strokeWidth={2} />
        {currentX !== null && (
          <g>
            <circle cx={currentX} cy={34} r={5} fill="#ffd87f" stroke="#12100b" strokeWidth={1.5} />
            <text x={Math.min(Math.max(currentX, 26), WIDTH - 26)} y={14} textAnchor="middle" fontSize={9} fill="#ffd87f">
              You are here{percentile !== null ? ` · P${percentile}` : ''}
            </text>
          </g>
        )}
        <text x={10} y={HEIGHT - 4} fontSize={8} fill="#b3a68c">
          P05
        </text>
        <text x={WIDTH - 10} y={HEIGHT - 4} fontSize={8} fill="#b3a68c" textAnchor="end">
          P95
        </text>
      </svg>
      <p className="text-[10px] text-content-muted">
        Thick band = middle 50% of the last 3 years&apos; daily closes; thin line = P05–P95.
      </p>
    </div>
  );
}
