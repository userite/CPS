/**
 * Formula DSL for aggregate-chart parameters (role = formula).
 *
 * Shape (extensible):
 *   expr  := term (('+'|'-') term)*
 *   term  := factor (('*'|'/') factor)*
 *   factor:= number | call | '(' expr ')'
 *   call  := name '(' arg ')'
 *   arg   := ident | call
 *
 * Aggregates over a parameter series in the chart window:
 *   sum, avg, last, min, max, count
 *
 * Special:
 *   sum_since_last_plan(report) — sum of report samples after the last plan
 *   sample (same cut as the progress ring). Bulgarian-friendly alias:
 *   sum_sled_last_plan
 *
 * Parameter refs: role shortcuts `plan` / `report`, or a parameter code id.
 */

import type { TrendSample } from "./machineTrend";

export type FormulaParamRef = string;

export type FormulaAst =
  | { kind: "number"; value: number }
  | { kind: "ref"; name: FormulaParamRef }
  | { kind: "call"; name: string; arg: FormulaAst }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: FormulaAst; right: FormulaAst };

export type FormulaMachineSlice = {
  machineId: string;
  points: TrendSample[];
};

export type FormulaSeriesLookup = {
  /** Role shortcuts and parameter ids → per-machine samples. */
  resolve: (ref: string) => FormulaMachineSlice[] | null;
  sampleIntervalSeconds?: number | null;
};

export type FormulaEvalError = {
  message: string;
  position?: number;
};

export type FormulaParseResult =
  | { ok: true; ast: FormulaAst }
  | { ok: false; error: FormulaEvalError };

const CALL_ALIASES: Record<string, string> = {
  sum_sled_last_plan: "sum_since_last_plan",
};

const SCALAR_AGGREGATES = new Set(["sum", "avg", "last", "min", "max", "count"]);

export function canonicalizeCallName(name: string): string {
  const key = name.trim().toLowerCase();
  return CALL_ALIASES[key] ?? key;
}

export function parseFormula(source: string): FormulaParseResult {
  const text = source.trim();
  if (!text) return { ok: false, error: { message: "Формулата е празна.", position: 0 } };

  let i = 0;

  function peek(): string {
    return text[i] ?? "";
  }

  function skipWs(): void {
    while (/\s/.test(peek())) i += 1;
  }

  function match(ch: string): boolean {
    skipWs();
    if (peek() === ch) {
      i += 1;
      return true;
    }
    return false;
  }

  function parseIdent(): string | null {
    skipWs();
    const start = i;
    if (!/[A-Za-z_]/.test(peek())) return null;
    i += 1;
    while (/[A-Za-z0-9_]/.test(peek())) i += 1;
    return text.slice(start, i);
  }

  function parseNumber(): FormulaAst | null {
    skipWs();
    const start = i;
    if (!/[0-9.]/.test(peek())) return null;
    while (/[0-9]/.test(peek())) i += 1;
    if (peek() === ".") {
      i += 1;
      while (/[0-9]/.test(peek())) i += 1;
    }
    const raw = text.slice(start, i);
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return { kind: "number", value };
  }

  function parseFactor(): FormulaAst | null {
    skipWs();
    if (match("(")) {
      const inner = parseExpr();
      if (!inner || !match(")")) return null;
      return inner;
    }
    const num = parseNumber();
    if (num) return num;
    const ident = parseIdent();
    if (!ident) return null;
    skipWs();
    if (peek() === "(") {
      i += 1;
      const arg = parseFactor();
      if (!arg || !match(")")) return null;
      return { kind: "call", name: canonicalizeCallName(ident), arg };
    }
    return { kind: "ref", name: ident.toLowerCase() };
  }

  function parseTerm(): FormulaAst | null {
    let left = parseFactor();
    if (!left) return null;
    for (;;) {
      skipWs();
      const op = peek();
      if (op !== "*" && op !== "/") break;
      i += 1;
      const right = parseFactor();
      if (!right) return null;
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseExpr(): FormulaAst | null {
    let left = parseTerm();
    if (!left) return null;
    for (;;) {
      skipWs();
      const op = peek();
      if (op !== "+" && op !== "-") break;
      i += 1;
      const right = parseTerm();
      if (!right) return null;
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  const ast = parseExpr();
  skipWs();
  if (!ast || i < text.length) {
    return {
      ok: false,
      error: {
        message: "Невалидна формула. Очаква се израз с sum/avg/last/… и референции plan/report.",
        position: i,
      },
    };
  }
  return { ok: true, ast };
}

/** True when the text parses as a formula AST. */
export function isValidFormula(source: string): boolean {
  return parseFormula(source).ok;
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

function lastOf(points: TrendSample[]): FiniteSample | null {
  const samples = finiteSamples(points);
  return samples.at(-1) ?? null;
}

function resolveSlices(
  lookup: FormulaSeriesLookup,
  ref: FormulaAst,
): { slices: FormulaMachineSlice[]; error?: string } {
  if (ref.kind !== "ref") {
    return { slices: [], error: "Аргументът на агрегата трябва да е параметър (plan/report/код)." };
  }
  const slices = lookup.resolve(ref.name);
  if (!slices) return { slices: [], error: `Няма серия за „${ref.name}“.` };
  return { slices };
}

type EvalValue =
  | { kind: "scalar"; value: number }
  | { kind: "series"; points: TrendSample[] };

function bucketMsFor(sampleIntervalSeconds: number | null | undefined): number {
  const seconds =
    typeof sampleIntervalSeconds === "number" &&
    Number.isFinite(sampleIntervalSeconds) &&
    sampleIntervalSeconds > 0
      ? sampleIntervalSeconds
      : 60;
  return Math.max(1, Math.round(seconds)) * 1000;
}

function bucketStart(t: number, bucketMs: number, tMin: number): number {
  return tMin + Math.floor((t - tMin) / bucketMs) * bucketMs;
}

/** Per-machine last finite value in [tMin, tMax] (or overall last if none in window). */
function perMachineLast(
  slices: FormulaMachineSlice[],
  timeDomain: { tMin: number; tMax: number },
): number[] {
  const values: number[] = [];
  for (const slice of slices) {
    const inWindow = finiteSamples(slice.points).filter(
      (sample) => sample.t >= timeDomain.tMin && sample.t <= timeDomain.tMax,
    );
    const pick = inWindow.at(-1) ?? lastOf(slice.points);
    if (pick) values.push(pick.value);
  }
  return values;
}

function aggregateScalar(
  name: string,
  values: number[],
): number | null {
  if (name === "count") return values.length;
  if (values.length === 0) return null;
  switch (name) {
    case "sum":
      return values.reduce((acc, item) => acc + item, 0);
    case "avg":
      return values.reduce((acc, item) => acc + item, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "last":
      return values[values.length - 1] ?? null;
    default:
      return null;
  }
}

/**
 * Sum of report samples since each machine's latest plan *as of that time*.
 *
 * Walks the window as a sawtooth: when a new plan sample arrives the running
 * total resets, then grows with later reports. Endpoint matches the progress
 * ring (only reports after the overall last plan). Earlier segments stay on
 * the chart so a live plan heartbeat at tMax does not wipe the whole series.
 */
export function sumSinceLastPlanSeries(
  reportSlices: FormulaMachineSlice[],
  planSlices: FormulaMachineSlice[],
  timeDomain: { tMin: number; tMax: number },
  sampleIntervalSeconds: number | null | undefined,
): TrendSample[] {
  const planById = new Map(planSlices.map((row) => [row.machineId, row.points] as const));
  const bucketMs = bucketMsFor(sampleIntervalSeconds);
  const { tMin, tMax } = timeDomain;

  type Update = { t: number; machineId: string; running: number };
  const updates: Update[] = [];

  for (const machine of reportSlices) {
    const plans = finiteSamples(planById.get(machine.machineId) ?? []);
    const reports = finiteSamples(machine.points);
    type Ev = { t: number; kind: "plan" | "report"; value: number };
    const events: Ev[] = [
      ...plans.map((p) => ({ t: p.t, kind: "plan" as const, value: p.value })),
      ...reports.map((r) => ({ t: r.t, kind: "report" as const, value: r.value })),
    ].sort((a, b) => a.t - b.t || (a.kind === "plan" ? -1 : 1));

    let lastPlanT: number | null = null;
    let running = 0;
    for (const ev of events) {
      if (ev.kind === "plan") {
        if (ev.value > 0) {
          running = 0;
          lastPlanT = ev.t;
          if (ev.t >= tMin && ev.t <= tMax) {
            updates.push({ t: ev.t, machineId: machine.machineId, running: 0 });
          }
        }
        continue;
      }
      if (lastPlanT != null && ev.t > lastPlanT && ev.t >= tMin && ev.t <= tMax) {
        running += ev.value;
        updates.push({ t: ev.t, machineId: machine.machineId, running });
      }
    }
  }

  updates.sort((a, b) => a.t - b.t);
  const current = new Map<string, number>();
  const bucketLast = new Map<number, { t: number; total: number }>();

  for (const update of updates) {
    current.set(update.machineId, update.running);
    let total = 0;
    for (const value of current.values()) total += value;
    const start = bucketStart(update.t, bucketMs, tMin);
    const prev = bucketLast.get(start);
    if (!prev || update.t >= prev.t) bucketLast.set(start, { t: update.t, total });
  }

  return [...bucketLast.keys()]
    .sort((a, b) => a - b)
    .map((start) => ({
      timestamp: new Date(start + bucketMs / 2).toISOString(),
      value: bucketLast.get(start)!.total,
    }));
}

function evalAst(
  ast: FormulaAst,
  lookup: FormulaSeriesLookup,
  timeDomain: { tMin: number; tMax: number },
): EvalValue | { error: string } {
  if (ast.kind === "number") return { kind: "scalar", value: ast.value };

  if (ast.kind === "ref") {
    return { error: `Голата референция „${ast.name}“ трябва да е в агрегат (напр. last(${ast.name})).` };
  }

  if (ast.kind === "call") {
    const name = canonicalizeCallName(ast.name);

    if (name === "sum_since_last_plan") {
      const report = resolveSlices(lookup, ast.arg);
      if (report.error) return { error: report.error };
      const plan = lookup.resolve("plan") ?? [];
      const points = sumSinceLastPlanSeries(
        report.slices,
        plan,
        timeDomain,
        lookup.sampleIntervalSeconds,
      );
      return { kind: "series", points };
    }

    if (SCALAR_AGGREGATES.has(name)) {
      // Nested: sum(last(plan)) — evaluate inner call per machine then outer.
      if (ast.arg.kind === "call") {
        const innerName = canonicalizeCallName(ast.arg.name);
        if (innerName === "last" && SCALAR_AGGREGATES.has(name)) {
          const resolved = resolveSlices(lookup, ast.arg.arg);
          if (resolved.error) return { error: resolved.error };
          const values = perMachineLast(resolved.slices, timeDomain);
          const value = aggregateScalar(name, values);
          if (value == null) return { error: `Няма данни за ${name}(${innerName}(…)).` };
          return { kind: "scalar", value };
        }
        // Other nested forms: evaluate inner to scalar, wrap as single value.
        const inner = evalAst(ast.arg, lookup, timeDomain);
        if ("error" in inner) return inner;
        if (inner.kind === "series") {
          const vals = finiteSamples(inner.points).map((p) => p.value);
          const value = aggregateScalar(name, vals);
          if (value == null) return { error: `Няма данни за ${name}(…).` };
          return { kind: "scalar", value };
        }
        const value = aggregateScalar(name, [inner.value]);
        if (value == null) return { error: `Няма данни за ${name}(…).` };
        return { kind: "scalar", value };
      }

      const resolved = resolveSlices(lookup, ast.arg);
      if (resolved.error) return { error: resolved.error };

      if (name === "last") {
        const values = perMachineLast(resolved.slices, timeDomain);
        // Single last across machines: the chronologically latest sample's value.
        let best: FiniteSample | null = null;
        for (const slice of resolved.slices) {
          const pick =
            finiteSamples(slice.points)
              .filter((s) => s.t >= timeDomain.tMin && s.t <= timeDomain.tMax)
              .at(-1) ?? lastOf(slice.points);
          if (pick && (!best || pick.t >= best.t)) best = pick;
        }
        if (!best && values.length === 0) return { error: "Няма данни за last(…)." };
        return { kind: "scalar", value: best?.value ?? values[values.length - 1]! };
      }

      // Flatten all in-window samples across machines for sum/avg/min/max/count.
      const values: number[] = [];
      for (const slice of resolved.slices) {
        for (const sample of finiteSamples(slice.points)) {
          if (sample.t < timeDomain.tMin || sample.t > timeDomain.tMax) continue;
          values.push(sample.value);
        }
      }
      const value = aggregateScalar(name, values);
      if (value == null) return { error: `Няма данни за ${name}(…).` };
      return { kind: "scalar", value };
    }

    return { error: `Непозната функция „${ast.name}“.` };
  }

  // binary
  const left = evalAst(ast.left, lookup, timeDomain);
  if ("error" in left) return left;
  const right = evalAst(ast.right, lookup, timeDomain);
  if ("error" in right) return right;

  const apply = (a: number, b: number): number | null => {
    switch (ast.op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b === 0 ? null : a / b;
    }
  };

  if (left.kind === "scalar" && right.kind === "scalar") {
    const value = apply(left.value, right.value);
    if (value == null || !Number.isFinite(value)) {
      return { error: "Деление на нула или невалиден резултат." };
    }
    return { kind: "scalar", value };
  }

  if (left.kind === "series" && right.kind === "series") {
    return { error: "Операция между две серии още не се поддържа." };
  }

  let seriesPoints: TrendSample[];
  let scalarValue: number;
  let seriesOnLeft: boolean;
  if (left.kind === "series" && right.kind === "scalar") {
    seriesPoints = left.points;
    scalarValue = right.value;
    seriesOnLeft = true;
  } else if (left.kind === "scalar" && right.kind === "series") {
    seriesPoints = right.points;
    scalarValue = left.value;
    seriesOnLeft = false;
  } else {
    return { error: "Невалидна бинарна операция." };
  }

  const points: TrendSample[] = [];
  for (const point of seriesPoints) {
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) {
      points.push({ timestamp: point.timestamp, value: null });
      continue;
    }
    const value = seriesOnLeft
      ? apply(point.value, scalarValue)
      : apply(scalarValue, point.value);
    points.push({
      timestamp: point.timestamp,
      value: value == null || !Number.isFinite(value) ? null : value,
    });
  }
  return { kind: "series", points };
}

export type FormulaSeriesResult =
  | { ok: true; points: TrendSample[]; scalar: number | null }
  | { ok: false; error: string };

/**
 * Evaluate a formula to a chart series for the aggregate (big) chart.
 * Scalars become a two-point hold across [tMin, tMax].
 */
export function evaluateFormulaSeries(
  source: string,
  lookup: FormulaSeriesLookup,
  timeDomain: { tMin: number; tMax: number },
): FormulaSeriesResult {
  const parsed = parseFormula(source);
  if (!parsed.ok) return { ok: false, error: parsed.error.message };

  const result = evalAst(parsed.ast, lookup, timeDomain);
  if ("error" in result) return { ok: false, error: result.error };

  if (result.kind === "scalar") {
    return {
      ok: true,
      scalar: result.value,
      points: [
        { timestamp: new Date(timeDomain.tMin).toISOString(), value: result.value },
        { timestamp: new Date(timeDomain.tMax).toISOString(), value: result.value },
      ],
    };
  }

  const finite = result.points.filter(
    (point) => typeof point.value === "number" && Number.isFinite(point.value),
  );
  const last = finite.at(-1)?.value ?? null;
  return { ok: true, points: result.points, scalar: last };
}

/** Documented function names (canonical + aliases). */
export const FORMULA_FUNCTIONS = [
  "sum",
  "avg",
  "last",
  "min",
  "max",
  "count",
  "sum_since_last_plan",
  "sum_sled_last_plan",
] as const;
