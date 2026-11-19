import { useMemo, useState } from "react";
import { formatNumber, formatTime } from "../../domain/format";
import {
  OUT_OF_RANGE_COLOR,
  TREND_VIEW,
  buildMachineTrend,
  guideY,
  splitOutsideRuns,
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
  const { lines, frameMin, frameMax } = useMemo(
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
  const y0 = guideY(0, frameMin, frameMax);
  const y100 = guideY(100, frameMin, frameMax);

  return (
    <article className="trend-card">
      <header className="trend-head">
        <h2 title={machine.name}>{machine.name}</h2>
        <p title={machine.model ?? undefined}>{machine.model || "\u00a0"}</p>
      </header>
      {plotted ? (
        <div className="trend-plot">
        <div className="trend-yaxis" aria-hidden="true">
          <span style={{ top: `${(y100 / TREND_VIEW.h) * 100}%` }}>100%</span>
          <span style={{ top: `${(y0 / TREND_VIEW.h) * 100}%` }}>0%</span>
        </div>
        <svg
          className="trend-svg"
          viewBox={`0 0 ${TREND_VIEW.w} ${TREND_VIEW.h}`}
          role="img"
          aria-label={`${machine.name}. ${summary}`}
          preserveAspectRatio="xMidYMid meet"
          onMouseLeave={() => setHover(null)}
        >
          <line className="trend-guide" x1="0" x2={TREND_VIEW.w} y1={y0} y2={y0} />
          <line className="trend-guide" x1="0" x2={TREND_VIEW.w} y1={y100} y2={y100} />
          {lines.map((line) =>
            line.segments.flatMap((segment, segmentIndex) =>
              splitOutsideRuns(segment).map((run, runIndex) => {
                const stroke = run.outside ? OUT_OF_RANGE_COLOR : line.color;
                const key = `${line.parameterId}-${segmentIndex}-${runIndex}`;
                if (run.points.length >= 2) {
                  return (
                    <polyline
                      key={key}
                      points={pointsOf(run.points)}
                      fill="none"
                      stroke={stroke}
                      strokeWidth="0.7"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                }
                return (
                  <circle
                    key={key}
                    cx={run.points[0].x}
                    cy={run.points[0].y}
                    r="0.55"
                    fill={stroke}
                  />
                );
              }),
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
                stroke={OUT_OF_RANGE_COLOR}
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
