import { describe, expect, it } from "vitest";
import {
  chartSpeedFactorDefault,
  chartWindowDomain,
  chartWindowHoursDefault,
  effectiveSampleIntervalMs,
  normalizeChartSpeedFactor,
  normalizeChartWindowHours,
} from "./dashboard";

describe("chart window hours", () => {
  it("defaults and clamps the hours setting", () => {
    expect(normalizeChartWindowHours(null)).toBe(chartWindowHoursDefault);
    expect(normalizeChartWindowHours(4)).toBe(4);
    expect(normalizeChartWindowHours(0)).toBe(chartWindowHoursDefault);
    expect(normalizeChartWindowHours(200)).toBe(168);
  });

  it("builds a fixed last-N-hours domain ending at now", () => {
    const now = Date.parse("2026-11-20T12:00:00.000Z");
    const domain = chartWindowDomain(4, now);
    expect(domain.tMax).toBe(now);
    expect(domain.tMin).toBe(now - 4 * 60 * 60_000);
  });
});

describe("chart speed factor", () => {
  it("defaults and clamps to 1–9", () => {
    expect(normalizeChartSpeedFactor(null)).toBe(chartSpeedFactorDefault);
    expect(normalizeChartSpeedFactor(3)).toBe(3);
    expect(normalizeChartSpeedFactor(0)).toBe(1);
    expect(normalizeChartSpeedFactor(99)).toBe(9);
    expect(normalizeChartSpeedFactor("5")).toBe(5);
  });

  it("shortens the effective sample interval without changing the stored seconds", () => {
    expect(effectiveSampleIntervalMs(60, 1)).toBe(60_000);
    expect(effectiveSampleIntervalMs(60, 2)).toBe(30_000);
    expect(effectiveSampleIntervalMs(60, 9)).toBeCloseTo(60_000 / 9);
  });
});
