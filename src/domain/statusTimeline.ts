import type { ParameterStateDef } from "./parameterRole";

export type StatusSample = {
  timestamp: string;
  value: number | null;
};

export type StatusCell = {
  timestamp: string;
  value: number;
  label: string;
  color: string;
};

export type StatusStrip = {
  parameterId: string;
  label: string;
  cells: StatusCell[];
  states: ParameterStateDef[];
};

function stateFor(value: number, states: ParameterStateDef[]): ParameterStateDef | null {
  const exact = states.find((state) => state.value === value);
  if (exact) return exact;
  const nearest = [...states].sort(
    (a, b) => Math.abs(a.value - value) - Math.abs(b.value - value),
  )[0];
  return nearest ?? null;
}

export function buildStatusStrip(
  parameterId: string,
  label: string,
  states: ParameterStateDef[],
  points: StatusSample[],
): StatusStrip | null {
  if (states.length === 0) return null;
  const cells: StatusCell[] = [];
  for (const point of [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
    const state = stateFor(point.value, states);
    if (!state) continue;
    cells.push({
      timestamp: point.timestamp,
      value: point.value,
      label: state.label,
      color: state.color,
    });
  }
  if (cells.length === 0) return null;
  return { parameterId, label, cells, states };
}
