import { describe, expect, it } from "vitest";

import { formatBtc, formatPct, formatUsd, makeDistanceColorScale } from "./colors";

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
});
