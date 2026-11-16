import { useEffect, useState } from "react";
import { chartWindowMinutes, readerIntervalMs } from "../../config/dashboard";
import { formatNumber } from "../../domain/format";
import type { FirstObjectReading } from "../../server/blondina";
import { Sparkline } from "../MachineCard/Sparkline";
import "./Dashboard.css";

export function Dashboard() {
  const [reading, setReading] = useState<FirstObjectReading | null>(null);
  const [readAt, setReadAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/cps/object?minutes=${chartWindowMinutes}`);
        if (!response.ok) throw new Error("Четенето от blondina не мина.");
        const body = (await response.json()) as FirstObjectReading;
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

  return (
    <main className="dash">
      <header className="dash-header">
        <div>
          <p className="kicker">Първи обект</p>
          <h1>{reading?.machine?.name ?? "Контролен пулт"}</h1>
          {reading?.machine?.model && <p className="demo-note">{reading.machine.model}</p>}
        </div>
        <div className="dash-side">
          <span>{`Четене на всеки ${readerIntervalMs / 1000} сек`}</span>
          {readLabel && <time dateTime={readAt?.toISOString()}>{readLabel}</time>}
        </div>
      </header>
      <p className="demo-note">
        Записът в blondina върви отделно и добавя точка, когато мине честотата на параметъра.
        Този екран само чете и пречертава четирите графики.
      </p>
      {error && <p className="dash-error">{error}</p>}
      <section className="chart-grid">
        {reading?.charts.map((chart) => {
          const last = [...chart.points].reverse().find((point) => point.value != null);
          return (
            <article key={chart.parameterId} className="chart-card">
              <header className="chart-head">
                <h2>{chart.label}</h2>
                <p className="chart-value">
                  {last?.value == null ? "—" : `${formatNumber(last.value)} ${chart.unit}`}
                </p>
              </header>
              <Sparkline points={chart.points} label={chart.label} unit={chart.unit} size="large" />
              {!chart.writable && (
                <p className="chart-note">Няма диапазон или честота. Записът пропуска тази графика.</p>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
