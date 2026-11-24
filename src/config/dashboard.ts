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

/**
 * Live demo speed: multiply sample/generation frequency by this factor (1–9).
 * Does not change stored `sample_interval_seconds` in admin — only the runtime writer.
 */
export const chartSpeedFactorDefault = 1;

export const chartSpeedFactorChoices = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const chartSpeedFactorStorageKey = "cps.chartSpeedFactor";

/** Selected parameter ids for the bottom aggregate chart on the табло. */
export const aggregateChartParamsStorageKey = "cps.aggregateChartParams";

export function normalizeChartWindowHours(value: unknown): number {
  const hours = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return chartWindowHoursDefault;
  return Math.min(168, Math.max(1, Math.round(hours)));
}

export function normalizeChartSpeedFactor(value: unknown): number {
  const factor = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(factor)) return chartSpeedFactorDefault;
  return Math.min(9, Math.max(1, Math.round(factor)));
}

/**
 * Effective sample period for the live writer: stored interval ÷ speed factor.
 * Factor 1 → unchanged; factor 9 → nine times denser (interval / 9).
 */
export function effectiveSampleIntervalMs(
  sampleIntervalSeconds: number,
  speedFactor: number = chartSpeedFactorDefault,
): number {
  const seconds =
    Number.isFinite(sampleIntervalSeconds) && sampleIntervalSeconds > 0
      ? sampleIntervalSeconds
      : 60;
  return (seconds * 1000) / normalizeChartSpeedFactor(speedFactor);
}

/** Fixed [now − N hours, now] domain for line chart + status strip. */
export function chartWindowDomain(hours: number, nowMs = Date.now()): { tMin: number; tMax: number } {
  const spanMs = normalizeChartWindowHours(hours) * 60 * 60_000;
  return { tMin: nowMs - spanMs, tMax: nowMs };
}
