import type {
  MachineCardData,
  MachineStatus,
  MetricPoint,
  OeeColorThresholds,
} from "../types/machine";
import { formatUpdatedAgo } from "./format";

const STATUS_LABELS: Record<MachineStatus, string> = {
  running: "Работи",
  idle: "В изчакване",
  setup: "В настройка",
  warning: "Предупреждение",
  alarm: "Авария",
  offline: "Офлайн",
  unknown: "Неизвестен статус",
};

export function statusLabel(status: MachineStatus): string {
  return STATUS_LABELS[status] ?? STATUS_LABELS.unknown;
}

export function coerceStatus(value: string | undefined): MachineStatus {
  if (value && Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)) {
    return value as MachineStatus;
  }
  return "unknown";
}

export function oeeTone(
  value: number,
  thresholds: OeeColorThresholds,
): "neutral" | "good" | "warn" | "bad" {
  if (thresholds.goodMin == null || thresholds.warnMin == null) return "neutral";
  if (value >= thresholds.goodMin) return "good";
  if (value >= thresholds.warnMin) return "warn";
  return "bad";
}

function presentTrend(trend: MetricPoint[] | undefined): MetricPoint[] {
  if (!Array.isArray(trend)) return [];
  const cleaned = trend.flatMap((point) => {
    if (!point || typeof point.timestamp !== "string" || !point.timestamp) return [];
    const value =
      typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null;
    return [{ timestamp: point.timestamp, value }];
  });
  return cleaned.sort((a, b) => {
    const left = Date.parse(a.timestamp);
    const right = Date.parse(b.timestamp);
    if (Number.isNaN(left) || Number.isNaN(right)) return a.timestamp.localeCompare(b.timestamp);
    return left - right;
  });
}

export function presentMachine(
  input: Omit<Partial<MachineCardData>, "status"> & { status?: string },
): MachineCardData {
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : "unknown";
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : id;
  const oee =
    typeof input.oee === "number" && Number.isFinite(input.oee) && input.oee >= 0 && input.oee <= 100
      ? input.oee
      : null;
  const metric = input.primaryMetric;
  const primaryMetric =
    metric && typeof metric.label === "string"
      ? {
          key: metric.key || "unspecified",
          label: metric.label,
          unit: typeof metric.unit === "string" ? metric.unit : "",
        }
      : { key: "unspecified", label: "Характеристика", unit: "" };
  const alertCount =
    typeof input.activeAlertCount === "number" &&
    Number.isFinite(input.activeAlertCount) &&
    input.activeAlertCount > 0
      ? Math.floor(input.activeAlertCount)
      : 0;

  return {
    id,
    name,
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined,
    kind: input.kind === "lathe" || input.kind === "other" ? input.kind : undefined,
    status: coerceStatus(input.status),
    oee,
    primaryMetric,
    trend: presentTrend(input.trend),
    lastUpdatedAt: typeof input.lastUpdatedAt === "string" ? input.lastUpdatedAt : undefined,
    activeAlertCount: alertCount,
  };
}

export function freshness(
  iso: string | undefined,
  now: Date,
  staleAfterMs: number,
): { label: string; stale: boolean } {
  if (!iso) return { label: "Няма време на обновяване", stale: true };
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return { label: "Неизвестно време на обновяване", stale: true };
  }
  return {
    label: formatUpdatedAgo(iso, now),
    stale: now.getTime() - then.getTime() > staleAfterMs,
  };
}

export function alertText(status: MachineStatus, count: number): string | null {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const alertStatus = status === "warning" || status === "alarm";
  if (!alertStatus && safeCount === 0) return null;
  if (safeCount === 1) return "1 активно предупреждение";
  if (safeCount > 1) return `${safeCount} активни предупреждения`;
  return status === "alarm" ? "Активна авария" : "Активно предупреждение";
}
