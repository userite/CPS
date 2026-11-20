import { describe, expect, it } from "vitest";
import { BlondinaInputError, nextGeneratedValue, normalizeColor, openBlondina } from "./blondina";

describe("blondina", () => {
  it("seeds four machines and four parameters without ranges", () => {
    const db = openBlondina(":memory:");
    const state = db.getState();
    expect(state.machines.map((machine) => machine.id)).toEqual([
      "MACH_03",
      "MACH_04",
      "LATHE_01",
      "LATHE_02",
    ]);
    expect(state.parameters).toHaveLength(4);
    expect(state.parameters.every((parameter) => parameter.rangeMin == null && parameter.machineIds.length === 4)).toBe(
      true,
    );
    expect(state.measurementCount).toBe(0);
    db.close();
  });

  it("skips generation until a range and frequency exist", () => {
    const db = openBlondina(":memory:");
    const period = { from: "2026-10-30T10:00:00.000Z", to: "2026-10-30T10:10:00.000Z" };
    const skipped = db.generate(period, () => 0.5);
    expect(skipped.inserted).toBe(0);
    expect(skipped.skipped).toHaveLength(16);

    const spindle = db.getState().parameters.find((parameter) => parameter.id === "spindle_speed");
    expect(spindle).toBeTruthy();
    db.updateParameter({
      id: spindle!.id,
      label: spindle!.label,
      unit: spindle!.unit,
      rangeMin: 0,
      rangeMax: 1000,
      sampleIntervalSeconds: 60,
      machineIds: ["LATHE_01"],
    });

    const generated = db.generate(period, () => 0.5);
    expect(generated.inserted).toBe(11);
    const rows = db.listMeasurements({ machineId: "LATHE_01", limit: 20 });
    expect(rows).toHaveLength(11);
    expect(rows.every((row) => row.value === 500)).toBe(true);

    db.generate(period, () => 0);
    const outside = db.listMeasurements({ machineId: "LATHE_01", limit: 20 });
    expect(outside.some((row) => row.value != null && row.value < 0)).toBe(true);
    expect(outside.every((row) => row.value != null && row.value >= -200 && row.value <= 1200)).toBe(true);

    db.deleteMachine("LATHE_01");
    expect(db.listMeasurements({ machineId: "LATHE_01" })).toHaveLength(0);
    db.close();
  });

  it("rejects an inverted range and accepts a fifth parameter", () => {
    const db = openBlondina(":memory:");
    const spindle = db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")!;
    expect(() =>
      db.updateParameter({
        ...spindle,
        rangeMin: 10,
        rangeMax: 1,
        sampleIntervalSeconds: 60,
      }),
    ).toThrow(BlondinaInputError);

    db.createParameter({
      id: "cycle_time",
      label: "Време на цикъл",
      unit: "сек",
      rangeMin: null,
      rangeMax: null,
      sampleIntervalSeconds: null,
      machineIds: ["LATHE_02"],
    });
    const created = db.getState().parameters.find((parameter) => parameter.id === "cycle_time");
    expect(created?.machineIds).toEqual(["LATHE_02"]);
    expect(created?.color).toBeNull();
    expect(created?.role).toBe("metric");
    expect(created?.states).toEqual([]);

    db.updateParameter({ ...created!, color: "#929292" });
    expect(db.getState().parameters.find((parameter) => parameter.id === "cycle_time")?.color).toBe("#929292");
    expect(() => db.updateParameter({ ...created!, color: "синьо" })).toThrow(BlondinaInputError);
    expect(() => normalizeColor("#FF0000")).toThrow(BlondinaInputError);
    expect(() => normalizeColor("#ff0000")).toThrow(BlondinaInputError);
    expect(normalizeColor("")).toBeNull();
    expect(nextGeneratedValue(0, 0, 100, () => 0)).toBeLessThan(0);

    db.createParameter({
      id: "machine_status",
      label: "Състояние",
      role: "status",
      sampleIntervalSeconds: 60,
      states: [
        { value: 0, label: "работи", color: "#3ddc97" },
        { value: 1, label: "авария", color: "#e53935" },
      ],
      machineIds: ["LATHE_01"],
    });
    const status = db.getState().parameters.find((parameter) => parameter.id === "machine_status");
    expect(status?.role).toBe("status");
    expect(status?.states).toHaveLength(2);
    expect(status?.rangeMin).toBe(0);
    expect(status?.rangeMax).toBe(1);
    db.close();
  });

  it("writes a new sample only when the parameter interval has elapsed", () => {
    const db = openBlondina(":memory:");
    const spindle = db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")!;
    db.updateParameter({
      ...spindle,
      rangeMin: 0,
      rangeMax: 1000,
      sampleIntervalSeconds: 60,
      machineIds: ["LATHE_01"],
    });
    expect(db.appendDueSamples(new Date("2026-10-30T10:00:00.000Z"), () => 0.5)).toBe(1);
    expect(db.appendDueSamples(new Date("2026-10-30T10:00:30.000Z"), () => 0.5)).toBe(0);
    expect(db.appendDueSamples(new Date("2026-10-30T10:01:00.000Z"), () => 0.5)).toBe(1);

    const reading = db.readFirstObject(10 * 365 * 24 * 60 * 60_000);
    expect(reading.machine?.id).toBe("LATHE_01");
    expect(reading.charts).toHaveLength(4);
    expect(reading.charts.filter((chart) => chart.writable)).toHaveLength(1);
    const spindleChart = reading.charts.find((chart) => chart.parameterId === "spindle_speed");
    expect(spindleChart?.points).toHaveLength(2);
    expect(spindleChart?.points.every((point) => point.value != null && point.value >= 0 && point.value <= 1000)).toBe(
      true,
    );
    db.close();
  });
});
