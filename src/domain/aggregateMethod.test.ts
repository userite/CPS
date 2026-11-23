import { describe, expect, it } from "vitest";
import {
  asAggregateMethod,
  defaultAggregateMethod,
  resolveAggregateMethod,
} from "./aggregateMethod";

describe("aggregateMethod", () => {
  it("parses known methods and rejects junk", () => {
    expect(asAggregateMethod("sum")).toBe("sum");
    expect(asAggregateMethod("AVG")).toBe("avg");
    expect(asAggregateMethod("nope")).toBeNull();
    expect(asAggregateMethod(null)).toBeNull();
  });

  it("defaults count-like labels to sum and others to avg", () => {
    expect(defaultAggregateMethod("Годни детайли", "good_count", "бр")).toBe("sum");
    expect(defaultAggregateMethod("Брак", "scrap_count", "")).toBe("sum");
    expect(defaultAggregateMethod("Скорост на въртене", "spindle_speed", "об/мин")).toBe("avg");
    expect(defaultAggregateMethod("Температура", "temp", "°C")).toBe("avg");
  });

  it("prefers stored method over inference", () => {
    expect(resolveAggregateMethod("Годни", "good_count", "бр", "avg")).toBe("avg");
    expect(resolveAggregateMethod("Скорост", "speed", "", null)).toBe("avg");
  });
});
