import { describe, expect, it } from "vitest";
import {
  chartWindowDomain,
  chartWindowHoursDefault,
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
