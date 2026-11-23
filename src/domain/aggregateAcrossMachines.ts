import type { AggregateMethod } from "./aggregateMethod";
import type { TrendSample, TrendSeriesInput } from "./machineTrend";

export type MachineSeriesSlice = {
  machineId: string;
  points: TrendSample[];
};

export type AggregateParamInput = {
  parameterId: string;
  label: string;
  unit: string;
  rangeMin: number | null;
  rangeMax: number | null;
  color?: string | null;
  role?: string | null;
  aggregateMethod: AggregateMethod;
  /** Seconds; used as time-bucket width. Falls back to 60. */
  sampleIntervalSeconds?: number | null;
  machines: MachineSeriesSlice[];
};

const DEFAULT_BUCKET_SECONDS = 60;

export function bucketMsFor(sampleIntervalSeconds: number | null | undefined): number {
  const seconds =
    typeof sampleIntervalSeconds === "number" &&
    Number.isFinite(sampleIntervalSeconds) &&
    sampleIntervalSeconds > 0
      ? sampleIntervalSeconds
      : DEFAULT_BUCKET_SECONDS;
  return Math.max(1, Math.round(seconds)) * 1000;
}

function bucketStart(t: number, bucketMs: number, tMin: number): number {
  return tMin + Math.floor((t - tMin) / bucketMs) * bucketMs;
}

type MachineBucketValue = { t: number; value: number };

/**
 * Per machine: one value per bucket = last finite sample in that bucket.
 * Then combine across machines with the parameter's aggregate method.
 *
 * - sum / avg / min / max: over machine bucket values
 * - last: the finite sample with the latest timestamp among all machines in the bucket
 * - count: number of machines that contributed a finite sample in the bucket
 *
 * Y scale still uses the parameter range (percent), same as machine cards.
 * Sum can exceed 100%; the chart already auto-rescales.
 */
export function aggregateParameterSeries(
  input: AggregateParamInput,
  timeDomain: { tMin: number; tMax: number },
): TrendSeriesInput {
  const bucketMs = bucketMsFor(input.sampleIntervalSeconds);
  const { tMin, tMax } = timeDomain;

  /** bucketStart → list of per-machine contributions (with their sample times) */
  const buckets = new Map<number, MachineBucketValue[]>();

  for (const machine of input.machines) {
    const byBucket = new Map<number, MachineBucketValue>();
    for (const point of machine.points) {
      if (!point || typeof point.timestamp !== "string") continue;
      const t = Date.parse(point.timestamp);
      if (!Number.isFinite(t) || t < tMin || t > tMax) continue;
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      const start = bucketStart(t, bucketMs, tMin);
      const prev = byBucket.get(start);
      if (!prev || t >= prev.t) {
        byBucket.set(start, { t, value: point.value });
      }
    }
    for (const [start, entry] of byBucket) {
      const list = buckets.get(start) ?? [];
      list.push(entry);
      buckets.set(start, list);
    }
  }

  const starts = [...buckets.keys()].sort((a, b) => a - b);
  const points: TrendSample[] = starts.map((start) => {
    const contributions = buckets.get(start) ?? [];
    const values = contributions.map((entry) => entry.value);
    let value: number | null = null;
    switch (input.aggregateMethod) {
      case "sum":
        value = values.length === 0 ? null : values.reduce((acc, item) => acc + item, 0);
        break;
      case "avg":
        value =
          values.length === 0
            ? null
            : values.reduce((acc, item) => acc + item, 0) / values.length;
        break;
      case "min":
        value = values.length === 0 ? null : Math.min(...values);
        break;
      case "max":
        value = values.length === 0 ? null : Math.max(...values);
        break;
      case "count":
        value = values.length;
        break;
      case "last": {
        if (contributions.length === 0) {
          value = null;
        } else {
          let best = contributions[0];
          for (let index = 1; index < contributions.length; index += 1) {
            if (contributions[index].t >= best.t) best = contributions[index];
          }
          value = best.value;
        }
        break;
      }
      default:
        value = null;
    }
    return {
      timestamp: new Date(start + bucketMs / 2).toISOString(),
      value,
    };
  });

  return {
    parameterId: input.parameterId,
    label: input.label,
    unit: input.unit,
    rangeMin: input.rangeMin,
    rangeMax: input.rangeMax,
    color: input.color,
    role: input.role,
    points,
  };
}

export function buildAggregateSeries(
  params: AggregateParamInput[],
  timeDomain: { tMin: number; tMax: number },
): TrendSeriesInput[] {
  return params.map((param) => aggregateParameterSeries(param, timeDomain));
}
