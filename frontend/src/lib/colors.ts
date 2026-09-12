import * as d3 from "d3";

export function makeDistanceColorScale(maxDistance: number) {
  const max = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 100;
  // Green (close to the dip) -> red (far from the dip).
  return d3
    .scaleSequential((t: number) => d3.interpolateRdYlGn(1 - t))
    .domain([0, max]);
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

export function formatBtc(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return value.toFixed(8);
}
