import type { MachineCardSource, MetricPoint } from "../types/machine";

/**
 * Demonstration fleet only. The real shop is 4 machines and is not connected.
 * OEE is supplied as a value. It is not calculated from the trend.
 * The upper limit 90 exists only to show a threshold marker. It is not a plant limit.
 */
const DEMO_TREND_UPPER = 90;
const STEP_MS = 5 * 60 * 1000;

function series(endAgoMs: number, values: Array<number | null>): MetricPoint[] {
  const end = Date.now() - endAgoMs;
  const start = end - (values.length - 1) * STEP_MS;
  return values.map((value, index) => ({
    timestamp: new Date(start + index * STEP_MS).toISOString(),
    value,
  }));
}

export function getDemoCards(): MachineCardSource[] {
  const fresh = 2_000;
  return [
    {
      trendThresholds: { upper: DEMO_TREND_UPPER },
      machine: {
        id: "LATHE_01",
        name: "Струг 1",
        model: "DMG MORI NLX 2500",
        kind: "lathe",
        status: "running",
        oee: 92,
        primaryMetric: { key: "productivity", label: "Производителност", unit: "%" },
        trend: series(fresh, [70, 72, 74, 76, 78, 80, 84, 80, null, 83, 86, 91, 92]),
        lastUpdatedAt: new Date(Date.now() - fresh).toISOString(),
        activeAlertCount: 0,
      },
    },
    {
      machine: {
        id: "LATHE_02",
        name: "Струг 2",
        kind: "lathe",
        status: "idle",
        oee: 64,
        primaryMetric: { key: "productivity", label: "Производителност", unit: "%" },
        trend: series(20_000, [40, 41, 39, 38, 40, 42, 41, 40, 39, 41, 40, 38, 37]),
        lastUpdatedAt: new Date(Date.now() - 20_000).toISOString(),
      },
    },
    {
      machine: {
        id: "MACH_03",
        name: "Машина 3",
        kind: "other",
        status: "setup",
        oee: 71,
        primaryMetric: { key: "spindle_speed", label: "Скорост на въртене", unit: "об/мин" },
        trend: series(8_000, [1400, 1420, 1480, 1510, 1490, 1540, 1600, 1560, null, 1580, 1620, 1590, 1630]),
        lastUpdatedAt: new Date(Date.now() - 8_000).toISOString(),
      },
    },
    {
      machine: {
        id: "MACH_04",
        name: "Машина 4",
        kind: "other",
        status: "warning",
        oee: 54,
        primaryMetric: { key: "scrap_count", label: "Брак", unit: "бр" },
        trend: series(12_000, [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5]),
        lastUpdatedAt: new Date(Date.now() - 12_000).toISOString(),
        activeAlertCount: 1,
      },
    },
    {
      machine: {
        id: "LATHE_03",
        name: "Струг 3",
        kind: "lathe",
        status: "alarm",
        oee: 22,
        primaryMetric: { key: "productivity", label: "Производителност", unit: "%" },
        trend: series(5_000, [90, 88, 86, 84, 80, 76, 70, 66, 60, 55, 48, 40, 33]),
        lastUpdatedAt: new Date(Date.now() - 5_000).toISOString(),
        activeAlertCount: 2,
      },
    },
    {
      machine: {
        id: "LATHE_04",
        name: "Струг 4",
        kind: "lathe",
        status: "offline",
        oee: 48,
        primaryMetric: { key: "productivity", label: "Производителност", unit: "%" },
        trend: series(15 * 60_000, [50, 52, 51, 49, 48, 47, 49, 50, 48, 47, 46, 48, 48]),
        lastUpdatedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
      },
    },
    {
      machine: {
        id: "LATHE_05",
        name: "Струг 5",
        kind: "lathe",
        status: "unknown",
        oee: null,
        primaryMetric: { key: "productivity", label: "Производителност", unit: "%" },
        trend: [],
      },
    },
  ];
}
