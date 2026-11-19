import { describe, expect, it } from "vitest";
import { buildPlanProgress, parameterPlanRole } from "./planProgress";

describe("plan progress", () => {
  it("tags plan and report from the parameter name", () => {
    expect(parameterPlanRole("ПЛАН производство")).toBe("plan");
    expect(parameterPlanRole("Дневен план")).toBe("plan");
    expect(parameterPlanRole("Изпълнение смяна")).toBe("report");
    expect(parameterPlanRole("Отчет брой")).toBe("report");
    expect(parameterPlanRole("Скорост на въртене")).toBeNull();
  });

  it("sums report samples up to the last plan and divides by that plan", () => {
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
            { timestamp: "2026-11-18T13:00:00.000Z", value: 40 },
          ],
        },
      ],
      ["plan_qty", "report_qty"],
    );
    expect(progress).not.toBeNull();
    // report at 13:00 is after last plan (12:00) → excluded; 10+20=30 / 100 = 30%
    expect(progress?.reportSum).toBe(30);
    expect(progress?.planValue).toBe(100);
    expect(progress?.percent).toBe(30);
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
