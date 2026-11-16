import { describe, expect, it } from "vitest";
import { formatUpdatedAgo } from "./format";
import { freshness, oeeTone, presentMachine } from "./machinePresentation";

const now = new Date("2026-10-30T12:00:00Z");

describe("machine presentation", () => {
  it("keeps zero and drops an OEE outside 0 to 100", () => {
    expect(presentMachine({ id: "A", name: "A", status: "running", oee: 0, trend: [] }).oee).toBe(0);
    expect(presentMachine({ id: "A", name: "A", status: "running", oee: 150, trend: [] }).oee).toBeNull();
  });

  it("maps an unknown status and sorts measurements", () => {
    const machine = presentMachine({
      id: "A",
      name: "A",
      status: "exploded",
      oee: 10,
      trend: [
        { timestamp: "2026-10-30T12:00:00Z", value: 2 },
        { timestamp: "2026-10-30T11:00:00Z", value: 1 },
      ],
    });
    expect(machine.status).toBe("unknown");
    expect(machine.trend.map((point) => point.value)).toEqual([1, 2]);
  });

  it("colors OEE only when both thresholds exist", () => {
    expect(oeeTone(92, { goodMin: null, warnMin: null })).toBe("neutral");
    expect(oeeTone(92, { goodMin: 80, warnMin: 50 })).toBe("good");
    expect(oeeTone(60, { goodMin: 80, warnMin: 50 })).toBe("warn");
    expect(oeeTone(20, { goodMin: 80, warnMin: 50 })).toBe("bad");
  });

  it("formats age and stale data", () => {
    expect(formatUpdatedAgo("2026-10-30T11:59:58Z", now)).toBe("Преди 2 секунди");
    expect(formatUpdatedAgo("2026-10-30T11:00:00Z", now)).toBe("Преди 1 час");
    expect(freshness("2026-10-30T11:59:58Z", now, 60_000).stale).toBe(false);
    expect(freshness("2026-10-30T11:00:00Z", now, 60_000).stale).toBe(true);
    expect(freshness(undefined, now, 60_000).stale).toBe(true);
  });
});
