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

/** Half a shift. Each chart asks for this much history. */
export const chartWindowMinutes = 4 * 60;
