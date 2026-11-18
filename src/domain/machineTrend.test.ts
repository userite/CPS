import { describe, expect, it } from "vitest";
import { buildMachineTrend, colorForParameter, rangePercent } from "./machineTrend";

describe("machine trend", () => {
  it("maps the limits to 0% and 100%", () => {
    expect(rangePercent(10, 10, 20)).toBe(0);
    expect(rangePercent(20, 10, 20)).toBe(100);
    expect(rangePercent(15, 10, 20)).toBe(50);
    expect(rangePercent(5, 10, 20)).toBeLessThan(0);
    expect(rangePercent(25, 10, 20)).toBeGreaterThan(100);
  });

  it("gives each parameter one stable color", () => {
    const order = ["a", "b"];
    expect(colorForParameter("a", order)).not.toBe(colorForParameter("b", order));
    expect(colorForParameter("b", order)).toBe(colorForParameter("b", ["a", "b"]));
  });

  it("marks only the latest point that leaves the limits", () => {
    const [line] = buildMachineTrend(
      [
        {
          parameterId: "speed",
          label: "Скорост",
          unit: "об/мин",
          rangeMin: 0,
          rangeMax: 100,
          points: [
            { timestamp: "2026-11-18T10:00:00.000Z", value: 40 },
            { timestamp: "2026-11-18T10:01:00.000Z", value: 130 },
          ],
        },
      ],
      ["speed"],
    );
    expect(line.plotted).toBe(true);
    expect(line.outside).toBe(true);
    expect(line.segments[0]?.[1]?.outside).toBe(true);
    expect(line.segments[0]?.[0]?.outside).toBe(false);
  });

  it("does not invent a scale when the limits are empty", () => {
    const [line] = buildMachineTrend(
      [
        {
          parameterId: "scrap",
          label: "Брак",
          unit: "бр",
          rangeMin: null,
          rangeMax: null,
          points: [{ timestamp: "2026-11-18T10:00:00.000Z", value: 3 }],
        },
      ],
      ["scrap"],
    );
    expect(line.plotted).toBe(false);
    expect(line.segments).toHaveLength(0);
  });
});
