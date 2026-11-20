export const TREND_VIEW = { w: 100, h: 36 };
const FRAME_MIN = -12;
const FRAME_MAX = 112;

/** Reserved for out-of-range values on the pulpit chart — never for series colors. */
export const OUT_OF_RANGE_COLOR = "#FF0000";

export const parameterColors = [
  "#7ec8ff",
  "#3ddc97",
  "#f0b429",
  "#c9a6ff",
  "#ff9b73",
  "#5ee0d0",
  "#e6d56a",
  "#ff8fb8",
];

export type TrendSample = {
  timestamp: string;
  value: number | null;
};

export type TrendSeriesInput = {
  parameterId: string;
  label: string;
  unit: string;
  rangeMin: number | null;
  rangeMax: number | null;
  color?: string | null;
  role?: string | null;
  points: TrendSample[];
};

export type TrendPoint = {
  x: number;
  y: number;
  percent: number;
  outside: boolean;
  value: number;
  timestamp: string;
};

export type TrendLine = {
  parameterId: string;
  label: string;
  unit: string;
  color: string;
  hasRange: boolean;
  plotted: boolean;
  outside: boolean;
  lastPercent: number | null;
  lastValue: number | null;
  segments: TrendPoint[][];
};

export type MachineTrendModel = {
  lines: TrendLine[];
  frameMin: number;
  frameMax: number;
  tMin: number | null;
  tMax: number | null;
};

/** Same horizontal padding as the line chart (2 … w-2). */
export function trendXOf(t: number, tMin: number, tMax: number): number {
  if (tMax === tMin) return TREND_VIEW.w / 2;
  return 2 + ((t - tMin) / (tMax - tMin)) * (TREND_VIEW.w - 4);
}

export function resolveTimeDomain(times: number[]): { tMin: number; tMax: number } | null {
  const finite = times.filter((time) => Number.isFinite(time));
  if (finite.length === 0) return null;
  return { tMin: Math.min(...finite), tMax: Math.max(...finite) };
}

export function rangePercent(value: number, min: number, max: number): number {
  const span = max - min;
  if (span === 0) return value === min ? 0 : value > min ? FRAME_MAX : FRAME_MIN;
  return ((value - min) / span) * 100;
}

function isReservedRed(color: string): boolean {
  return color.toLowerCase() === OUT_OF_RANGE_COLOR.toLowerCase();
}

export function colorForParameter(
  parameterId: string,
  orderedIds: string[],
  assigned?: string | null,
): string {
  if (assigned && /^#[0-9A-Fa-f]{6}$/.test(assigned) && !isReservedRed(assigned)) {
    return assigned;
  }
  const index = orderedIds.indexOf(parameterId);
  return parameterColors[(index < 0 ? 0 : index) % parameterColors.length];
}

export function yOfPercent(percent: number, frameMin: number, frameMax: number): number {
  const span = frameMax - frameMin;
  if (span === 0) return TREND_VIEW.h / 2;
  return 2 + (1 - (percent - frameMin) / span) * (TREND_VIEW.h - 4);
}

export function guideY(percent: number, frameMin = FRAME_MIN, frameMax = FRAME_MAX): number {
  return yOfPercent(percent, frameMin, frameMax);
}

function resolveFrame(percents: number[]): { frameMin: number; frameMax: number } {
  let frameMin = FRAME_MIN;
  let frameMax = FRAME_MAX;
  if (percents.length === 0) return { frameMin, frameMax };
  const lo = Math.min(...percents);
  const hi = Math.max(...percents);
  if (lo >= FRAME_MIN && hi <= FRAME_MAX) return { frameMin, frameMax };
  frameMin = Math.min(FRAME_MIN, lo);
  frameMax = Math.max(FRAME_MAX, hi);
  const span = frameMax - frameMin;
  const pad = span === 0 ? 1 : span * 0.08;
  if (lo < FRAME_MIN) frameMin -= pad;
  if (hi > FRAME_MAX) frameMax += pad;
  return { frameMin, frameMax };
}

/** Split a segment into contiguous runs so out-of-range strokes can use reserved red. */
export function splitOutsideRuns(segment: TrendPoint[]): { points: TrendPoint[]; outside: boolean }[] {
  if (segment.length === 0) return [];
  const runs: { points: TrendPoint[]; outside: boolean }[] = [];
  let current: { points: TrendPoint[]; outside: boolean } = {
    points: [segment[0]],
    outside: segment[0].outside,
  };
  for (let index = 1; index < segment.length; index += 1) {
    const point = segment[index];
    if (point.outside === current.outside) {
      current.points.push(point);
      continue;
    }
    runs.push(current);
    current = {
      points: [current.points[current.points.length - 1], point],
      outside: point.outside,
    };
  }
  runs.push(current);
  return runs;
}

export function buildMachineTrend(
  series: TrendSeriesInput[],
  orderedIds: string[],
  sharedDomain?: { tMin: number; tMax: number } | null,
): MachineTrendModel {
  type Draft = {
    item: TrendSeriesInput;
    color: string;
    hasRange: boolean;
    parsed: { timestamp: string; t: number; value: number | null }[];
    finite: { timestamp: string; t: number; value: number }[];
    percents: number[];
  };

  const drafts: Draft[] = series.map((item) => {
    const color = colorForParameter(item.parameterId, orderedIds, item.color);
    const hasRange =
      typeof item.rangeMin === "number" &&
      Number.isFinite(item.rangeMin) &&
      typeof item.rangeMax === "number" &&
      Number.isFinite(item.rangeMax);
    if (!hasRange) {
      return { item, color, hasRange: false, parsed: [], finite: [], percents: [] };
    }
    const min = item.rangeMin as number;
    const max = item.rangeMax as number;
    const parsed = [...item.points]
      .filter((point) => point && typeof point.timestamp === "string")
      .map((point) => ({
        timestamp: point.timestamp,
        t: Date.parse(point.timestamp),
        value: typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null,
      }))
      .filter((point) => Number.isFinite(point.t))
      .sort((a, b) => a.t - b.t);

    const finite = parsed.filter(
      (point): point is { timestamp: string; t: number; value: number } => point.value != null,
    );
    const percents = finite.map((point) => rangePercent(point.value, min, max));
    return { item, color, hasRange: true, parsed, finite, percents };
  });

  const { frameMin, frameMax } = resolveFrame(drafts.flatMap((draft) => draft.percents));
  const yOf = (percent: number) => yOfPercent(percent, frameMin, frameMax);
  const domain =
    sharedDomain ??
    resolveTimeDomain(drafts.flatMap((draft) => draft.finite.map((point) => point.t)));
  const tMin = domain?.tMin ?? null;
  const tMax = domain?.tMax ?? null;
  const xOf = (t: number) => {
    if (tMin == null || tMax == null) return TREND_VIEW.w / 2;
    return trendXOf(t, tMin, tMax);
  };

  const lines: TrendLine[] = drafts.map((draft) => {
    const { item, color, hasRange, parsed, finite } = draft;
    if (!hasRange) {
      return {
        parameterId: item.parameterId,
        label: item.label,
        unit: item.unit,
        color,
        hasRange: false,
        plotted: false,
        outside: false,
        lastPercent: null,
        lastValue: null,
        segments: [],
      };
    }
    const min = item.rangeMin as number;
    const max = item.rangeMax as number;

    const segments: TrendPoint[][] = [];
    let current: TrendPoint[] = [];
    const flush = () => {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    };
    for (const point of parsed) {
      if (point.value == null) {
        flush();
        continue;
      }
      const percent = rangePercent(point.value, min, max);
      current.push({
        x: xOf(point.t),
        y: yOf(percent),
        percent,
        outside: percent < 0 || percent > 100,
        value: point.value,
        timestamp: point.timestamp,
      });
    }
    flush();
    const last = [...segments.flat()].at(-1) ?? null;
    return {
      parameterId: item.parameterId,
      label: item.label,
      unit: item.unit,
      color,
      hasRange: true,
      plotted: finite.length > 0,
      outside: last?.outside ?? false,
      lastPercent: last?.percent ?? null,
      lastValue: last?.value ?? null,
      segments,
    };
  });

  return { lines, frameMin, frameMax, tMin, tMax };
}
