import { describe, expect, it } from "vitest";
import {
  canonicalizeCallName,
  evaluateFormulaSeries,
  parseFormula,
  type FormulaMachineSlice,
  type FormulaSeriesLookup,
} from "./formulaEval";

const domain = {
  tMin: Date.parse("2026-11-23T10:00:00.000Z"),
  tMax: Date.parse("2026-11-23T12:00:00.000Z"),
};

function lookupFrom(map: Record<string, FormulaMachineSlice[]>): FormulaSeriesLookup {
  return {
    sampleIntervalSeconds: 60,
    resolve(ref) {
      const key = ref.toLowerCase();
      return map[key] ?? null;
    },
  };
}

describe("formulaEval parse", () => {
  it("parses the example ratio formula", () => {
    const parsed = parseFormula("sum_since_last_plan(report) / sum(last(plan))");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.ast.kind).toBe("binary");
  });

  it("accepts Bulgarian alias sum_sled_last_plan", () => {
    expect(canonicalizeCallName("sum_sled_last_plan")).toBe("sum_since_last_plan");
    const parsed = parseFormula("sum_sled_last_plan(report) / sum(last(plan))");
    expect(parsed.ok).toBe(true);
  });

  it("rejects empty and garbage", () => {
    expect(parseFormula("").ok).toBe(false);
    expect(parseFormula("sum(").ok).toBe(false);
    expect(parseFormula("1 +").ok).toBe(false);
  });
});

describe("formulaEval evaluate", () => {
  const plan: FormulaMachineSlice[] = [
    {
      machineId: "A",
      points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 100 }],
    },
    {
      machineId: "B",
      points: [{ timestamp: "2026-11-23T10:05:00.000Z", value: 50 }],
    },
  ];

  const report: FormulaMachineSlice[] = [
    {
      machineId: "A",
      points: [
        { timestamp: "2026-11-23T10:00:00.000Z", value: 5 }, // before plan — ignored
        { timestamp: "2026-11-23T10:10:00.000Z", value: 10 },
        { timestamp: "2026-11-23T10:20:00.000Z", value: 15 },
      ],
    },
    {
      machineId: "B",
      points: [{ timestamp: "2026-11-23T10:15:00.000Z", value: 20 }],
    },
  ];

  it("evaluates sum(last(plan)) as scalar across machines", () => {
    const result = evaluateFormulaSeries(
      "sum(last(plan))",
      lookupFrom({ plan, report }),
      domain,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scalar).toBe(150);
    expect(result.points).toHaveLength(2);
    expect(result.points[0].value).toBe(150);
  });

  it("evaluates sum_since_last_plan(report) as sawtooth series", () => {
    const result = evaluateFormulaSeries(
      "sum_since_last_plan(report)",
      lookupFrom({ plan, report }),
      domain,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const values = result.points.map((p) => p.value);
    // A: 10+15, B: 20 → ends at 45 (single plan each)
    expect(values.at(-1)).toBe(45);
  });

  it("does not wipe earlier segments when a late plan sample arrives", () => {
    const latePlan: FormulaMachineSlice[] = [
      {
        machineId: "A",
        points: [
          { timestamp: "2026-11-23T10:05:00.000Z", value: 100 },
          { timestamp: "2026-11-23T11:50:00.000Z", value: 100 },
        ],
      },
    ];
    const lateReport: FormulaMachineSlice[] = [
      {
        machineId: "A",
        points: [
          { timestamp: "2026-11-23T10:10:00.000Z", value: 10 },
          { timestamp: "2026-11-23T10:20:00.000Z", value: 15 },
          { timestamp: "2026-11-23T11:55:00.000Z", value: 4 },
        ],
      },
    ];
    const result = evaluateFormulaSeries(
      "sum_since_last_plan(report)",
      lookupFrom({ plan: latePlan, report: lateReport }),
      domain,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const values = result.points.map((p) => p.value);
    expect(values).toContain(10);
    expect(values).toContain(25);
    expect(values.at(-1)).toBe(4);
  });

  it("evaluates report/plan ratio series", () => {
    const result = evaluateFormulaSeries(
      "sum_since_last_plan(report) / sum(last(plan))",
      lookupFrom({ plan, report }),
      domain,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.scalar).toBeCloseTo(45 / 150, 6);
  });

  it("resolves parameter code as well as role", () => {
    const result = evaluateFormulaSeries(
      "sum(last(plan_qty))",
      lookupFrom({
        plan_qty: plan,
        report,
      }),
      domain,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scalar).toBe(150);
  });

  it("returns error when plan is missing for ratio", () => {
    const result = evaluateFormulaSeries(
      "sum_since_last_plan(report) / sum(last(plan))",
      lookupFrom({ report }),
      domain,
    );
    expect(result.ok).toBe(false);
  });
});
