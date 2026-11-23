import { describe, expect, it } from "vitest";
import { chartTickStepMs, chartTimeTicks } from "./chartTimeTicks";

describe("chartTimeTicks", () => {
  it("uses 15-minute steps for a 1-hour window", () => {
    const tMax = Date.parse("2026-11-23T12:00:00");
    const tMin = tMax - 60 * 60_000;
    expect(chartTickStepMs(tMin, tMax)).toBe(15 * 60_000);
    const ticks = chartTimeTicks(tMin, tMax);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.every((tick) => new Date(tick.t).getMinutes() % 15 === 0)).toBe(true);
  });

  it("uses round hours for longer windows", () => {
    const tMax = Date.parse("2026-11-23T16:00:00");
    const tMin = tMax - 4 * 60 * 60_000;
    expect(chartTickStepMs(tMin, tMax)).toBe(60 * 60_000);
    const ticks = chartTimeTicks(tMin, tMax);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.every((tick) => new Date(tick.t).getMinutes() === 0)).toBe(true);
  });

  it("keeps tick x inside the plot padding", () => {
    const tMax = Date.parse("2026-11-23T12:00:00");
    const tMin = tMax - 4 * 60 * 60_000;
    for (const tick of chartTimeTicks(tMin, tMax)) {
      expect(tick.x).toBeGreaterThanOrEqual(2);
      expect(tick.x).toBeLessThanOrEqual(98);
    }
  });
});
