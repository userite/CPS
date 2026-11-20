import { TREND_VIEW, trendXOf } from "./machineTrend";
import { resolveParameterRole, type ParameterStateDef } from "./parameterRole";

export type StatusSample = {
  timestamp: string;
  value: number | null;
};

export type LatestStatus = {
  label: string;
  color: string;
  value: number;
};

export type StatusSegment = {
  start: string;
  end: string;
  x: number;
  width: number;
  value: number;
  label: string;
  color: string;
};

export type StatusStrip = {
  parameterId: string;
  label: string;
  segments: StatusSegment[];
  states: ParameterStateDef[];
};

function stateFor(value: number, states: ParameterStateDef[]): ParameterStateDef | null {
  const exact = states.find((state) => state.value === value);
  if (exact) return exact;
  const nearest = [...states].sort(
    (a, b) => Math.abs(a.value - value) - Math.abs(b.value - value),
  )[0];
  return nearest ?? null;
}

/**
 * Latest status sample by timestamp across status-role series.
 * Color/label come from the matching state definition (same colors as the strip).
 */
export function latestStatusOf(
  series: Array<{
    parameterId: string;
    label: string;
    role?: string | null;
    states: ParameterStateDef[];
    points: StatusSample[];
  }>,
): LatestStatus | null {
  let best: { t: number; value: number; states: ParameterStateDef[] } | null = null;
  for (const item of series) {
    const role = resolveParameterRole(item.label, item.parameterId, item.role);
    if (role !== "status" || item.states.length === 0) continue;
    for (const point of item.points) {
      if (!point || typeof point.timestamp !== "string") continue;
      const t = Date.parse(point.timestamp);
      const value =
        typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null;
      if (!Number.isFinite(t) || value == null) continue;
      if (!best || t >= best.t) best = { t, value, states: item.states };
    }
  }
  if (!best) return null;
  const state = stateFor(best.value, best.states);
  if (!state) return null;
  return { label: state.label, color: state.color, value: best.value };
}

/**
 * Step segments on the same X domain/padding as the line chart.
 * Each sample holds until the next sample; the last holds to tMax.
 */
export function buildStatusStrip(
  parameterId: string,
  label: string,
  states: ParameterStateDef[],
  points: StatusSample[],
  tMin: number,
  tMax: number,
): StatusStrip | null {
  if (states.length === 0) return null;
  const samples = [...points]
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
        point.t != null && point.value != null && point.t >= tMin && point.t <= tMax,
    )
    .sort((a, b) => a.t - b.t);
  if (samples.length === 0) return null;

  const segments: StatusSegment[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const state = stateFor(sample.value, states);
    if (!state) continue;
    const next = samples[index + 1];
    const endT = next ? next.t : tMax;
    const endStamp = next ? next.timestamp : new Date(tMax).toISOString();
    const xStart = trendXOf(sample.t, tMin, tMax);
    let xEnd = trendXOf(endT, tMin, tMax);
    const minWidth = TREND_VIEW.w * 0.004;
    if (xEnd <= xStart) {
      xEnd = Math.min(TREND_VIEW.w - 2, xStart + minWidth);
    }
    const x = xEnd - xStart < minWidth ? Math.max(2, xEnd - minWidth) : xStart;
    const width = Math.max(xEnd - x, minWidth);
    segments.push({
      start: sample.timestamp,
      end: endStamp,
      x,
      width,
      value: sample.value,
      label: state.label,
      color: state.color,
    });
  }
  if (segments.length === 0) return null;
  return { parameterId, label, segments, states };
}
