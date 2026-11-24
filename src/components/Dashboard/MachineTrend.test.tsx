import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OUT_OF_RANGE_COLOR } from "../../domain/machineTrend";
import type { DashboardMachine } from "../../server/blondina";
import { MachineTrend } from "./MachineTrend";

const t0 = "2026-11-20T10:00:00.000Z";
const t1 = "2026-11-20T10:01:00.000Z";
const t2 = "2026-11-20T10:02:00.000Z";
const t3 = "2026-11-20T10:03:00.000Z";

function machineWithOor(): DashboardMachine {
  return {
    id: "LATHE_01",
    name: "Струг 1",
    model: "DMG",
    series: [
      {
        parameterId: "speed",
        label: "Скорост",
        unit: "об/мин",
        rangeMin: 0,
        rangeMax: 100,
        color: "#7ec8ff",
        role: "metric",
        aggregateMethod: "avg",
        sampleIntervalSeconds: 60,
        states: [],
        points: [
          { timestamp: t0, value: 40 },
          { timestamp: t1, value: 130 },
          { timestamp: t2, value: 140 },
          { timestamp: t3, value: 50 },
        ],
      },
    ],
  };
}

describe("MachineTrend OOR markers", () => {
  it("keeps red OOR strokes but does not draw point markers on OOR samples", () => {
    const { container } = render(
      <MachineTrend
        machine={machineWithOor()}
        orderedIds={["speed"]}
        timeDomain={{ tMin: Date.parse(t0), tMax: Date.parse(t3) }}
      />,
    );

    const redPolylines = [...container.querySelectorAll("polyline")].filter(
      (el) => el.getAttribute("stroke")?.toLowerCase() === OUT_OF_RANGE_COLOR.toLowerCase(),
    );
    expect(redPolylines.length).toBeGreaterThan(0);

    const markerCircles = [...container.querySelectorAll("circle")].filter(
      (el) => !el.classList.contains("trend-hit") && !el.classList.contains("trend-ring-track") && !el.classList.contains("trend-ring-value"),
    );
    const oorMarkers = markerCircles.filter((el) => {
      const stroke = el.getAttribute("stroke")?.toLowerCase();
      const fill = el.getAttribute("fill")?.toLowerCase();
      return stroke === OUT_OF_RANGE_COLOR.toLowerCase() || fill === OUT_OF_RANGE_COLOR.toLowerCase();
    });
    expect(oorMarkers).toHaveLength(0);
  });

  it("renders shared X tick labels for the card chart time domain", () => {
    const tMax = Date.parse("2026-11-23T16:00:00");
    const tMin = tMax - 4 * 60 * 60_000;
    const { container } = render(
      <MachineTrend
        machine={machineWithOor()}
        orderedIds={["speed"]}
        timeDomain={{ tMin, tMax }}
      />,
    );
    const labels = container.querySelectorAll(".trend-xtick-label");
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll(".trend-xtick-mark").length).toBeGreaterThanOrEqual(3);
  });
});
