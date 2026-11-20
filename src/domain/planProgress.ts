import { colorForParameter, type TrendSample, type TrendSeriesInput } from "./machineTrend";
import { resolveParameterRole } from "./parameterRole";

export type PlanRole = "plan" | "report";

export type PlanProgress = {
  percent: number;
  planValue: number;
  reportSum: number;
  planLabel: string;
  reportLabel: string;
  color: string;
};

/** @deprecated Prefer resolveParameterRole — kept for existing tests/imports. */
export function parameterPlanRole(label: string, parameterId = ""): PlanRole | null {
  const role = resolveParameterRole(label, parameterId, "metric");
  return role === "plan" || role === "report" ? role : null;
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
 * % = sum(report values strictly after the latest plan sample) / last plan value.
 * Needs one series tagged ПЛАН/plan and one tagged изпълнение/отчет/report.
 */
export function buildPlanProgress(
  series: TrendSeriesInput[],
  orderedIds: string[],
): PlanProgress | null {
  let plan: TrendSeriesInput | null = null;
  let report: TrendSeriesInput | null = null;
  for (const item of series) {
    const role = resolveParameterRole(item.label, item.parameterId, item.role);
    if (role === "plan" && !plan) plan = item;
    if (role === "report" && !report) report = item;
  }
  if (!plan || !report) return null;

  const planSamples = finiteSamples(plan.points);
  const lastPlan = planSamples[planSamples.length - 1];
  if (!lastPlan || lastPlan.value <= 0) return null;

  const reportSum = finiteSamples(report.points)
    .filter((sample) => sample.t > lastPlan.t)
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
