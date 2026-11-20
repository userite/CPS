import { describe, expect, it } from "vitest";
import {
  OUT_OF_RANGE_COLOR,
  buildMachineTrend,
  colorForParameter,
  parameterColors,
  rangePercent,
  splitOutsideRuns,
} from "./machineTrend";

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
    expect(colorForParameter("a", order, "#929292")).toBe("#929292");
    expect(colorForParameter("a", order, null)).toBe(colorForParameter("a", order));
  });

  it("keeps pure red reserved for out-of-range only", () => {
    expect(parameterColors.every((color) => color.toLowerCase() !== OUT_OF_RANGE_COLOR.toLowerCase())).toBe(
      true,
    );
    expect(colorForParameter("a", ["a"], OUT_OF_RANGE_COLOR)).toBe(colorForParameter("a", ["a"]));
    expect(colorForParameter("a", ["a"], "#ff0000")).toBe(colorForParameter("a", ["a"]));
  });

  it("marks only the latest point that leaves the limits", () => {
    const { lines } = buildMachineTrend(
      [
        {
          parameterId: "speed",
          label: "Скорост",
          unit: "об/мин",
          rangeMin: 0,
          rangeMax: 100,
          color: "#929292",
          points: [
            { timestamp: "2026-11-18T10:00:00.000Z", value: 40 },
            { timestamp: "2026-11-18T10:01:00.000Z", value: 130 },
          ],
        },
      ],
      ["speed"],
    );
    const [line] = lines;
    expect(line.color).toBe("#929292");
    expect(line.plotted).toBe(true);
    expect(line.outside).toBe(true);
    expect(line.segments[0]?.[1]?.outside).toBe(true);
    expect(line.segments[0]?.[0]?.outside).toBe(false);
  });

  it("rescales the Y frame so outside peaks stay inside the view", () => {
    const { lines, frameMin, frameMax } = buildMachineTrend(
      [
        {
          parameterId: "speed",
          label: "Скорост",
          unit: "об/мин",
          rangeMin: 0,
          rangeMax: 100,
          points: [
            { timestamp: "2026-11-18T10:00:00.000Z", value: 50 },
            { timestamp: "2026-11-18T10:01:00.000Z", value: 180 },
          ],
        },
      ],
      ["speed"],
    );
    const peak = lines[0].segments[0]?.[1];
    expect(peak?.percent).toBe(180);
    expect(peak?.outside).toBe(true);
    expect(frameMax).toBeGreaterThan(180);
    expect(frameMin).toBeLessThan(0);
    expect(peak?.y).toBeGreaterThan(0);
    expect(peak?.y).toBeLessThan(36);
  });

  it("splits stroke runs when a series crosses the configured bounds", () => {
    const { lines } = buildMachineTrend(
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
            { timestamp: "2026-11-18T10:02:00.000Z", value: 60 },
          ],
        },
      ],
      ["speed"],
    );
    const runs = splitOutsideRuns(lines[0].segments[0]!);
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.outside)).toEqual([false, true, false]);
  });

  it("does not invent a scale when the limits are empty", () => {
    const { lines } = buildMachineTrend(
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
    const [line] = lines;
    expect(line.plotted).toBe(false);
    expect(line.segments).toHaveLength(0);
  });
});
