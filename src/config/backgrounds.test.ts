import { describe, expect, it } from "vitest";
import {
  normalizeTabloBackground,
  tabloBackgroundDefault,
  tabloBackgroundIds,
} from "./backgrounds";

describe("tablo background presets", () => {
  it("defaults unknown values to the non-black preset", () => {
    expect(normalizeTabloBackground(null)).toBe(tabloBackgroundDefault);
    expect(normalizeTabloBackground("")).toBe(tabloBackgroundDefault);
    expect(normalizeTabloBackground("black")).toBe(tabloBackgroundDefault);
  });

  it("accepts every declared preset id", () => {
    for (const id of tabloBackgroundIds) {
      expect(normalizeTabloBackground(id)).toBe(id);
    }
  });
});
