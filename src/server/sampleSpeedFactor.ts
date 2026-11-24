import {
  chartSpeedFactorDefault,
  normalizeChartSpeedFactor,
} from "../config/dashboard";

/** Runtime-only multiplier for the live sample writer (not stored in admin). */
let runtimeSpeedFactor = chartSpeedFactorDefault;

export function getSampleSpeedFactor(): number {
  return runtimeSpeedFactor;
}

export function setSampleSpeedFactor(value: unknown): number {
  runtimeSpeedFactor = normalizeChartSpeedFactor(value);
  return runtimeSpeedFactor;
}
