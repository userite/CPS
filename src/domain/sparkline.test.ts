import { describe, expect, it } from "vitest";
import { buildSparkModel, formatTrendWindow } from "./sparkline";

const start = Date.parse("2026-10-30T08:00:00Z");

function at(minute: number, value: number | null) {
  return { timestamp: new Date(start + minute * 60_000).toISOString(), value };
}

describe("sparkline", () => {
  it("splits a large time gap instead of drawing across it", () => {
    const model = buildSparkModel(
      [at(0, 1), at(5, 3), at(10, 2), at(40, 4)],
      undefined,
      "Тест",
      "%",
    );
    expect(model.empty).toBe(false);
    expect(model.segments.map((segment) => segment.length)).toEqual([3, 1]);
    expect(model.summary).toContain("Праг не е зададен.");
  });

  it("breaks the line on a missing sample", () => {
    const model = buildSparkModel(
      [at(0, 1), at(5, 2), at(10, null), at(15, 4)],
      undefined,
      "Тест",
      "%",
    );
    expect(model.segments).toHaveLength(2);
  });

  it("marks peaks and threshold breaches with different roles", () => {
    const model = buildSparkModel(
      [at(0, 70), at(5, 84), at(10, 80), at(15, 91), at(20, 92)],
      { upper: 90 },
      "Производителност",
      "%",
    );
    const flat = model.segments.flat();
    expect(flat.filter((point) => point.kinds.includes("peak")).map((point) => point.value)).toEqual([84]);
    expect(flat.filter((point) => point.kinds.includes("breach")).map((point) => point.value)).toEqual([
      91, 92,
    ]);
    expect(model.summary).toContain("Извън праг: 2.");
  });

  it("says there is no trend when fewer than two values exist", () => {
    const model = buildSparkModel([at(0, 10)], undefined, "Производителност", "%");
    expect(model.empty).toBe(true);
    expect(model.summary).toContain("Няма достатъчно данни");
  });

  it("labels a 60 minute span in minutes", () => {
    expect(formatTrendWindow(60 * 60_000)).toBe("Последните 60 минути");
  });
});
