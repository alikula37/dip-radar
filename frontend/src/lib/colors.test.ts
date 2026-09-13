import { describe, expect, it } from "vitest";

import {
  distanceLegendGradient,
  formatBtc,
  formatPct,
  formatUsd,
  formatUsdCompact,
  makeDistanceColorScale,
  percentile,
} from "./colors";

describe("formatPct", () => {
  it("adds a plus sign only for positive values", () => {
    expect(formatPct(12.345)).toBe("+12.35%");
    expect(formatPct(0)).toBe("0.00%");
    expect(formatPct(-5)).toBe("-5.00%");
  });

  it("handles missing values", () => {
    expect(formatPct(null)).toBe("N/A");
    expect(formatPct(undefined)).toBe("N/A");
    expect(formatPct(Number.NaN)).toBe("N/A");
  });
});

describe("formatUsd", () => {
  it("formats whole dollars with separators", () => {
    expect(formatUsd(1234567.89)).toBe("$1,234,568");
    expect(formatUsd(null)).toBe("N/A");
  });
});

describe("formatBtc", () => {
  it("formats satoshi precision", () => {
    expect(formatBtc(0.5)).toBe("0.50000000");
    expect(formatBtc(undefined)).toBe("N/A");
  });
});

describe("makeDistanceColorScale", () => {
  it("maps close distances to a different color than far distances", () => {
    const scale = makeDistanceColorScale(100);
    expect(scale(0)).not.toBe(scale(100));
    expect(scale(0)).toMatch(/^rgb|^#/);
  });

  it("falls back to a sane domain for invalid input", () => {
    const scale = makeDistanceColorScale(0);
    expect(scale(0)).toMatch(/^rgb|^#/);
  });

  it("clamps values beyond the domain", () => {
    const scale = makeDistanceColorScale(100);
    expect(scale(500)).toBe(scale(100));
  });
});

describe("distanceLegendGradient", () => {
  it("produces a css gradient with three stops", () => {
    const gradient = distanceLegendGradient(100);
    expect(gradient.startsWith("linear-gradient(90deg")).toBe(true);
    expect(gradient.split(",").length).toBeGreaterThanOrEqual(3);
  });
});

describe("percentile", () => {
  it("returns 0 for an empty list", () => {
    expect(percentile([], 90)).toBe(0);
  });

  it("returns the value at the requested rank", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it("interpolates between values", () => {
    expect(percentile([0, 10], 50)).toBe(5);
  });
});

describe("formatUsdCompact", () => {
  it("formats large values compactly", () => {
    expect(formatUsdCompact(1_500_000_000)).toBe("$1.5B");
    expect(formatUsdCompact(0)).toBe("N/A");
    expect(formatUsdCompact(null)).toBe("N/A");
  });
});
