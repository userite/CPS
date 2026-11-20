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
import { chartsOnLinear } from "../../domain/parameterRole";
import { buildPlanProgress, type PlanProgress } from "../../domain/planProgress";
import { buildStatusStrip, type StatusSegment } from "../../domain/statusTimeline";
import type { DashboardMachine } from "../../server/blondina";

const STATUS_VIEW_H = 4;

function pointsOf(segment: TrendPoint[]): string {
  return segment.map((point) => `${point.x},${point.y}`).join(" ");
}

function PlanRing({ progress }: { progress: PlanProgress }) {
  const shown = Math.max(0, progress.percent);
  const arc = Math.min(100, shown);
  return (
    <div
      className="trend-ring"
      title={`${progress.reportLabel}: ${formatNumber(progress.reportSum)} / ${progress.planLabel}: ${formatNumber(progress.planValue)}`}
      aria-label={`Изпълнение ${formatNumber(shown)} процента`}
    >
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="trend-ring-track" cx="18" cy="18" r="13" pathLength="100" />
        <circle
          className="trend-ring-value"
          cx="18"
          cy="18"
          r="13"
          pathLength="100"
          style={{ strokeDasharray: `${arc} 100` }}
        />
      </svg>
      <span>{formatNumber(shown)}%</span>
    </div>
  );
}

function statusHoverText(segment: StatusSegment): string {
  return `${segment.label} · ${formatTime(segment.start)}`;
}

export function MachineTrend({
  machine,
  orderedIds,
  timeDomain,
}: {
  machine: DashboardMachine;
  orderedIds: string[];
  timeDomain: { tMin: number; tMax: number };
}) {
  const chartSeries = useMemo(
    () => machine.series.filter((series) => chartsOnLinear(series.role)),
    [machine.series],
  );
  const { lines, frameMin, frameMax } = useMemo(
    () => buildMachineTrend(chartSeries, orderedIds, timeDomain),
    [chartSeries, orderedIds, timeDomain],
  );
  const planProgress = useMemo(
    () => buildPlanProgress(machine.series, orderedIds),
    [machine.series, orderedIds],
  );
  const statusStrips = useMemo(
    () =>
      machine.series
        .filter((series) => series.role === "status")
        .map((series) =>
          buildStatusStrip(
            series.parameterId,
            series.label,
            series.states,
            series.points,
            timeDomain.tMin,
            timeDomain.tMax,
          ),
        )
        .filter((strip): strip is NonNullable<typeof strip> => strip != null),
    [machine.series, timeDomain],
  );
  const [hover, setHover] = useState<TrendPoint | null>(null);
  const [statusHover, setStatusHover] = useState<string | null>(null);
  const plotted = lines.some((line) => line.plotted);
  const timeStart = new Date(timeDomain.tMin).toISOString();
  const timeEnd = new Date(timeDomain.tMax).toISOString();
  const summary = lines
    .map((line) => {
      if (!line.plotted || line.lastPercent == null) return `${line.label}: няма скала или данни`;
      const place = line.outside ? ", извън границите" : "";
      return `${line.label}: ${formatNumber(line.lastPercent)}%${place}`;
    })
    .join(". ");
  const y0 = guideY(0, frameMin, frameMax);
  const y100 = guideY(100, frameMin, frameMax);
  const showPlot = plotted || statusStrips.length > 0;

  return (
    <article className="trend-card">
      <header className="trend-head">
        <h2 title={machine.name}>{machine.name}</h2>
        <p title={machine.model ?? undefined}>{machine.model || "\u00a0"}</p>
      </header>
      {showPlot ? (
        <div className="trend-plot">
        <div className="trend-yaxis" aria-hidden="true">
          {plotted ? (
            <>
              <span style={{ top: `${(y100 / TREND_VIEW.h) * 100}%` }}>100%</span>
              <span style={{ top: `${(y0 / TREND_VIEW.h) * 100}%` }}>0%</span>
            </>
          ) : null}
        </div>
        {plotted ? (
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
        ) : (
          <div className="trend-svg trend-svg-spacer" aria-hidden="true" />
        )}
        {statusStrips.map((strip) => (
          <div key={strip.parameterId} className="trend-status">
            <span className="trend-status-label">{strip.label}</span>
            <svg
              className="trend-status-svg"
              viewBox={`0 0 ${TREND_VIEW.w} ${STATUS_VIEW_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={strip.label}
              onMouseLeave={() => setStatusHover(null)}
            >
              {strip.segments.map((segment) => (
                <rect
                  key={`${strip.parameterId}-${segment.start}`}
                  className="trend-status-seg"
                  x={segment.x}
                  y="0.4"
                  width={segment.width}
                  height={STATUS_VIEW_H - 0.8}
                  fill={segment.color}
                  onMouseEnter={() => setStatusHover(statusHoverText(segment))}
                >
                  <title>{statusHoverText(segment)}</title>
                </rect>
              ))}
            </svg>
          </div>
        ))}
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
        {hover
          ? hover.outside
            ? "Извън границите"
            : `${formatNumber(hover.percent)}%`
          : statusHover
            ? statusHover
            : "\u00a0"}
      </p>
      <div className="trend-foot">
        {planProgress ? <PlanRing progress={planProgress} /> : null}
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
          {statusStrips.map((strip) => (
            <li key={`st-${strip.parameterId}`} className="trend-legend-status">
              <span>{strip.label}</span>
              <span className="trend-legend-value">
                {strip.states.map((state) => state.label).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
