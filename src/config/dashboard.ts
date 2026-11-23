import type { OeeColorThresholds } from "../types/machine";

/**
 * How old a sample may be before the card says the data is stale.
 * Demonstration default only. The plant has not confirmed this window.
 */
export const staleAfterMs = 60_000;

/**
 * OEE arc colors. Both values stay null until production sets them.
 * The card must not invent a green/yellow/red scale.
 */
export const oeeColorThresholds: OeeColorThresholds = {
  goodMin: null,
  warnMin: null,
};

/** How often the screen re-reads blondina. The plant has not set this interval. */
export const readerIntervalMs = 5_000;

/** Default X window on the табло: last N hours. */
export const chartWindowHoursDefault = 4;

/** Allowed choices for the hours control. */
export const chartWindowHourChoices = [1, 2, 4, 8, 12, 24] as const;

export const chartWindowHoursStorageKey = "cps.chartWindowHours";

/** Selected parameter ids for the bottom aggregate chart on the табло. */
export const aggregateChartParamsStorageKey = "cps.aggregateChartParams";

export function normalizeChartWindowHours(value: unknown): number {
  const hours = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return chartWindowHoursDefault;
  return Math.min(168, Math.max(1, Math.round(hours)));
}

/** Fixed [now − N hours, now] domain for line chart + status strip. */
export function chartWindowDomain(hours: number, nowMs = Date.now()): { tMin: number; tMax: number } {
  const spanMs = normalizeChartWindowHours(hours) * 60 * 60_000;
  return { tMin: nowMs - spanMs, tMax: nowMs };
}
