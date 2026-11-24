import { describe, expect, it } from "vitest";
import { DEFAULT_STATUS_STATES } from "./parameterRole";
import { buildRangeEvents, isOutOfRange, rangeEventSeriesFromMachines } from "./rangeEvents";

const t0 = "2026-11-24T08:00:00.000Z";
const t1 = "2026-11-24T08:01:00.000Z";
const t2 = "2026-11-24T08:02:00.000Z";
const t3 = "2026-11-24T08:03:00.000Z";
const t4 = "2026-11-24T08:04:00.000Z";

describe("isOutOfRange", () => {
  it("marks metric values outside the numeric range", () => {
    const metric = {
      role: "metric",
      label: "Скорост",
      parameterId: "speed",
      rangeMin: 0,
      rangeMax: 100,
    };
    expect(isOutOfRange(50, metric)).toBe(false);
    expect(isOutOfRange(0, metric)).toBe(false);
    expect(isOutOfRange(100, metric)).toBe(false);
    expect(isOutOfRange(-1, metric)).toBe(true);
    expect(isOutOfRange(101, metric)).toBe(true);
  });

  it("treats non-nominal status states as out of range", () => {
    const status = {
      role: "status",
      label: "Статус",
      parameterId: "st",
      rangeMin: 0,
      rangeMax: 2,
      states: DEFAULT_STATUS_STATES,
    };
    expect(isOutOfRange(0, status)).toBe(false);
    expect(isOutOfRange(1, status)).toBe(true);
    expect(isOutOfRange(2, status)).toBe(true);
  });
});

describe("buildRangeEvents", () => {
  it("emits one leave and one return for a metric that stays out then recovers", () => {
    const events = buildRangeEvents(
      [
        {
          machineId: "M1",
          machineName: "Струг 1",
          parameterId: "speed",
          label: "Скорост",
          unit: "об/мин",
          rangeMin: 0,
          rangeMax: 100,
          color: "#7ec8ff",
          role: "metric",
          points: [
            { timestamp: t0, value: 40 },
            { timestamp: t1, value: 130 },
            { timestamp: t2, value: 140 },
            { timestamp: t3, value: 150 },
            { timestamp: t4, value: 50 },
          ],
        },
      ],
      ["speed"],
    );
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("back_in_range");
    expect(events[0]?.timestamp).toBe(t4);
    expect(events[0]?.value).toBe(50);
    expect(events[1]?.kind).toBe("out_of_range");
    expect(events[1]?.timestamp).toBe(t1);
    expect(events[1]?.value).toBe(130);
    expect(events[1]?.color).toBe("#7ec8ff");
  });

  it("emits an out event when the series starts already outside", () => {
    const events = buildRangeEvents(
      [
        {
          machineId: "M1",
          machineName: "Струг 1",
          parameterId: "speed",
          label: "Скорост",
          unit: "об/мин",
          rangeMin: 0,
          rangeMax: 100,
          role: "metric",
          points: [
            { timestamp: t0, value: 120 },
            { timestamp: t1, value: 130 },
            { timestamp: t2, value: 40 },
          ],
        },
      ],
      ["speed"],
    );
    expect(events.map((e) => e.kind)).toEqual(["back_in_range", "out_of_range"]);
    expect(events[1]?.timestamp).toBe(t0);
  });

  it("edge-triggers status leave/return against the nominal state only", () => {
    const events = buildRangeEvents(
      [
        {
          machineId: "M1",
          machineName: "Струг 1",
          parameterId: "st",
          label: "Статус",
          unit: "",
          rangeMin: 0,
          rangeMax: 2,
          color: "#3ddc97",
          role: "status",
          states: DEFAULT_STATUS_STATES,
          points: [
            { timestamp: t0, value: 0 },
            { timestamp: t1, value: 1 },
            { timestamp: t2, value: 2 },
            { timestamp: t3, value: 1 },
            { timestamp: t4, value: 0 },
          ],
        },
      ],
      ["st"],
    );
    expect(events).toHaveLength(2);
    expect(events[1]?.kind).toBe("out_of_range");
    expect(events[1]?.timestamp).toBe(t1);
    expect(events[1]?.value).toBe(1);
    expect(events[0]?.kind).toBe("back_in_range");
    expect(events[0]?.timestamp).toBe(t4);
    expect(events[0]?.value).toBe(0);
  });

  it("skips plan/report roles", () => {
    const events = buildRangeEvents(
      [
        {
          machineId: "M1",
          machineName: "Струг 1",
          parameterId: "plan",
          label: "План",
          unit: "бр",
          rangeMin: 0,
          rangeMax: 100,
          role: "plan",
          points: [
            { timestamp: t0, value: 10 },
            { timestamp: t1, value: 200 },
          ],
        },
      ],
      ["plan"],
    );
    expect(events).toHaveLength(0);
  });

  it("flattens machines into metric and status series only", () => {
    const rows = rangeEventSeriesFromMachines([
      {
        id: "M1",
        name: "A",
        series: [
          {
            parameterId: "speed",
            label: "Скорост",
            unit: "x",
            rangeMin: 0,
            rangeMax: 1,
            role: "metric",
            points: [],
          },
          {
            parameterId: "st",
            label: "Статус",
            unit: "",
            rangeMin: 0,
            rangeMax: 2,
            role: "status",
            states: DEFAULT_STATUS_STATES,
            points: [],
          },
          {
            parameterId: "plan",
            label: "План",
            unit: "бр",
            rangeMin: 0,
            rangeMax: 100,
            role: "plan",
            points: [],
          },
        ],
      },
    ]);
    expect(rows.map((r) => r.parameterId)).toEqual(["speed", "st"]);
  });
});
