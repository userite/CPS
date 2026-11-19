import { colorForParameter, type TrendSample, type TrendSeriesInput } from "./machineTrend";

export type PlanRole = "plan" | "report";

export type PlanProgress = {
  percent: number;
  planValue: number;
  reportSum: number;
  planLabel: string;
  reportLabel: string;
  color: string;
};

/** Tag from the parameter name: "ПЛАН" vs "изпълнение" / "отчет". */
export function parameterPlanRole(label: string): PlanRole | null {
  const normalized = label.trim().toLocaleLowerCase("bg-BG");
  if (!normalized) return null;
  if (normalized.includes("план")) return "plan";
  if (normalized.includes("изпълнение") || normalized.includes("отчет")) return "report";
  return null;
}

type FiniteSample = { t: number; value: number; timestamp: string };

function finiteSamples(points: TrendSample[]): FiniteSample[] {
  return [...points]
    .filter((point) => point && typeof point.timestamp === "string")
    .map((point) => {
      const t = Date.parse(point.timestamp);
      const value = typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null;
      return {
        timestamp: point.timestamp,
        t: Number.isFinite(t) ? t : null,
        value,
      };
    })
    .filter(
      (point): point is { timestamp: string; t: number; value: number } =>
        point.t != null && point.value != null,
    )
    .sort((a, b) => a.t - b.t);
}

/**
 * % = sum(report values at/before the last plan sample) / last plan value.
 * Needs one series tagged ПЛАН and one tagged изпълнение/отчет.
 */
export function buildPlanProgress(
  series: TrendSeriesInput[],
  orderedIds: string[],
): PlanProgress | null {
  let plan: TrendSeriesInput | null = null;
  let report: TrendSeriesInput | null = null;
  for (const item of series) {
    const role = parameterPlanRole(item.label);
    if (role === "plan" && !plan) plan = item;
    if (role === "report" && !report) report = item;
  }
  if (!plan || !report) return null;

  const planSamples = finiteSamples(plan.points);
  const lastPlan = planSamples[planSamples.length - 1];
  if (!lastPlan || lastPlan.value <= 0) return null;

  const reportSum = finiteSamples(report.points)
    .filter((sample) => sample.t <= lastPlan.t)
    .reduce((sum, sample) => sum + sample.value, 0);

  return {
    percent: (reportSum / lastPlan.value) * 100,
    planValue: lastPlan.value,
    reportSum,
    planLabel: plan.label,
    reportLabel: report.label,
    color: colorForParameter(report.parameterId, orderedIds, report.color),
  };
}
