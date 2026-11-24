import { describe, expect, it } from "vitest";
import {
  aggregateDisplayRange,
  aggregateParameterSeries,
  bucketMsFor,
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
});
