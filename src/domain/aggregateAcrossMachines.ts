import type { AggregateMethod } from "./aggregateMethod";
import {
  evaluateFormulaSeries,
  type FormulaSeriesLookup,
} from "./formulaEval";
import type { TrendSample, TrendSeriesInput } from "./machineTrend";
import { resolveParameterRole } from "./parameterRole";

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
  /**
   * For report role: per-machine plan samples. Report increments count only
   * after each machine's latest plan (same cut as the progress ring).
   */
  planByMachine?: MachineSeriesSlice[];
  /** For role=formula: expression text. */
  formula?: string | null;
  /** Lookup used when evaluating {@link formula}. */
  formulaLookup?: FormulaSeriesLookup | null;
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

type FiniteSample = { t: number; value: number };

function finiteSamples(points: TrendSample[]): FiniteSample[] {
  return [...points]
    .filter((point) => point && typeof point.timestamp === "string")
    .map((point) => {
      const t = Date.parse(point.timestamp);
      const value =
        typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null;
      return { t: Number.isFinite(t) ? t : NaN, value };
    })
    .filter(
      (point): point is { t: number; value: number } =>
        Number.isFinite(point.t) && point.value != null,
    )
    .sort((a, b) => a.t - b.t);
}

function lastPlanOf(points: TrendSample[] | undefined): FiniteSample | null {
  const samples = finiteSamples(points ?? []);
  return samples.at(-1) ?? null;
}

type MachineBucketValue = { t: number; value: number };

/**
 * Display range for the aggregate series.
 * - report (post-plan cumulative sum): 0 … sum of latest plan targets
 * - sum of ordinary metrics: n × per-machine bounds
 * - count: 0 … n
 */
export function aggregateDisplayRange(
  method: AggregateMethod,
  rangeMin: number | null,
  rangeMax: number | null,
  machineCount: number,
  options?: { reportPlanTotal?: number | null },
): { rangeMin: number | null; rangeMax: number | null } {
  if (
    options?.reportPlanTotal != null &&
    Number.isFinite(options.reportPlanTotal) &&
    options.reportPlanTotal > 0
  ) {
    return { rangeMin: 0, rangeMax: options.reportPlanTotal };
  }
  const n = Math.max(1, machineCount);
  if (method === "count") return { rangeMin: 0, rangeMax: n };
  if (
    method === "sum" &&
    typeof rangeMin === "number" &&
    Number.isFinite(rangeMin) &&
    typeof rangeMax === "number" &&
    Number.isFinite(rangeMax)
  ) {
    return { rangeMin: rangeMin * n, rangeMax: rangeMax * n };
  }
  return { rangeMin, rangeMax };
}

/**
 * Report aggregate: sum increments after each machine's latest plan, then
 * accumulate over time (same post-last-plan cut as the progress ring).
 * Y 100% = sum of those latest plan targets.
 */
function aggregateReportSeries(
  input: AggregateParamInput,
  timeDomain: { tMin: number; tMax: number },
): TrendSeriesInput {
  const bucketMs = bucketMsFor(input.sampleIntervalSeconds);
  const { tMin, tMax } = timeDomain;
  const planById = new Map(
    (input.planByMachine ?? []).map((row) => [row.machineId, row.points] as const),
  );

  /** bucketStart → summed increments in that bucket (all machines) */
  const bucketIncrements = new Map<number, number>();
  let planTotal = 0;
  let machinesWithPlan = 0;

  for (const machine of input.machines) {
    const lastPlan = lastPlanOf(planById.get(machine.machineId));
    if (!lastPlan || lastPlan.value <= 0) continue;
    machinesWithPlan += 1;
    planTotal += lastPlan.value;

    for (const sample of finiteSamples(machine.points)) {
      if (sample.t <= lastPlan.t) continue;
      if (sample.t < tMin || sample.t > tMax) continue;
      const start = bucketStart(sample.t, bucketMs, tMin);
      bucketIncrements.set(start, (bucketIncrements.get(start) ?? 0) + sample.value);
    }
  }

  const starts = [...bucketIncrements.keys()].sort((a, b) => a - b);
  let running = 0;
  const points: TrendSample[] = starts.map((start) => {
    running += bucketIncrements.get(start) ?? 0;
    return {
      timestamp: new Date(start + bucketMs / 2).toISOString(),
      value: running,
    };
  });

  const displayRange = aggregateDisplayRange("sum", input.rangeMin, input.rangeMax, machinesWithPlan, {
    reportPlanTotal: planTotal > 0 ? planTotal : null,
  });

  return {
    parameterId: input.parameterId,
    label: input.label,
    unit: input.unit,
    rangeMin: displayRange.rangeMin,
    rangeMax: displayRange.rangeMax,
    color: input.color,
    role: input.role,
    points,
  };
}

/**
 * Plan targets stay in force until replaced. Aggregate buckets only emit points
 * where samples exist (mid-bucket), so without a hold the line stops short of
 * the visible X window — especially with long plan intervals (e.g. 1h).
 */
export function holdPlanToWindowEnd(points: TrendSample[], tMax: number): TrendSample[] {
  if (points.length === 0) return points;
  const last = points[points.length - 1]!;
  if (typeof last.value !== "number" || !Number.isFinite(last.value)) return points;
  const lastT = Date.parse(last.timestamp);
  if (!Number.isFinite(lastT) || lastT >= tMax) return points;
  return [...points, { timestamp: new Date(tMax).toISOString(), value: last.value }];
}

/**
 * Per machine: one value per bucket = last finite sample in that bucket.
 * Then combine across machines with the parameter's aggregate method.
 *
 * Report role is special — see {@link aggregateReportSeries}.
 * Plan role holds the last aggregate value to tMax so the series reaches the
 * right edge of the shared X window.
 *
 * - sum / avg / min / max: over machine bucket values
 * - last: the finite sample with the latest timestamp among all machines in the bucket
 * - count: number of machines that contributed a finite sample in the bucket
 */
function aggregateFormulaSeries(
  input: AggregateParamInput,
  timeDomain: { tMin: number; tMax: number },
): TrendSeriesInput {
  const formula = (input.formula ?? "").trim();
  const lookup = input.formulaLookup;
  let points: TrendSample[] = [];
  if (formula && lookup) {
    const evaluated = evaluateFormulaSeries(formula, lookup, timeDomain);
    if (evaluated.ok) points = evaluated.points;
  }
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

export function aggregateParameterSeries(
  input: AggregateParamInput,
  timeDomain: { tMin: number; tMax: number },
): TrendSeriesInput {
  const role = resolveParameterRole(input.label, input.parameterId, input.role);
  if (role === "formula") {
    return aggregateFormulaSeries(input, timeDomain);
  }
  if (role === "report") {
    return aggregateReportSeries(
      { ...input, aggregateMethod: "sum" },
      timeDomain,
    );
  }

  const bucketMs = bucketMsFor(input.sampleIntervalSeconds);
  const { tMin, tMax } = timeDomain;
  const machineCount = input.machines.length;

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

  const displayRange = aggregateDisplayRange(
    input.aggregateMethod,
    input.rangeMin,
    input.rangeMax,
    machineCount,
  );

  return {
    parameterId: input.parameterId,
    label: input.label,
    unit: input.unit,
    rangeMin: displayRange.rangeMin,
    rangeMax: displayRange.rangeMax,
    color: input.color,
    role: input.role,
    points: role === "plan" ? holdPlanToWindowEnd(points, tMax) : points,
  };
}

export function buildAggregateSeries(
  params: AggregateParamInput[],
  timeDomain: { tMin: number; tMax: number },
): TrendSeriesInput[] {
  return params.map((param) => aggregateParameterSeries(param, timeDomain));
}
