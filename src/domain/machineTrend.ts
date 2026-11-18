export const TREND_VIEW = { w: 100, h: 36 };
const FRAME_MIN = -12;
const FRAME_MAX = 112;

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

export function rangePercent(value: number, min: number, max: number): number {
  const span = max - min;
  if (span === 0) return value === min ? 0 : value > min ? FRAME_MAX : FRAME_MIN;
  return ((value - min) / span) * 100;
}

export function colorForParameter(parameterId: string, orderedIds: string[]): string {
  const index = orderedIds.indexOf(parameterId);
  return parameterColors[(index < 0 ? 0 : index) % parameterColors.length];
}

function yOf(percent: number): number {
  const clamped = Math.min(FRAME_MAX, Math.max(FRAME_MIN, percent));
  return 2 + (1 - (clamped - FRAME_MIN) / (FRAME_MAX - FRAME_MIN)) * (TREND_VIEW.h - 4);
}

export function guideY(percent: number): number {
  return yOf(percent);
}

export function buildMachineTrend(series: TrendSeriesInput[], orderedIds: string[]): TrendLine[] {
  return series.map((item) => {
    const color = colorForParameter(item.parameterId, orderedIds);
    const hasRange =
      typeof item.rangeMin === "number" &&
      Number.isFinite(item.rangeMin) &&
      typeof item.rangeMax === "number" &&
      Number.isFinite(item.rangeMax);
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
    const parsed = [...item.points]
      .filter((point) => point && typeof point.timestamp === "string")
      .map((point) => ({
        timestamp: point.timestamp,
        t: Date.parse(point.timestamp),
        value: typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null,
      }))
      .filter((point) => Number.isFinite(point.t))
      .sort((a, b) => a.t - b.t);

    const finite = parsed.filter((point) => point.value != null);
    const tMin = finite[0]?.t;
    const tMax = finite[finite.length - 1]?.t;
    const xOf = (t: number) => {
      if (tMin == null || tMax == null || tMax === tMin) return TREND_VIEW.w / 2;
      return 2 + ((t - tMin) / (tMax - tMin)) * (TREND_VIEW.w - 4);
    };

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
}
