import { formatTime } from "./format";
import { trendXOf } from "./machineTrend";

export type ChartTimeTick = {
  t: number;
  x: number;
  label: string;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Step for X ticks: 15 min when window ≈ 1h, else round hours (thinned if crowded). */
export function chartTickStepMs(tMin: number, tMax: number): number {
  const span = tMax - tMin;
  if (!Number.isFinite(span) || span <= 0) return HOUR_MS;
  if (span <= HOUR_MS + MINUTE_MS) return 15 * MINUTE_MS;
  const hours = span / HOUR_MS;
  if (hours <= 12) return HOUR_MS;
  if (hours <= 24) return 2 * HOUR_MS;
  return 4 * HOUR_MS;
}

function truncateLocal(t: number, stepMs: number): number {
  const d = new Date(t);
  d.setSeconds(0, 0);
  if (stepMs < HOUR_MS) {
    const stepMin = Math.max(1, Math.round(stepMs / MINUTE_MS));
    const minutes = d.getMinutes();
    d.setMinutes(Math.floor(minutes / stepMin) * stepMin);
    return d.getTime();
  }
  d.setMinutes(0);
  const stepHours = Math.max(1, Math.round(stepMs / HOUR_MS));
  const hours = d.getHours();
  d.setHours(Math.floor(hours / stepHours) * stepHours);
  return d.getTime();
}

function advanceLocal(t: number, stepMs: number): number {
  if (stepMs < HOUR_MS) return t + stepMs;
  const d = new Date(t);
  const stepHours = Math.max(1, Math.round(stepMs / HOUR_MS));
  d.setHours(d.getHours() + stepHours);
  return d.getTime();
}

/**
 * X-axis ticks inside [tMin, tMax], aligned to local clock.
 * 1-hour window → :00/:15/:30/:45; longer → round hours (or every 2/4h).
 */
export function chartTimeTicks(
  tMin: number,
  tMax: number,
): ChartTimeTick[] {
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax <= tMin) return [];
  const stepMs = chartTickStepMs(tMin, tMax);
  let t = truncateLocal(tMin, stepMs);
  if (t < tMin) t = advanceLocal(t, stepMs);
  const ticks: ChartTimeTick[] = [];
  const guard = 64;
  for (let i = 0; i < guard && t <= tMax + 1; i += 1) {
    if (t >= tMin - 1 && t <= tMax + 1) {
      ticks.push({
        t,
        x: trendXOf(t, tMin, tMax),
        label: formatTime(new Date(t).toISOString()),
      });
    }
    t = advanceLocal(t, stepMs);
  }
  return ticks;
}
