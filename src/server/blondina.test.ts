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
    expect(nextGeneratedValue(50, 0, 100, () => 0.5)).toBe(50);
    expect(nextGeneratedValue(5, 0, 100, () => 0.5)).toBeGreaterThanOrEqual(0);
    expect(nextGeneratedValue(5, 0, 100, () => 0.5)).toBeLessThanOrEqual(100);

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
    expect(db.appendDueSamples(new Date("2026-10-30T10:00:00.000Z"), () => 0.5, 1)).toBe(1);
    expect(db.appendDueSamples(new Date("2026-10-30T10:00:30.000Z"), () => 0.5, 1)).toBe(0);
    expect(db.appendDueSamples(new Date("2026-10-30T10:01:00.000Z"), () => 0.5, 1)).toBe(1);

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

  it("speeds up live samples by the runtime factor without changing stored interval", () => {
    const db = openBlondina(":memory:");
    const spindle = db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")!;
    db.updateParameter({
      ...spindle,
      rangeMin: 0,
      rangeMax: 1000,
      sampleIntervalSeconds: 60,
      machineIds: ["LATHE_01"],
    });
    expect(db.appendDueSamples(new Date("2026-10-30T10:00:00.000Z"), () => 0.5, 2)).toBe(1);
    // Factor 2 → due every 30s; still skipped at +20s.
    expect(db.appendDueSamples(new Date("2026-10-30T10:00:20.000Z"), () => 0.5, 2)).toBe(0);
    expect(db.appendDueSamples(new Date("2026-10-30T10:00:30.000Z"), () => 0.5, 2)).toBe(1);
    expect(db.getState().parameters.find((p) => p.id === "spindle_speed")?.sampleIntervalSeconds).toBe(60);
    db.close();
  });

  it("persists aggregate_method on parameter edit", () => {
    const db = openBlondina(":memory:");
    const spindle = db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")!;
    expect(spindle.aggregateMethod).toBe("avg");

    db.updateParameter({
      ...spindle,
      aggregateMethod: "max",
    });
    expect(db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")?.aggregateMethod).toBe(
      "max",
    );

    db.updateParameter({
      ...spindle,
      aggregateMethod: "sum",
    });
    expect(db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")?.aggregateMethod).toBe(
      "sum",
    );

    expect(() =>
      db.updateParameter({
        ...spindle,
        aggregateMethod: "nope",
      }),
    ).toThrow(BlondinaInputError);
    db.close();
  });

  it("clears measurements for one selected machine only", () => {
    const db = openBlondina(":memory:");
    const spindle = db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")!;
    db.updateParameter({
      ...spindle,
      rangeMin: 0,
      rangeMax: 1000,
      sampleIntervalSeconds: 60,
      machineIds: ["LATHE_01", "LATHE_02"],
    });
    const period = { from: "2026-10-30T10:00:00.000Z", to: "2026-10-30T10:05:00.000Z" };
    db.generate(period, () => 0.5);
    expect(db.listMeasurements({ machineId: "LATHE_01", limit: 20 }).length).toBeGreaterThan(0);
    expect(db.listMeasurements({ machineId: "LATHE_02", limit: 20 }).length).toBeGreaterThan(0);

    const deleted = db.clearMeasurements("LATHE_01");
    expect(deleted).toBeGreaterThan(0);
    expect(db.listMeasurements({ machineId: "LATHE_01", limit: 20 })).toHaveLength(0);
    expect(db.listMeasurements({ machineId: "LATHE_02", limit: 20 }).length).toBeGreaterThan(0);
    expect(() => db.clearMeasurements("MISSING")).toThrow(BlondinaInputError);
    db.close();
  });

  it("filters recent measurements by one parameter and optionally machine", () => {
    const db = openBlondina(":memory:");
    const spindle = db.getState().parameters.find((parameter) => parameter.id === "spindle_speed")!;
    const idle = db.getState().parameters.find((parameter) => parameter.id === "idle_time")!;
    db.updateParameter({
      ...spindle,
      rangeMin: 0,
      rangeMax: 1000,
      sampleIntervalSeconds: 60,
      machineIds: ["LATHE_01", "LATHE_02"],
    });
    db.updateParameter({
      ...idle,
      rangeMin: 0,
      rangeMax: 100,
      sampleIntervalSeconds: 60,
      machineIds: ["LATHE_01", "LATHE_02"],
    });
    const period = { from: "2026-10-30T10:00:00.000Z", to: "2026-10-30T10:05:00.000Z" };
    db.generate(period, () => 0.5);

    const byParameter = db.listMeasurements({ parameterId: "spindle_speed", limit: 50 });
    expect(byParameter.length).toBeGreaterThan(0);
    expect(byParameter.every((row) => row.parameterId === "spindle_speed")).toBe(true);
    expect(byParameter.some((row) => row.machineId === "LATHE_01")).toBe(true);
    expect(byParameter.some((row) => row.machineId === "LATHE_02")).toBe(true);

    const combined = db.listMeasurements({
      machineId: "LATHE_01",
      parameterId: "idle_time",
      limit: 50,
    });
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.every((row) => row.machineId === "LATHE_01" && row.parameterId === "idle_time")).toBe(
      true,
    );
    db.close();
  });

  it("does not auto-generate status samples and records manual status with comment events", () => {
    const db = openBlondina(":memory:");
    db.createParameter({
      id: "machine_status",
      label: "Състояние",
      role: "status",
      states: [
        { value: 0, label: "работи", color: "#3ddc97" },
        { value: 1, label: "авария", color: "#e53935" },
        { value: 2, label: "технологичен престой", color: "#f0b429" },
      ],
      machineIds: ["LATHE_01"],
    });
    const period = { from: "2026-10-30T10:00:00.000Z", to: "2026-10-30T10:05:00.000Z" };
    const generated = db.generate(period, () => 0.5);
    expect(generated.skipped.some((row) => row.parameterId === "machine_status")).toBe(true);
    expect(db.listMeasurements({ machineId: "LATHE_01", limit: 20 })).toHaveLength(0);
    expect(db.appendDueSamples(new Date("2026-10-30T10:00:00.000Z"), () => 0.5, 1)).toBe(0);

    const t1 = new Date(Date.now() - 30 * 60_000);
    const t2 = new Date(Date.now() - 20 * 60_000);
    const t3 = new Date(Date.now() - 10 * 60_000);

    const set = db.setMachineStatus({ machineId: "LATHE_01", value: 1 }, t1);
    expect(set.label).toBe("авария");
    expect(set.comment).toBe("");

    const withComment = db.setMachineStatusComment(
      { machineId: "LATHE_01", comment: "прогнозно 2 часа" },
      t2,
    );
    expect(withComment.comment).toBe("прогнозно 2 часа");
    expect(withComment.label).toBe("авария");

    const back = db.setMachineStatus({ machineId: "LATHE_01", value: 0 }, t3);
    expect(back.label).toBe("работи");
    expect(back.comment).toBe("прогнозно 2 часа");

    const reading = db.readDashboard(24 * 60 * 60_000);
    const machine = reading.machines.find((row) => row.id === "LATHE_01");
    expect(machine?.manualStatus?.label).toBe("работи");
    expect(machine?.manualStatus?.comment).toBe("прогнозно 2 часа");
    expect(machine?.series.find((s) => s.parameterId === "machine_status")?.points.length).toBe(2);
    expect(reading.statusEvents.map((event) => event.kind)).toEqual([
      "status_change",
      "comment_update",
      "status_change",
    ]);
    expect(reading.statusEvents.some((event) => event.comment === "прогнозно 2 часа")).toBe(true);
    db.close();
  });
});
