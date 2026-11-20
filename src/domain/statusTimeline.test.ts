import { describe, expect, it } from "vitest";
import { chartsOnLinear, resolveParameterRole } from "./parameterRole";
import { buildStatusStrip } from "./statusTimeline";

describe("status timeline", () => {
  const states = [
    { value: 0, label: "работи", color: "#3ddc97" },
    { value: 1, label: "авария", color: "#e53935" },
    { value: 2, label: "технологичен престой", color: "#f0b429" },
  ];

  it("builds colored cells from discrete samples", () => {
    const strip = buildStatusStrip("Condition", "Състояние", states, [
      { timestamp: "2026-11-20T08:00:00.000Z", value: 0 },
      { timestamp: "2026-11-20T08:01:00.000Z", value: 1 },
      { timestamp: "2026-11-20T08:02:00.000Z", value: 2 },
    ]);
    expect(strip?.cells.map((cell) => cell.label)).toEqual([
      "работи",
      "авария",
      "технологичен престой",
    ]);
    expect(strip?.cells.map((cell) => cell.color)).toEqual(["#3ddc97", "#e53935", "#f0b429"]);
  });

  it("keeps plan/report/status off the linear chart", () => {
    expect(chartsOnLinear("metric")).toBe(true);
    expect(chartsOnLinear("plan")).toBe(false);
    expect(chartsOnLinear("report")).toBe(false);
    expect(chartsOnLinear("status")).toBe(false);
    expect(resolveParameterRole("Състояние", "Condition", "status")).toBe("status");
    expect(resolveParameterRole("ПЛАН", "plan", "metric")).toBe("plan");
  });
});
