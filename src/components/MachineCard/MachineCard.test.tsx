import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MachineCardData, MachineStatus, MetricPoint } from "../../types/machine";
import { MachineCard } from "./MachineCard";

const now = new Date("2026-10-30T10:00:02.000Z");
const origin = Date.parse("2026-10-30T09:00:00.000Z");

function at(minute: number, value: number | null): MetricPoint {
  return { timestamp: new Date(origin + minute * 60_000).toISOString(), value };
}

function machine(
  overrides: Omit<Partial<MachineCardData>, "status"> & { status?: string } = {},
): MachineCardData {
  const { status, ...rest } = overrides;
  return {
    id: "LATHE_01",
    name: "Струг 1",
    model: "DMG MORI NLX 2500",
    kind: "lathe",
    status: (status ?? "running") as MachineStatus,
    oee: 92,
    primaryMetric: { key: "productivity", label: "Производителност", unit: "%" },
    trend: [
      at(0, 70), at(5, 72), at(10, 74), at(15, 76), at(20, 78), at(25, 80),
      at(30, 84), at(35, 80), at(40, null), at(45, 83), at(50, 86), at(55, 91), at(60, 92),
    ],
    lastUpdatedAt: "2026-10-30T10:00:00.000Z",
    ...rest,
  };
}

describe("MachineCard", () => {
  it("shows name, model, running status, OEE and the metric", () => {
    render(
      <MachineCard
        machine={machine()}
        now={now}
        staleAfterMs={60_000}
        trendThresholds={{ upper: 90 }}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: "Струг 1" })).toBeInTheDocument();
    expect(screen.getByText("DMG MORI NLX 2500")).toBeInTheDocument();
    expect(screen.getByText("Работи")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("Производителност (%)")).toBeInTheDocument();
    expect(screen.getByText("Последните 60 минути")).toBeInTheDocument();
    expect(screen.getByText("Пик")).toBeInTheDocument();
    expect(screen.getByText("Извън праг")).toBeInTheDocument();
    expect(screen.getByText("Преди 2 секунди")).toBeInTheDocument();
    expect(document.querySelector(".oee-arc-neutral")).toBeTruthy();
    expect(screen.queryByText("Остарели данни")).not.toBeInTheDocument();
  });

  it("shows an alarm with a warning count", () => {
    render(
      <MachineCard
        machine={machine({ status: "alarm", oee: 22, activeAlertCount: 2 })}
        now={now}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("Авария")).toBeInTheDocument();
    expect(screen.getByText("2 активни предупреждения")).toBeInTheDocument();
  });

  it("shows a dash and an empty trend instead of zero", () => {
    render(
      <MachineCard
        machine={machine({ oee: null, trend: [], model: undefined })}
        now={now}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Няма данни")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("treats an unknown status and an impossible OEE as missing meaning", () => {
    render(
      <MachineCard
        machine={machine({ status: "exploded", oee: 150 })}
        now={now}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("Неизвестен статус")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("selects the machine id with click and keyboard", () => {
    const onSelect = vi.fn();
    render(<MachineCard machine={machine()} now={now} selected onSelect={onSelect} />);
    const card = screen.getByRole("button", { name: /Струг 1/ });
    expect(card).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("LATHE_01");
  });

  it("marks stale data and a loading card", () => {
    render(
      <MachineCard
        machine={machine({ status: "offline", lastUpdatedAt: "2026-10-30T09:40:00.000Z" })}
        now={now}
        staleAfterMs={60_000}
      />,
    );
    expect(screen.getByText("Офлайн")).toBeInTheDocument();
    expect(screen.getByText("Остарели данни")).toBeInTheDocument();
    render(<MachineCard loading />);
    expect(screen.getByText("Зареждане")).toBeInTheDocument();
  });
});
