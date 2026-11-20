import { useEffect, useState } from "react";
import {
  applyTabloBackground,
  normalizeTabloBackground,
  readStoredTabloBackground,
  tabloBackgroundChoices,
  tabloBackgroundDefault,
  type TabloBackgroundId,
  writeStoredTabloBackground,
} from "../../config/backgrounds";
import {
  chartWindowDomain,
  chartWindowHourChoices,
  chartWindowHoursDefault,
  chartWindowHoursStorageKey,
  normalizeChartWindowHours,
  readerIntervalMs,
} from "../../config/dashboard";
import type { DashboardReading } from "../../server/blondina";
import { MachineTrend } from "./MachineTrend";
import "./Dashboard.css";

function readStoredHours(): number {
  try {
    return normalizeChartWindowHours(window.localStorage.getItem(chartWindowHoursStorageKey));
  } catch {
    return chartWindowHoursDefault;
  }
}

export function Dashboard() {
  const [windowHours, setWindowHours] = useState(chartWindowHoursDefault);
  const [background, setBackground] = useState<TabloBackgroundId>(tabloBackgroundDefault);
  const [reading, setReading] = useState<DashboardReading | null>(null);
  const [readAt, setReadAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWindowHours(readStoredHours());
    setBackground(readStoredTabloBackground());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(chartWindowHoursStorageKey, String(windowHours));
    } catch {
      /* ignore quota / private mode */
    }
  }, [windowHours]);

  useEffect(() => {
    applyTabloBackground(background);
    writeStoredTabloBackground(background);
  }, [background]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const minutes = normalizeChartWindowHours(windowHours) * 60;
        const response = await fetch(`/api/cps/dashboard?minutes=${minutes}`);
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
  }, [windowHours]);

  const readLabel = readAt
    ? new Intl.DateTimeFormat("bg-BG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(readAt)
    : null;
  const orderedIds = [...new Set(reading?.machines.flatMap((machine) => machine.series.map((series) => series.parameterId)) ?? [])].sort();
  const timeDomain = chartWindowDomain(windowHours, readAt?.getTime() ?? Date.now());

  return (
    <main className="dash">
      <header className="dash-header">
        <div>
          <p className="kicker">Табло</p>
          <h1>Контролно табло</h1>
        </div>
        <div className="dash-side">
          <label className="dash-window">
            Фон
            <select
              value={background}
              onChange={(event) => setBackground(normalizeTabloBackground(event.target.value))}
              aria-label="Фон на таблото"
            >
              {tabloBackgroundChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dash-window">
            Последни
            <select
              value={windowHours}
              onChange={(event) => setWindowHours(normalizeChartWindowHours(event.target.value))}
              aria-label="Часов прозорец на графиките"
            >
              {chartWindowHourChoices.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} {hours === 1 ? "час" : "часа"}
                </option>
              ))}
            </select>
          </label>
          <span>{`Четене на всеки ${readerIntervalMs / 1000} сек`}</span>
          {readLabel && <time dateTime={readAt?.toISOString()}>{readLabel}</time>}
        </div>
      </header>
      <p className="demo-note">
        Всяка линия е процент от границите на своя параметър. По вертикала 0% е долната граница, а 100% е горната.
        По хоризонтала е последните {windowHours} {windowHours === 1 ? "час" : "часа"}.
      </p>
      {error && <p className="dash-error">{error}</p>}
      <section className="trend-list" aria-label="Графики по машини">
        {reading?.machines.map((machine) => (
          <MachineTrend
            key={machine.id}
            machine={machine}
            orderedIds={orderedIds}
            timeDomain={timeDomain}
          />
        ))}
      </section>
    </main>
  );
}
