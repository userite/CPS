import type { MetricPoint, TrendThresholds } from "../types/machine";
import { formatNumber, metricCaption } from "./format";

export const SPARK_VIEW = { w: 100, h: 28 };

export type SparkMarkerKind = "peak" | "breach" | "last";

export type SparkPoint = {
  x: number;
  y: number;
  value: number;
  timestamp: string;
  kinds: SparkMarkerKind[];
};

export type SparkModel = {
  empty: boolean;
  segments: SparkPoint[][];
  windowLabel: string | null;
  summary: string;
};

type InternalPoint = SparkPoint & { t: number };

function finiteBound(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function formatTrendWindow(spanMs: number): string {
  const minutes = Math.max(1, Math.round(spanMs / 60_000));
  if (minutes === 1) return "Последната минута";
  if (minutes <= 90) return `Последните ${minutes} минути`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return hours === 1 ? "Последния час" : `Последните ${hours} часа`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Последния ден" : `Последните ${days} дни`;
}

function emptyModel(summary: string): SparkModel {
  return { empty: true, segments: [], windowLabel: null, summary };
}

export function buildSparkModel(
  points: MetricPoint[],
  thresholds: TrendThresholds | undefined,
  label: string,
  unit: string,
): SparkModel {
  const caption = metricCaption(label, unit);
  const parsed = [...points]
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
    .sort((a, b) => {
      if (a.t == null || b.t == null) return a.timestamp.localeCompare(b.timestamp);
      return a.t - b.t;
    });

  const finite = parsed.filter(
    (point): point is { timestamp: string; t: number; value: number } =>
      point.t != null && point.value != null,
  );

  if (finite.length < 2) {
    return emptyModel(`${caption}. Няма достатъчно данни за тенденция.`);
  }

  const intervals: number[] = [];
  for (let index = 1; index < finite.length; index += 1) {
    const delta = finite[index].t - finite[index - 1].t;
    if (delta > 0) intervals.push(delta);
  }
  const median = medianOf(intervals);
  const gapLimit = median == null ? Number.POSITIVE_INFINITY : median * 2;

  const tMin = finite[0].t;
  const tMax = finite[finite.length - 1].t;
  const values = finite.map((point) => point.value);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const pad = vMin === vMax ? 1 : (vMax - vMin) * 0.14;
  const yMin = vMin - pad;
  const yMax = vMax + pad;
  const xOf = (t: number) =>
    tMax === tMin ? SPARK_VIEW.w / 2 : 2 + ((t - tMin) / (tMax - tMin)) * (SPARK_VIEW.w - 4);
  const yOf = (value: number) => 3 + (1 - (value - yMin) / (yMax - yMin)) * (SPARK_VIEW.h - 6);

  const segments: InternalPoint[][] = [];
  let current: InternalPoint[] = [];
  const flush = () => {
    if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  };

  for (const point of parsed) {
    if (point.t == null || point.value == null) {
      flush();
      continue;
    }
    const next: InternalPoint = {
      t: point.t,
      x: xOf(point.t),
      y: yOf(point.value),
      value: point.value,
      timestamp: point.timestamp,
      kinds: [],
    };
    if (current.length > 0 && next.t - current[current.length - 1].t > gapLimit) flush();
    current.push(next);
  }
  flush();

  const upper = finiteBound(thresholds?.upper);
  const lower = finiteBound(thresholds?.lower);
  for (const segment of segments) {
    for (let index = 1; index < segment.length - 1; index += 1) {
      const point = segment[index];
      if (point.value > segment[index - 1].value && point.value > segment[index + 1].value) {
        point.kinds.push("peak");
      }
    }
    for (const point of segment) {
      if ((upper != null && point.value > upper) || (lower != null && point.value < lower)) {
        point.kinds.push("breach");
      }
    }
  }

  const lastSegment = segments[segments.length - 1];
  const last = lastSegment?.[lastSegment.length - 1];
  if (last) last.kinds.push("last");

  const visible = segments.map((segment) =>
    segment.map((point) => ({
      x: point.x,
      y: point.y,
      value: point.value,
      timestamp: point.timestamp,
      kinds: point.kinds,
    })),
  );
  const flat = visible.flat();
  const peakCount = flat.filter((point) => point.kinds.includes("peak")).length;
  const breachCount = flat.filter((point) => point.kinds.includes("breach")).length;
  const windowLabel = formatTrendWindow(tMax - tMin);
  const unitSuffix = unit.trim() ? ` ${unit.trim()}` : "";
  const thresholdText =
    upper == null && lower == null
      ? "Праг не е зададен."
      : `Извън праг: ${breachCount}.`;

  return {
    empty: false,
    segments: visible,
    windowLabel,
    summary: [
      caption,
      `${finite.length} стойности за ${windowLabel.toLowerCase()}.`,
      `Последна стойност ${formatNumber(last?.value ?? finite[finite.length - 1].value)}${unitSuffix}.`,
      `Пикове: ${peakCount}.`,
      thresholdText,
    ].join(" "),
  };
}
