import { colorForParameter } from "./machineTrend";
import {
  chartsOnLinear,
  resolveParameterRole,
  type ParameterRole,
  type ParameterStateDef,
} from "./parameterRole";

export type RangeEventKind = "out_of_range" | "back_in_range";

export type RangeEvent = {
  timestamp: string;
  t: number;
  machineId: string;
  machineName: string;
  parameterId: string;
  parameterLabel: string;
  unit: string;
  color: string;
  value: number;
  kind: RangeEventKind;
  role: ParameterRole;
  rangeMin: number | null;
  rangeMax: number | null;
  /** Status-state label at the sample, when role is status. */
  stateLabel: string | null;
};

export type RangeEventSeriesInput = {
  machineId: string;
  machineName: string;
  parameterId: string;
  label: string;
  unit: string;
  rangeMin: number | null;
  rangeMax: number | null;
  color?: string | null;
  role?: string | null;
  states?: ParameterStateDef[];
  points: Array<{ timestamp: string; value: number | null }>;
};

/**
 * Metric (linear chart): outside [rangeMin, rangeMax].
 * Status (strip): outside the nominal state (lowest state value, e.g. „работи“).
 */
export function isOutOfRange(
  value: number,
  input: {
    role?: string | null;
    label: string;
    parameterId: string;
    rangeMin: number | null;
    rangeMax: number | null;
    states?: ParameterStateDef[];
  },
): boolean | null {
  const role = resolveParameterRole(input.label, input.parameterId, input.role);
  if (role === "status") {
    const states = input.states ?? [];
    if (states.length === 0) return null;
    const nominal = Math.min(...states.map((state) => state.value));
    return value !== nominal;
  }
  if (!chartsOnLinear(role)) return null;
  if (
    typeof input.rangeMin !== "number" ||
    !Number.isFinite(input.rangeMin) ||
    typeof input.rangeMax !== "number" ||
    !Number.isFinite(input.rangeMax)
  ) {
    return null;
  }
  return value < input.rangeMin || value > input.rangeMax;
}

/**
 * Edge-triggered range events over time-sorted samples.
 * One event on first leave; silence while still out; one event on first return.
 * Series that start already out of range emit an out event on the first sample.
 */
function stateAt(value: number, states: ParameterStateDef[]): ParameterStateDef | null {
  const exact = states.find((state) => state.value === value);
  if (exact) return exact;
  if (states.length === 0) return null;
  return [...states].sort((a, b) => Math.abs(a.value - value) - Math.abs(b.value - value))[0] ?? null;
}

function pushEvent(
  events: RangeEvent[],
  item: RangeEventSeriesInput,
  role: ParameterRole,
  sample: { timestamp: string; t: number; value: number },
  kind: RangeEventKind,
  paramColor: string,
): void {
  const states = item.states ?? [];
  const state = role === "status" ? stateAt(sample.value, states) : null;
  const color = state?.color ?? paramColor;
  events.push({
    timestamp: sample.timestamp,
    t: sample.t,
    machineId: item.machineId,
    machineName: item.machineName,
    parameterId: item.parameterId,
    parameterLabel: item.label,
    unit: item.unit,
    color,
    value: sample.value,
    kind,
    role,
    rangeMin: item.rangeMin,
    rangeMax: item.rangeMax,
    stateLabel: state?.label ?? null,
  });
}

export function buildRangeEvents(
  series: RangeEventSeriesInput[],
  orderedIds: string[],
): RangeEvent[] {
  const events: RangeEvent[] = [];

  for (const item of series) {
    const role = resolveParameterRole(item.label, item.parameterId, item.role);
    if (role !== "status" && !chartsOnLinear(role)) continue;

    const paramColor = colorForParameter(item.parameterId, orderedIds, item.color);
    const samples = [...item.points]
      .filter((point) => point && typeof point.timestamp === "string")
      .map((point) => {
        const t = Date.parse(point.timestamp);
        const value =
          typeof point.value === "number" && Number.isFinite(point.value) ? point.value : null;
        return { timestamp: point.timestamp, t, value };
      })
      .filter(
        (point): point is { timestamp: string; t: number; value: number } =>
          Number.isFinite(point.t) && point.value != null,
      )
      .sort((a, b) => a.t - b.t || a.timestamp.localeCompare(b.timestamp));

    let prevOutside: boolean | null = null;
    for (const sample of samples) {
      const outside = isOutOfRange(sample.value, item);
      if (outside == null) break;
      if (prevOutside === null) {
        if (outside) {
          pushEvent(events, item, role, sample, "out_of_range", paramColor);
        }
        prevOutside = outside;
        continue;
      }
      if (outside === prevOutside) continue;
      pushEvent(
        events,
        item,
        role,
        sample,
        outside ? "out_of_range" : "back_in_range",
        paramColor,
      );
      prevOutside = outside;
    }
  }

  return events.sort(
    (a, b) =>
      b.t - a.t ||
      a.machineName.localeCompare(b.machineName, "bg") ||
      a.parameterLabel.localeCompare(b.parameterLabel, "bg"),
  );
}

/** Bold-line title after the machine name (mockup: „Машина – заглавие“). */
export function rangeEventTitle(event: RangeEvent): string {
  if (event.role === "status") {
    if (event.kind === "back_in_range") return event.stateLabel ?? "В норма";
    return event.stateLabel ?? event.parameterLabel;
  }
  if (event.kind === "back_in_range") return `${event.parameterLabel} в норма`;
  return event.parameterLabel;
}

/** Subtext under the title (value + normal range hint). */
export function rangeEventDetail(event: RangeEvent, formatValue: (n: number) => string): string {
  if (event.role === "status") {
    if (event.kind === "back_in_range") return "Номинален статус";
    return `Стойност ${formatValue(event.value)}`;
  }
  const valueText = `${formatValue(event.value)}${event.unit ? ` ${event.unit}` : ""}`;
  if (event.kind === "back_in_range") return `${valueText} (в норма)`;
  const min = event.rangeMin;
  const max = event.rangeMax;
  if (typeof min === "number" && typeof max === "number") {
    if (event.value > max) return `${valueText} (норма < ${formatValue(max)})`;
    if (event.value < min) return `${valueText} (норма > ${formatValue(min)})`;
    return `${valueText} (норма ${formatValue(min)}–${formatValue(max)})`;
  }
  return valueText;
}

/** Flatten dashboard machines into per-machine metric + status series for event detection. */
export function rangeEventSeriesFromMachines(
  machines: Array<{
    id: string;
    name: string;
    series: Array<{
      parameterId: string;
      label: string;
      unit: string;
      rangeMin: number | null;
      rangeMax: number | null;
      color?: string | null;
      role?: string | null;
      states?: ParameterStateDef[];
      points: Array<{ timestamp: string; value: number | null }>;
    }>;
  }>,
): RangeEventSeriesInput[] {
  const rows: RangeEventSeriesInput[] = [];
  for (const machine of machines) {
    for (const series of machine.series) {
      const role = resolveParameterRole(series.label, series.parameterId, series.role);
      if (role !== "status" && !chartsOnLinear(role)) continue;
      rows.push({
        machineId: machine.id,
        machineName: machine.name,
        parameterId: series.parameterId,
        label: series.label,
        unit: series.unit,
        rangeMin: series.rangeMin,
        rangeMax: series.rangeMax,
        color: series.color,
        role: series.role,
        states: series.states,
        points: series.points,
      });
    }
  }
  return rows;
}
