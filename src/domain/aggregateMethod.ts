/** How a parameter is combined across machines on the табло aggregate chart. */
export type AggregateMethod = "sum" | "avg" | "last" | "min" | "max" | "count";

export const AGGREGATE_METHODS: AggregateMethod[] = [
  "sum",
  "avg",
  "last",
  "min",
  "max",
  "count",
];

export const AGGREGATE_METHOD_LABELS: Record<AggregateMethod, string> = {
  sum: "Сума (sum)",
  avg: "Средно (avg)",
  last: "Последна (last)",
  min: "Минимум (min)",
  max: "Максимум (max)",
  count: "Брой (count)",
};

const METHOD_SET = new Set<string>(AGGREGATE_METHODS);

/** Parse stored/admin value; unknown → null (caller applies default). */
export function asAggregateMethod(value: unknown): AggregateMethod | null {
  if (value == null) return null;
  const method = String(value).trim().toLowerCase();
  return METHOD_SET.has(method) ? (method as AggregateMethod) : null;
}

/**
 * Sensible default when admin has not set aggregate_method.
 * Count-like params → sum; otherwise avg.
 */
export function defaultAggregateMethod(
  label: string,
  parameterId = "",
  unit = "",
): AggregateMethod {
  const text = `${label} ${parameterId} ${unit}`.toLocaleLowerCase("bg-BG");
  if (
    /count|брой|детайл|брак|годн|scrap|qty|quantity/.test(text) ||
    /(^|[^a-z])pcs([^a-z]|$)/i.test(text) ||
    /\bбр\.?\b/.test(text)
  ) {
    return "sum";
  }
  return "avg";
}

export function resolveAggregateMethod(
  label: string,
  parameterId: string,
  unit: string,
  stored?: string | null,
): AggregateMethod {
  return asAggregateMethod(stored) ?? defaultAggregateMethod(label, parameterId, unit);
}
