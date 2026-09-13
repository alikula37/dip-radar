import * as d3 from "d3";

const COLOR_CLOSE = "#4ade80";
const COLOR_MID = "#facc15";
const COLOR_FAR = "#f87171";

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * Green when close to the dip, red when far. The domain is clamped to a
 * robust maximum (e.g. p90) so a few extreme outliers do not wash out the
 * whole palette.
 */
export function makeDistanceColorScale(maxDistance: number) {
  const domainMax = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 100;
  return d3
    .scaleLinear<string>()
    .domain([0, domainMax * 0.45, domainMax])
    .range([COLOR_CLOSE, COLOR_MID, COLOR_FAR])
    .clamp(true);
}

export function distanceLegendGradient(maxDistance = 100): string {
  const scale = makeDistanceColorScale(maxDistance);
  return `linear-gradient(90deg, ${scale(0)}, ${scale(maxDistance * 0.45)}, ${scale(maxDistance)})`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "N/A";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [scale, suffix] of units) {
    if (value >= scale) {
      return `$${(value / scale).toFixed(2).replace(/\.?0+$/, "")}${suffix}`;
    }
  }
  return `$${value.toFixed(0)}`;
}

export function formatBtc(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return value.toFixed(8);
}

/** Compact BTC price that stays readable across many orders of magnitude. */
export function formatBtcValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  if (value === 0) return "0";
  if (value < 0.001) return value.toExponential(3);
  if (value < 1) return value.toFixed(6);
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
}
