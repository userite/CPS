import { describe, expect, it } from "vitest";
import { buildPlanProgress, parameterPlanRole } from "./planProgress";

describe("plan progress", () => {
  it("tags plan and report from the parameter name or id", () => {
    expect(parameterPlanRole("ПЛАН производство")).toBe("plan");
    expect(parameterPlanRole("Дневен план")).toBe("plan");
    expect(parameterPlanRole("Изпълнение смяна")).toBe("report");
    expect(parameterPlanRole("Отчет брой")).toBe("report");
    expect(parameterPlanRole("Скорост на въртене")).toBeNull();
    expect(parameterPlanRole("Quantity", "plan")).toBe("plan");
    expect(parameterPlanRole("Shift total", "report")).toBe("report");
  });

  it("sums only report samples after the latest plan and divides by that plan", () => {
    const progress = buildPlanProgress(
      [
        {
          parameterId: "plan_qty",
          label: "ПЛАН",
          unit: "бр",
          rangeMin: 0,
          rangeMax: 200,
          color: "#7ec8ff",
          points: [
            { timestamp: "2026-11-18T10:00:00.000Z", value: 50 },
            { timestamp: "2026-11-18T12:00:00.000Z", value: 100 },
          ],
        },
        {
          parameterId: "report_qty",
          label: "изпълнение, отчет",
          unit: "бр",
          rangeMin: 0,
          rangeMax: 200,
          color: "#3ddc97",
          points: [
            { timestamp: "2026-11-18T09:00:00.000Z", value: 10 },
            { timestamp: "2026-11-18T11:00:00.000Z", value: 20 },
            { timestamp: "2026-11-18T12:00:00.000Z", value: 5 },
            { timestamp: "2026-11-18T13:00:00.000Z", value: 40 },
            { timestamp: "2026-11-18T14:00:00.000Z", value: 15 },
          ],
        },
      ],
      ["plan_qty", "report_qty"],
    );
    expect(progress).not.toBeNull();
    // only reports after last plan (12:00): 40+15=55 / 100 = 55%
    expect(progress?.reportSum).toBe(55);
    expect(progress?.planValue).toBe(100);
    expect(progress?.percent).toBeCloseTo(55);
    expect(progress?.color).toBe("#3ddc97");
  });

  it("returns null when plan or report is missing", () => {
    expect(
      buildPlanProgress(
        [
          {
            parameterId: "speed",
            label: "Скорост",
            unit: "об/мин",
            rangeMin: 0,
            rangeMax: 100,
            points: [{ timestamp: "2026-11-18T10:00:00.000Z", value: 40 }],
          },
        ],
        ["speed"],
      ),
    ).toBeNull();
  });
});
