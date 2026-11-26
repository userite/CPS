import { describe, expect, it } from "vitest";
import { TREND_VIEW, trendXOf } from "./machineTrend";
import { chartsOnLinear, resolveParameterRole } from "./parameterRole";
import { buildStatusStrip, latestStatusOf } from "./statusTimeline";

describe("status timeline", () => {
  const states = [
    { value: 0, label: "работи", color: "#3ddc97" },
    { value: 1, label: "авария", color: "#e53935" },
    { value: 2, label: "технологичен престой", color: "#f0b429" },
  ];

  it("places segments on the same X domain as the line chart", () => {
    const tMin = Date.parse("2026-11-20T08:00:00.000Z");
    const tMax = Date.parse("2026-11-20T08:02:00.000Z");
    const strip = buildStatusStrip(
      "Condition",
      "Състояние",
      states,
      [
        { timestamp: "2026-11-20T08:00:00.000Z", value: 0 },
        { timestamp: "2026-11-20T08:01:00.000Z", value: 1 },
        { timestamp: "2026-11-20T08:02:00.000Z", value: 2 },
      ],
      tMin,
      tMax,
    );
    expect(strip?.segments).toHaveLength(3);
    expect(strip?.segments[0]?.x).toBeCloseTo(trendXOf(tMin, tMin, tMax));
    expect(strip?.segments[1]?.x).toBeCloseTo(
      trendXOf(Date.parse("2026-11-20T08:01:00.000Z"), tMin, tMax),
    );
    expect(strip?.segments[0]?.width).toBeCloseTo(strip!.segments[1]!.x - strip!.segments[0]!.x);
    const last = strip!.segments[2]!;
    expect(last.x + last.width).toBeLessThanOrEqual(TREND_VIEW.w - 2 + 0.001);
    expect(last.x + last.width).toBeGreaterThan(TREND_VIEW.w - 3);
    expect(strip?.segments.map((segment) => segment.label)).toEqual([
      "работи",
      "авария",
      "технологичен престой",
    ]);
  });

  it("keeps plan/report/status/formula off the linear chart", () => {
    expect(chartsOnLinear("metric")).toBe(true);
    expect(chartsOnLinear("plan")).toBe(false);
    expect(chartsOnLinear("report")).toBe(false);
    expect(chartsOnLinear("status")).toBe(false);
    expect(chartsOnLinear("formula")).toBe(false);
    expect(resolveParameterRole("Състояние", "Condition", "status")).toBe("status");
    expect(resolveParameterRole("ПЛАН", "plan", "metric")).toBe("plan");
    expect(resolveParameterRole("Отчет/план", "report_vs_plan", "formula")).toBe("formula");
  });

  it("picks the latest-by-time status label and color", () => {
    const latest = latestStatusOf([
      {
        parameterId: "speed",
        label: "Скорост",
        role: "metric",
        states: [],
        points: [{ timestamp: "2026-11-20T09:00:00.000Z", value: 10 }],
      },
      {
        parameterId: "Condition",
        label: "Състояние",
        role: "status",
        states,
        points: [
          { timestamp: "2026-11-20T08:00:00.000Z", value: 0 },
          { timestamp: "2026-11-20T09:00:00.000Z", value: 1 },
          { timestamp: "2026-11-20T08:30:00.000Z", value: 2 },
        ],
      },
    ]);
    expect(latest).toEqual({ label: "авария", color: "#e53935", value: 1 });
  });
});
