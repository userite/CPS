import { useMemo, useState } from "react";
import { formatNumber, formatTime } from "../../domain/format";
import {
  TREND_VIEW,
  buildMachineTrend,
  guideY,
  type TrendPoint,
} from "../../domain/machineTrend";
import type { DashboardMachine } from "../../server/blondina";

function pointsOf(segment: TrendPoint[]): string {
  return segment.map((point) => `${point.x},${point.y}`).join(" ");
}

export function MachineTrend({
  machine,
  orderedIds,
}: {
  machine: DashboardMachine;
  orderedIds: string[];
}) {
  const lines = useMemo(
    () => buildMachineTrend(machine.series, orderedIds),
    [machine.series, orderedIds],
  );
  const [hover, setHover] = useState<TrendPoint | null>(null);
  const plotted = lines.some((line) => line.plotted);
  const stamps = lines
    .flatMap((line) => line.segments.flat().map((point) => point.timestamp))
    .filter((stamp) => Number.isFinite(Date.parse(stamp)))
    .sort();
  const timeStart = stamps[0];
  const timeEnd = stamps[stamps.length - 1];
  const summary = lines
    .map((line) => {
      if (!line.plotted || line.lastPercent == null) return `${line.label}: няма скала или данни`;
      const place = line.outside ? ", извън границите" : "";
      return `${line.label}: ${formatNumber(line.lastPercent)}%${place}`;
    })
    .join(". ");

  return (
    <article className="trend-card">
      <header className="trend-head">
        <h2 title={machine.name}>{machine.name}</h2>
        <p title={machine.model ?? undefined}>{machine.model || "\u00a0"}</p>
      </header>
      {plotted ? (
        <div className="trend-plot">
        <div className="trend-yaxis" aria-hidden="true">
          <span style={{ top: `${(guideY(100) / TREND_VIEW.h) * 100}%` }}>100%</span>
          <span style={{ top: `${(guideY(0) / TREND_VIEW.h) * 100}%` }}>0%</span>
        </div>
        <svg
          className="trend-svg"
          viewBox={`0 0 ${TREND_VIEW.w} ${TREND_VIEW.h}`}
          role="img"
          aria-label={`${machine.name}. ${summary}`}
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHover(null)}
        >
          <line className="trend-guide" x1="0" x2={TREND_VIEW.w} y1={guideY(0)} y2={guideY(0)} />
          <line className="trend-guide" x1="0" x2={TREND_VIEW.w} y1={guideY(100)} y2={guideY(100)} />
          {lines.map((line) =>
            line.segments.map((segment, index) =>
              segment.length >= 2 ? (
                <polyline
                  key={`${line.parameterId}-${index}`}
                  points={pointsOf(segment)}
                  fill="none"
                  stroke={line.color}
                  strokeWidth="0.7"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <circle
                  key={`${line.parameterId}-${index}`}
                  cx={segment[0].x}
                  cy={segment[0].y}
                  r="0.55"
                  fill={line.color}
                />
              ),
            ),
          )}
          {lines.flatMap((line) =>
            line.segments.flat().filter((point) => point.outside).map((point) => (
              <circle
                key={`out-${line.parameterId}-${point.timestamp}`}
                cx={point.x}
                cy={point.y}
                r="0.85"
                fill="none"
                stroke={line.color}
                strokeWidth="0.45"
                vectorEffect="non-scaling-stroke"
              />
            )),
          )}
          {lines.flatMap((line) =>
            line.segments.flat().map((point) => (
              <circle
                key={`hit-${line.parameterId}-${point.timestamp}`}
                className="trend-hit"
                cx={point.x}
                cy={point.y}
                r="3.2"
                onMouseEnter={() => setHover(point)}
              >
                <title>
                  {`${line.label}: ${formatNumber(point.value)} ${line.unit} · ${formatNumber(point.percent)}% · ${formatTime(point.timestamp)}`}
                </title>
              </circle>
            )),
          )}
        </svg>
        {timeStart && timeEnd && (
          <p className="trend-time">
            <time dateTime={timeStart}>{formatTime(timeStart)}</time>
            <time dateTime={timeEnd}>{formatTime(timeEnd)}</time>
          </p>
        )}
        </div>
      ) : (
        <p className="trend-empty">Няма данни</p>
      )}
      <p className="trend-readout">
        {hover ? (hover.outside ? "Извън границите" : `${formatNumber(hover.percent)}%`) : "\u00a0"}
      </p>
      <ul className="trend-legend">
        {lines.map((line) => (
          <li key={line.parameterId}>
            <i style={{ background: line.color }} aria-hidden="true" />
            <span>{line.label}</span>
            <span className="trend-legend-value">
              {!line.hasRange
                ? "без граници"
                : line.lastPercent == null
                  ? "няма данни"
                  : `${formatNumber(line.lastPercent)}%`}
              {line.outside ? " · извън" : ""}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
