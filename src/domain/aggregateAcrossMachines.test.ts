import { describe, expect, it } from "vitest";
import {
  aggregateDisplayRange,
  aggregateParameterSeries,
  bucketMsFor,
  holdPlanToWindowEnd,
} from "./aggregateAcrossMachines";

const domain = {
  tMin: Date.parse("2026-11-23T10:00:00.000Z"),
  tMax: Date.parse("2026-11-23T11:00:00.000Z"),
};

describe("aggregateAcrossMachines", () => {
  it("uses sample interval as bucket width", () => {
    expect(bucketMsFor(30)).toBe(30_000);
    expect(bucketMsFor(null)).toBe(60_000);
  });

  it("sums and averages per-machine bucket values", () => {
    const base = {
      parameterId: "parts",
      label: "Детайли",
      unit: "бр",
      rangeMin: 0,
      rangeMax: 100,
      sampleIntervalSeconds: 60,
      machines: [
        {
          machineId: "A",
          points: [{ timestamp: "2026-11-23T10:00:10.000Z", value: 10 }],
        },
        {
          machineId: "B",
          points: [{ timestamp: "2026-11-23T10:00:20.000Z", value: 30 }],
        },
      ],
    };

    const sum = aggregateParameterSeries({ ...base, aggregateMethod: "sum" }, domain);
    expect(sum.points).toHaveLength(1);
    expect(sum.points[0].value).toBe(40);

    const avg = aggregateParameterSeries({ ...base, aggregateMethod: "avg" }, domain);
    expect(avg.points[0].value).toBe(20);

    const min = aggregateParameterSeries({ ...base, aggregateMethod: "min" }, domain);
    expect(min.points[0].value).toBe(10);

    const max = aggregateParameterSeries({ ...base, aggregateMethod: "max" }, domain);
    expect(max.points[0].value).toBe(30);

    const count = aggregateParameterSeries({ ...base, aggregateMethod: "count" }, domain);
    expect(count.points[0].value).toBe(2);
  });

  it("scales sum/count display range by machine count", () => {
    expect(aggregateDisplayRange("sum", 0, 100, 4)).toEqual({ rangeMin: 0, rangeMax: 400 });
    expect(aggregateDisplayRange("avg", 0, 100, 4)).toEqual({ rangeMin: 0, rangeMax: 100 });
    expect(aggregateDisplayRange("count", 0, 100, 4)).toEqual({ rangeMin: 0, rangeMax: 4 });

    const series = aggregateParameterSeries(
      {
        parameterId: "parts",
        label: "Детайли",
        unit: "бр",
        rangeMin: 0,
        rangeMax: 100,
        aggregateMethod: "sum",
        sampleIntervalSeconds: 60,
        machines: [
          { machineId: "A", points: [{ timestamp: "2026-11-23T10:00:10.000Z", value: 10 }] },
          { machineId: "B", points: [{ timestamp: "2026-11-23T10:00:20.000Z", value: 30 }] },
        ],
      },
      domain,
    );
    expect(series.points[0].value).toBe(40);
    expect(series.rangeMin).toBe(0);
    expect(series.rangeMax).toBe(200);
  });

  it("accumulates report increments only after each machine's latest plan", () => {
    expect(aggregateDisplayRange("sum", 1, 25, 2, { reportPlanTotal: 150 })).toEqual({
      rangeMin: 0,
      rangeMax: 150,
    });

    const series = aggregateParameterSeries(
      {
        parameterId: "report",
        label: "Отчет",
        unit: "бр",
        rangeMin: 1,
        rangeMax: 25,
        role: "report",
        aggregateMethod: "avg",
        sampleIntervalSeconds: 60,
        machines: [
          {
            machineId: "A",
            points: [
              { timestamp: "2026-11-23T10:00:10.000Z", value: 5 },
              { timestamp: "2026-11-23T10:05:10.000Z", value: 3 },
              { timestamp: "2026-11-23T10:06:10.000Z", value: 4 },
            ],
          },
          {
            machineId: "B",
            points: [
              { timestamp: "2026-11-23T10:00:10.000Z", value: 9 },
              { timestamp: "2026-11-23T10:05:40.000Z", value: 2 },
            ],
          },
        ],
        planByMachine: [
          {
            machineId: "A",
            points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 100 }],
          },
          {
            machineId: "B",
            points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 50 }],
          },
        ],
      },
      domain,
    );

    // Pre-plan samples (5 and 9) ignored; post-plan 3+4+2 = 9 at end.
    expect(series.rangeMin).toBe(0);
    expect(series.rangeMax).toBe(150);
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.points.at(-1)?.value).toBe(9);
    // First minute after plan: 3 (A) + 2 (B) in the same 60s bucket.
    expect(series.points[0]?.value).toBe(5);
    // Hold to window end.
    expect(Date.parse(series.points.at(-1)!.timestamp)).toBe(domain.tMax);
  });

  it("keeps earlier report segments when a later plan heartbeat arrives", () => {
    const series = aggregateParameterSeries(
      {
        parameterId: "report",
        label: "Отчет",
        unit: "бр",
        rangeMin: 0,
        rangeMax: 100,
        role: "report",
        aggregateMethod: "sum",
        sampleIntervalSeconds: 60,
        machines: [
          {
            machineId: "A",
            points: [
              { timestamp: "2026-11-23T10:10:00.000Z", value: 10 },
              { timestamp: "2026-11-23T10:20:00.000Z", value: 7 },
              { timestamp: "2026-11-23T10:50:00.000Z", value: 3 },
            ],
          },
        ],
        planByMachine: [
          {
            machineId: "A",
            points: [
              { timestamp: "2026-11-23T10:05:00.000Z", value: 100 },
              { timestamp: "2026-11-23T10:40:00.000Z", value: 100 },
            ],
          },
        ],
      },
      domain,
    );

    // After first plan: 10 then 17; reset at second plan; then 3.
    expect(series.points.length).toBeGreaterThan(2);
    const values = series.points.map((p) => p.value);
    expect(values).toContain(10);
    expect(values).toContain(17);
    expect(values.at(-1)).toBe(3);
  });

  it("evaluates formula role with sum_since_last_plan / sum(last(plan))", () => {
    const plan = [
      { machineId: "A", points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 100 }] },
      { machineId: "B", points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 50 }] },
    ];
    const report = [
      {
        machineId: "A",
        points: [
          { timestamp: "2026-11-23T10:06:00.000Z", value: 10 },
          { timestamp: "2026-11-23T10:07:00.000Z", value: 5 },
        ],
      },
      {
        machineId: "B",
        points: [{ timestamp: "2026-11-23T10:06:30.000Z", value: 15 }],
      },
    ];
    const byKey = new Map<string, typeof plan>([
      ["plan", plan],
      ["report", report],
    ]);
    const series = aggregateParameterSeries(
      {
        parameterId: "report_vs_plan",
        label: "Отчет спрямо план",
        unit: "",
        rangeMin: 0,
        rangeMax: 1,
        role: "formula",
        aggregateMethod: "sum",
        formula: "sum_since_last_plan(report) / sum(last(plan))",
        formulaLookup: {
          sampleIntervalSeconds: 60,
          resolve: (ref) => byKey.get(ref.toLowerCase()) ?? null,
        },
        machines: [],
      },
      domain,
    );
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.points.at(-1)?.value).toBeCloseTo(30 / 150, 6);
  });

  it("picks the latest sample across machines for last", () => {
    const series = aggregateParameterSeries(
      {
        parameterId: "temp",
        label: "Температура",
        unit: "°C",
        rangeMin: 0,
        rangeMax: 100,
        aggregateMethod: "last",
        sampleIntervalSeconds: 60,
        machines: [
          {
            machineId: "A",
            points: [{ timestamp: "2026-11-23T10:00:10.000Z", value: 40 }],
          },
          {
            machineId: "B",
            points: [{ timestamp: "2026-11-23T10:00:40.000Z", value: 55 }],
          },
        ],
      },
      domain,
    );
    expect(series.points[0].value).toBe(55);
  });

  it("holds plan aggregate to tMax so the line reaches the window end", () => {
    const held = holdPlanToWindowEnd(
      [{ timestamp: "2026-11-23T10:30:00.000Z", value: 400 }],
      domain.tMax,
    );
    expect(held).toHaveLength(2);
    expect(held[1]).toEqual({
      timestamp: new Date(domain.tMax).toISOString(),
      value: 400,
    });
    expect(holdPlanToWindowEnd(held, domain.tMax)).toEqual(held);

    // Hourly plan buckets place the last point at mid-bucket; without a hold
    // the polyline stops well before the shared X domain end (~now).
    const series = aggregateParameterSeries(
      {
        parameterId: "plan",
        label: "План",
        unit: "бр",
        rangeMin: 0,
        rangeMax: 1000,
        role: "plan",
        aggregateMethod: "sum",
        sampleIntervalSeconds: 3600,
        machines: [
          {
            machineId: "A",
            points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 100 }],
          },
          {
            machineId: "B",
            points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 50 }],
          },
        ],
      },
      domain,
    );
    expect(series.points.length).toBeGreaterThanOrEqual(2);
    expect(series.points.at(-1)).toEqual({
      timestamp: new Date(domain.tMax).toISOString(),
      value: 150,
    });
    const prior = series.points.at(-2);
    expect(prior?.value).toBe(150);
    expect(Date.parse(prior!.timestamp)).toBeLessThan(domain.tMax);
  });

  it("does not hold non-plan metrics to tMax", () => {
    const series = aggregateParameterSeries(
      {
        parameterId: "parts",
        label: "Детайли",
        unit: "бр",
        rangeMin: 0,
        rangeMax: 100,
        role: "metric",
        aggregateMethod: "sum",
        sampleIntervalSeconds: 3600,
        machines: [
          {
            machineId: "A",
            points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 10 }],
          },
        ],
      },
      domain,
    );
    expect(series.points).toHaveLength(1);
    expect(Date.parse(series.points[0]!.timestamp)).toBeLessThan(domain.tMax);
  });
});
