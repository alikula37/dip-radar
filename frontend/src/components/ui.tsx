'use client';

import { ArrowDownRight, ArrowUpRight, Info, Loader2, Minus } from 'lucide-react';
import React from 'react';

import { formatTrend } from '@/lib/coins';
import { formatPct } from '@/lib/colors';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'outline' | 'ghost';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-strong',
  outline: 'border border-outline bg-surface-2 text-content hover:border-outline-strong hover:bg-surface-3',
  ghost: 'text-content-muted hover:bg-surface-2 hover:text-content',
};

export function Button({ variant = 'outline', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin', className)} />;
}

const RADAR_SIZES = { sm: 20, md: 48, lg: 168 } as const;

/**
 * Thematic loading indicator: a radar sweep discovering a dip curve.
 * Decorative SVG is hidden from screen readers; the label (or sr-only
 * "Loading…") is the single announcement.
 */
export function RadarLoader({
  size = 'md',
  label,
  className,
}: {
  size?: keyof typeof RADAR_SIZES;
  label?: string;
  className?: string;
}) {
  const dimension = RADAR_SIZES[size];
  const gradientId = React.useId();

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn('inline-flex items-center gap-3', className)}
    >
      <svg
        viewBox="0 0 200 200"
        width={dimension}
        height={dimension}
        aria-hidden="true"
        focusable="false"
        className="dip-radar shrink-0"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g fill="none" stroke="var(--color-outline)" strokeOpacity="0.6" strokeWidth="1">
          <circle cx="100" cy="100" r="80" />
          <circle cx="100" cy="100" r="52" />
          <line x1="20" y1="100" x2="180" y2="100" />
          <line x1="100" y1="20" x2="100" y2="180" />
        </g>

        <circle className="dr-echo" cx="100" cy="150" r="10" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />

        <path
          className="dr-dip"
          d="M20 70 L60 108 Q100 162 140 108 L180 70"
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={100}
        />

        <g className="dr-sweep">
          <path d="M100 100 L100 20 A80 80 0 0 1 144.8 33.7 Z" fill={`url(#${gradientId})`} />
          <line x1="100" y1="100" x2="100" y2="20" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" />
        </g>

        <circle className="dr-blip" cx="60" cy="108" r="3.5" fill="var(--color-accent)" />
        <circle className="dr-blip dr-blip-2" cx="100" cy="150" r="3.5" fill="var(--color-accent)" />
        <circle className="dr-blip dr-blip-3" cx="140" cy="108" r="3.5" fill="var(--color-accent)" />
      </svg>

      {label ? (
        <span className="text-sm text-content-muted">{label}</span>
      ) : (
        <span className="sr-only">Loading…</span>
      )}
    </span>
  );
}

/** Hover/focus tooltip: explanations without a click. */
export function Hint({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex cursor-help align-middle">
      <Info size={11} aria-hidden="true" className="text-content-muted" />
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-[90] mb-1.5 hidden w-60 -translate-x-1/2 rounded-lg border border-outline bg-surface-3 px-2.5 py-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-content shadow-xl group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  info,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  info?: string;
  accent?: 'primary' | 'positive';
}) {
  return (
    <div className="rounded-xl border border-outline bg-surface px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-content-muted">
        {label}
        {info && <Hint text={info} />}
      </p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          accent === 'primary' && 'text-primary',
          accent === 'positive' && 'text-[#4ade80]',
          !accent && 'text-content',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-content-muted">{hint}</p>}
    </div>
  );
}

export function DistanceBadge({ value, color }: { value: number | null | undefined; color: string }) {
  return (
    <span
      className="inline-flex min-w-[64px] items-center justify-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold text-[#12100b]"
      style={{ backgroundColor: color }}
    >
      {formatPct(value)}
    </span>
  );
}

export function TrendBadge({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-[11px] text-content-muted">N/A</span>;
  }

  const approaching = value < 0;
  const Icon = Math.abs(value) < 0.05 ? Minus : approaching ? ArrowDownRight : ArrowUpRight;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-xs font-semibold',
        approaching ? 'text-[#4ade80]' : 'text-[#f87171]',
      )}
      title={approaching ? 'Moving closer to its dip over 7 days' : 'Moving away from its dip over 7 days'}
    >
      <Icon size={13} />
      {formatTrend(value)}
    </span>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-lg border border-outline bg-surface-2 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              active ? 'bg-primary text-on-primary' : 'text-content-muted hover:text-content',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
