import { ArrowDownRight, ArrowUpRight, Loader2, Minus } from 'lucide-react';
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

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: 'primary' | 'positive';
}) {
  return (
    <div className="rounded-xl border border-outline bg-surface px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-content-muted">{label}</p>
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
