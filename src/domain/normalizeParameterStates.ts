import {
  asParameterRole,
  type ParameterRole,
  type ParameterStateDef,
} from "./parameterRole";

const STATE_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function parseParameterRole(value: unknown): ParameterRole {
  return asParameterRole(value);
}

export function parseStates(
  input: unknown,
  role: ParameterRole,
): { states: ParameterStateDef[]; error: string | null } {
  if (role !== "status") return { states: [], error: null };
  if (!Array.isArray(input) || input.length === 0) {
    return { states: [], error: "Статусният параметър трябва да има поне едно състояние." };
  }
  const seen = new Set<number>();
  const states: ParameterStateDef[] = [];
  for (const [index, row] of input.entries()) {
    const record = row as Partial<ParameterStateDef>;
    const raw = record.value;
    const value = typeof raw === "number" ? raw : raw == null || raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(value)) {
      return { states: [], error: `Състояние ${index + 1}: стойността е число.` };
    }
    if (seen.has(value)) {
      return { states: [], error: `Състояние със стойност ${value} се повтаря.` };
    }
    seen.add(value);
    const label = String(record.label ?? "").trim();
    if (!label) return { states: [], error: `Състояние ${index + 1}: текстът е задължителен.` };
    const color = String(record.color ?? "").trim();
    if (!STATE_COLOR.test(color)) {
      return { states: [], error: `Състояние ${index + 1}: цветът е #929292.` };
    }
    states.push({
      value,
      label,
      color: color.toLowerCase() === "#ff0000" ? "#FF0000" : color.toLowerCase(),
    });
  }
  return { states: states.sort((a, b) => a.value - b.value), error: null };
}

export function rangeFromStates(states: ParameterStateDef[]): {
  rangeMin: number;
  rangeMax: number;
} | null {
  if (states.length === 0) return null;
  const values = states.map((state) => state.value);
  return { rangeMin: Math.min(...values), rangeMax: Math.max(...values) };
}

export function pickStateValue(states: ParameterStateDef[], random: () => number): number {
  if (states.length === 0) return 0;
  const index = Math.min(states.length - 1, Math.floor(random() * states.length));
  return states[index]!.value;
}
