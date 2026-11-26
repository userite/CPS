import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    manualStatus: null,
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

function machineWithStatus(): DashboardMachine {
  return {
    id: "LATHE_01",
    name: "Струг 1",
    model: "DMG",
    manualStatus: {
      parameterId: "machine_status",
      value: 1,
      label: "авария",
      color: "#e53935",
      comment: "прогнозно 45 мин",
      updatedAt: t1,
    },
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
          { timestamp: t3, value: 50 },
        ],
      },
      {
        parameterId: "machine_status",
        label: "Статус",
        unit: "",
        rangeMin: 0,
        rangeMax: 1,
        color: "#e53935",
        role: "status",
        aggregateMethod: "last",
        sampleIntervalSeconds: 60,
        states: [
          { value: 0, label: "работи", color: "#3ddc97" },
          { value: 1, label: "авария", color: "#e53935" },
        ],
        points: [
          { timestamp: t0, value: 0 },
          { timestamp: t1, value: 1 },
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

  it("draws a Y spine that meets the X baseline at the origin corner", () => {
    const { container } = render(
      <MachineTrend
        machine={machineWithOor()}
        orderedIds={["speed"]}
        timeDomain={{ tMin: Date.parse(t0), tMax: Date.parse(t3) }}
      />,
    );
    const ySpine = container.querySelector(".trend-yaxis-line");
    const xAxis = container.querySelector(".trend-xaxis");
    expect(ySpine).not.toBeNull();
    expect(xAxis).not.toBeNull();
    expect(ySpine?.getAttribute("x1")).toBe(xAxis?.getAttribute("x1"));
    expect(ySpine?.getAttribute("y2")).toBe(xAxis?.getAttribute("y1"));
    expect(container.querySelectorAll(".trend-ytick-mark")).toHaveLength(2);
  });
});

describe("MachineTrend status modal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps status/comment controls out of the card until the foot button opens the modal", () => {
    render(
      <MachineTrend
        machine={machineWithStatus()}
        orderedIds={["speed", "machine_status"]}
        timeDomain={{ tMin: Date.parse(t0), tMax: Date.parse(t3) }}
      />,
    );

    expect(screen.getByRole("button", { name: "Статус" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Статус за Струг 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Коментар за Струг 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Статус" }));

    expect(screen.getByRole("dialog", { name: "Статус — Струг 1" })).toBeInTheDocument();
    expect(screen.getByLabelText("Статус за Струг 1")).toHaveValue("1");
    expect(screen.getByLabelText("Коментар за Струг 1")).toHaveValue("прогнозно 45 мин");
    expect(screen.getByRole("button", { name: "Запази коментар" })).toBeInTheDocument();
  });

  it("closes the status modal with the close control, backdrop, and Escape", () => {
    render(
      <MachineTrend
        machine={machineWithStatus()}
        orderedIds={["speed", "machine_status"]}
        timeDomain={{ tMin: Date.parse(t0), tMax: Date.parse(t3) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Статус" }));
    fireEvent.click(screen.getByRole("button", { name: "Затвори" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Статус" }));
    fireEvent.click(document.querySelector(".trend-status-modal-backdrop")!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Статус" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps status select as draft until Save persists status+comment and closes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MachineTrend
        machine={machineWithStatus()}
        orderedIds={["speed", "machine_status"]}
        timeDomain={{ tMin: Date.parse(t0), tMax: Date.parse(t3) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Статус" }));
    fireEvent.change(screen.getByLabelText("Статус за Струг 1"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Коментар за Струг 1"), {
      target: { value: "готово след 10 мин" },
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Запази коментар" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cps/machine-status",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          machineId: "LATHE_01",
          value: 0,
          comment: "готово след 10 мин",
        }),
      }),
    );
  });

  it("does not persist when dismissing with Esc after a draft status change", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MachineTrend
        machine={machineWithStatus()}
        orderedIds={["speed", "machine_status"]}
        timeDomain={{ tMin: Date.parse(t0), tMax: Date.parse(t3) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Статус" }));
    fireEvent.change(screen.getByLabelText("Статус за Струг 1"), { target: { value: "0" } });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
