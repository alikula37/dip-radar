'use client';

import { Bell, Star, X } from 'lucide-react';
import React from 'react';

import { DistanceBadge } from '@/components/ui';
import { formatDate } from '@/lib/colors';
import type { Watch } from '@/types';

interface WatchlistPanelProps {
  watches: Watch[];
  useAtl: boolean;
  colorFor: (distance: number) => string;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onThresholdChange: (symbol: string, threshold: number | null) => void;
}

export default function WatchlistPanel({
  watches,
  useAtl,
  colorFor,
  onSelect,
  onRemove,
  onThresholdChange,
}: WatchlistPanelProps) {
  const distanceOf = (watch: Watch) => (useAtl ? watch.distance_pct_atl : watch.distance_pct_event) ?? null;

  return (
    <div className="rounded-xl border border-outline bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-content">
          <Star size={14} className="fill-primary text-primary" />
          Watchlist
        </h2>
        <span className="text-[11px] text-content-muted">
          {watches.length} coin{watches.length === 1 ? '' : 's'}
        </span>
      </div>

      {watches.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-content-muted">
          Star coins in the table or detail view to track them here and get threshold alerts.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {watches.map((watch) => {
            const distance = distanceOf(watch);
            return (
              <li key={watch.symbol} className="rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(watch.symbol)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {watch.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={watch.logo_url}
                        alt=""
                        width={20}
                        height={20}
                        loading="lazy"
                        className="h-5 w-5 rounded-full"
                      />
                    ) : (
                      <span className="h-5 w-5 rounded-full bg-surface-3" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-content">
                      {watch.base_asset ?? watch.symbol.replace(/BTC$/, '')}
                    </span>
                    <DistanceBadge value={distance} color={colorFor(distance ?? 0)} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${watch.symbol} from watchlist`}
                    onClick={() => onRemove(watch.symbol)}
                    className="rounded-full p-1 text-content-muted transition-colors hover:bg-surface-3 hover:text-content"
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="mt-1.5 flex items-center gap-2 pl-7 text-[11px] text-content-muted">
                  <label className="flex items-center gap-1">
                    Alert at
                    <input
                      type="number"
                      min={0}
                      step={5}
                      defaultValue={watch.threshold_pct ?? ''}
                      placeholder="20"
                      aria-label={`Alert threshold for ${watch.symbol}`}
                      onBlur={(event) => {
                        const raw = event.target.value.trim();
                        if (raw === '') {
                          onThresholdChange(watch.symbol, null);
                          return;
                        }
                        const value = Number(raw);
                        if (!Number.isFinite(value) || value < 0) return;
                        if (value !== (watch.threshold_pct ?? null)) onThresholdChange(watch.symbol, value);
                      }}
                      className="w-14 rounded border border-outline bg-surface-2 px-1.5 py-0.5 text-right font-mono text-[11px] text-content outline-none focus:border-primary"
                    />
                    %
                  </label>
                  <span className="ml-auto flex items-center gap-1">
                    <Bell size={11} />
                    {watch.last_alerted_at ? formatDate(watch.last_alerted_at) : 'no alerts yet'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
