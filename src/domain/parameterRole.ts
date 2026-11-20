export type ParameterRole = "metric" | "plan" | "report" | "status";

export type ParameterStateDef = {
  value: number;
  label: string;
  color: string;
};

const ROLE_SET = new Set<ParameterRole>(["metric", "plan", "report", "status"]);

export function asParameterRole(value: unknown): ParameterRole {
  const role = String(value ?? "metric").trim().toLowerCase();
  return ROLE_SET.has(role as ParameterRole) ? (role as ParameterRole) : "metric";
}

/** Name/id fallback for plan/report when role is still metric. */
export function inferPlanReportRole(label: string, parameterId = ""): "plan" | "report" | null {
  const normalized = `${label} ${parameterId}`.trim().toLocaleLowerCase("bg-BG");
  if (!normalized) return null;
  if (normalized.includes("план") || /(^|[^a-z])plan([^a-z]|$)/i.test(normalized)) return "plan";
  if (
    normalized.includes("изпълнение") ||
    normalized.includes("отчет") ||
    /(^|[^a-z])report([^a-z]|$)/i.test(normalized)
  ) {
    return "report";
  }
  return null;
}

export function resolveParameterRole(
  label: string,
  parameterId: string,
  stored?: string | null,
): ParameterRole {
  const role = asParameterRole(stored);
  if (role !== "metric") return role;
  return inferPlanReportRole(label, parameterId) ?? "metric";
}

export function chartsOnLinear(role: ParameterRole): boolean {
  return role === "metric";
}

export const DEFAULT_STATUS_STATES: ParameterStateDef[] = [
  { value: 0, label: "работи", color: "#3ddc97" },
  { value: 1, label: "авария", color: "#e53935" },
  { value: 2, label: "технологичен престой", color: "#f0b429" },
];
