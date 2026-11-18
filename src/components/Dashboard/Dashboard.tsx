import { useEffect, useState } from "react";
import { chartWindowMinutes, readerIntervalMs } from "../../config/dashboard";
import type { DashboardReading } from "../../server/blondina";
import { MachineTrend } from "./MachineTrend";
import "./Dashboard.css";

export function Dashboard() {
  const [reading, setReading] = useState<DashboardReading | null>(null);
  const [readAt, setReadAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/cps/dashboard?minutes=${chartWindowMinutes}`);
        if (!response.ok) throw new Error("Четенето от базата не мина.");
        const body = (await response.json()) as DashboardReading;
        if (!alive) return;
        setReading(body);
        setReadAt(new Date());
        setError(null);
      } catch (reason) {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : "Няма връзка с базата.");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), readerIntervalMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const readLabel = readAt
    ? new Intl.DateTimeFormat("bg-BG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(readAt)
    : null;
  const orderedIds = [...new Set(reading?.machines.flatMap((machine) => machine.series.map((series) => series.parameterId)) ?? [])].sort();

  return (
    <main className="dash">
      <header className="dash-header">
        <div>
          <p className="kicker">Пулт</p>
          <h1>Контролен пулт</h1>
        </div>
        <div className="dash-side">
          <span>{`Четене на всеки ${readerIntervalMs / 1000} сек`}</span>
          {readLabel && <time dateTime={readAt?.toISOString()}>{readLabel}</time>}
        </div>
      </header>
      <p className="demo-note">
        Всяка линия е процент от границите на своя параметър. По вертикала 0% е долната граница, а 100% е горната. По хоризонтала е времето.
      </p>
      {error && <p className="dash-error">{error}</p>}
      <section className="trend-list" aria-label="Графики по машини">
        {reading?.machines.map((machine) => (
          <MachineTrend key={machine.id} machine={machine} orderedIds={orderedIds} />
        ))}
      </section>
    </main>
  );
}
