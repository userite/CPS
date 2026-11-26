import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { chartTimeTicks } from "../../domain/chartTimeTicks";
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
import { buildStatusStrip, latestStatusOf, type StatusSegment } from "../../domain/statusTimeline";
import type { DashboardMachine } from "../../server/blondina";

const STATUS_VIEW_H = 4;
const RING_FALLBACK_COLOR = "#3ddc97";
/** Same axis geometry as AggregatePanel (pre-scale TREND_VIEW coords). */
const AXIS_ORIGIN_X = 2;
const AXIS_ORIGIN_Y = TREND_VIEW.h - 0.35;
const AXIS_TOP_Y = 2;
const AXIS_RIGHT_X = TREND_VIEW.w - 2;
const X_TICK_LEN = 1.1;
const Y_TICK_LEN = 1.1;
const STATUS_TICK_LEN = 0.7;

function pointsOf(segment: TrendPoint[]): string {
  return segment.map((point) => `${point.x},${point.y}`).join(" ");
}

function PlanRing({
  progress,
  fillColor,
}: {
  progress: PlanProgress;
  fillColor: string;
}) {
  const shown = Math.max(0, progress.percent);
  const arc = Math.min(100, shown);
  return (
    <div
      className="trend-ring"
      style={{ ["--ring-fill" as string]: fillColor }}
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
  onStatusChanged,
}: {
  machine: DashboardMachine;
  orderedIds: string[];
  timeDomain: { tMin: number; tMax: number };
  onStatusChanged?: () => void;
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
  const statusSeries = useMemo(
    () => machine.series.find((series) => series.role === "status" && series.states.length > 0) ?? null,
    [machine.series],
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
  const latestStatus = useMemo(() => latestStatusOf(machine.series), [machine.series]);
  const ringFill = machine.manualStatus?.color ?? latestStatus?.color ?? RING_FALLBACK_COLOR;
  const displayStatusLabel = machine.manualStatus?.label ?? latestStatus?.label ?? null;
  const [hover, setHover] = useState<TrendPoint | null>(null);
  const [statusHover, setStatusHover] = useState<string | null>(null);
  const [statusValue, setStatusValue] = useState<string>(
    machine.manualStatus != null ? String(machine.manualStatus.value) : "",
  );
  const [commentDraft, setCommentDraft] = useState(machine.manualStatus?.comment ?? "");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const statusModalTitleId = useId();

  useEffect(() => {
    setStatusValue(machine.manualStatus != null ? String(machine.manualStatus.value) : "");
    setCommentDraft(machine.manualStatus?.comment ?? "");
  }, [machine.id, machine.manualStatus?.value, machine.manualStatus?.comment, machine.manualStatus?.updatedAt]);

  function resetStatusDraft(): void {
    setStatusValue(machine.manualStatus != null ? String(machine.manualStatus.value) : "");
    setCommentDraft(machine.manualStatus?.comment ?? "");
    setStatusError(null);
  }

  function dismissStatusModal(): void {
    setStatusModalOpen(false);
    resetStatusDraft();
  }

  useEffect(() => {
    if (!statusModalOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setStatusModalOpen(false);
      setStatusValue(machine.manualStatus != null ? String(machine.manualStatus.value) : "");
      setCommentDraft(machine.manualStatus?.comment ?? "");
      setStatusError(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [statusModalOpen, machine.manualStatus]);

  /** Persist draft status + comment together; select alone is draft-only. */
  async function saveStatusAndComment(): Promise<void> {
    if (statusValue === "") {
      setStatusError("Първо изберете статус.");
      return;
    }
    setStatusBusy(true);
    setStatusError(null);
    try {
      const response = await fetch("/api/cps/machine-status", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machineId: machine.id,
          value: Number(statusValue),
          comment: commentDraft,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Статусът не се записа.");
      onStatusChanged?.();
      setStatusModalOpen(false);
    } catch (reason) {
      setStatusError(reason instanceof Error ? reason.message : "Статусът не се записа.");
    } finally {
      setStatusBusy(false);
    }
  }
  const plotted = lines.some((line) => line.plotted);
  const xTicks = useMemo(
    () => chartTimeTicks(timeDomain.tMin, timeDomain.tMax),
    [timeDomain.tMin, timeDomain.tMax],
  );
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
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
          >
            <line className="trend-guide" x1={AXIS_ORIGIN_X} x2={AXIS_RIGHT_X} y1={y0} y2={y0} />
            <line className="trend-guide" x1={AXIS_ORIGIN_X} x2={AXIS_RIGHT_X} y1={y100} y2={y100} />
            <line
              className="trend-yaxis-line"
              x1={AXIS_ORIGIN_X}
              x2={AXIS_ORIGIN_X}
              y1={AXIS_TOP_Y}
              y2={AXIS_ORIGIN_Y}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="trend-xaxis"
              x1={AXIS_ORIGIN_X}
              x2={AXIS_RIGHT_X}
              y1={AXIS_ORIGIN_Y}
              y2={AXIS_ORIGIN_Y}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="trend-ytick-mark"
              x1={AXIS_ORIGIN_X}
              x2={AXIS_ORIGIN_X + Y_TICK_LEN}
              y1={y100}
              y2={y100}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="trend-ytick-mark"
              x1={AXIS_ORIGIN_X}
              x2={AXIS_ORIGIN_X + Y_TICK_LEN}
              y1={y0}
              y2={y0}
              vectorEffect="non-scaling-stroke"
            />
            {xTicks.map((tick) => (
              <line
                key={`xtick-${tick.t}`}
                className="trend-xtick-mark"
                x1={tick.x}
                x2={tick.x}
                y1={AXIS_ORIGIN_Y - X_TICK_LEN}
                y2={AXIS_ORIGIN_Y}
                vectorEffect="non-scaling-stroke"
              />
            ))}
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
                  if (run.outside) return null;
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
              {xTicks.map((tick) => (
                <line
                  key={`status-xtick-${strip.parameterId}-${tick.t}`}
                  className="trend-xtick-mark"
                  x1={tick.x}
                  x2={tick.x}
                  y1={STATUS_VIEW_H - STATUS_TICK_LEN}
                  y2={STATUS_VIEW_H}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>
        ))}
        {xTicks.length > 0 && (
          <div className="trend-xticks" aria-hidden="true">
            {xTicks.map((tick) => (
              <span
                key={`xlabel-${tick.t}`}
                className="trend-xtick-label"
                style={{ left: `${(tick.x / TREND_VIEW.w) * 100}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
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
        {planProgress ? (
          <div className="trend-ring-block">
            {displayStatusLabel ? (
              <p className="trend-ring-status" style={{ color: ringFill }}>
                {displayStatusLabel}
              </p>
            ) : null}
            <PlanRing progress={planProgress} fillColor={ringFill} />
          </div>
        ) : null}
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
        {statusSeries ? (
          <button
            type="button"
            className="trend-status-open"
            onClick={() => {
              resetStatusDraft();
              setStatusModalOpen(true);
            }}
          >
            Статус
          </button>
        ) : null}
      </div>
      {statusModalOpen && statusSeries
        ? createPortal(
            <div
              className="trend-status-modal-backdrop"
              role="presentation"
              onClick={dismissStatusModal}
            >
              <div
                className="trend-status-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={statusModalTitleId}
                onClick={(event) => event.stopPropagation()}
              >
                <header className="trend-status-modal-head">
                  <h3 id={statusModalTitleId}>Статус — {machine.name}</h3>
                  <button
                    type="button"
                    className="trend-status-modal-close"
                    aria-label="Затвори"
                    onClick={dismissStatusModal}
                  >
                    ×
                  </button>
                </header>
                <div className="trend-status-edit" aria-label={`Статус на ${machine.name}`}>
                  <label className="trend-status-field">
                    <span>Статус</span>
                    <select
                      value={statusValue}
                      disabled={statusBusy}
                      aria-label={`Статус за ${machine.name}`}
                      onChange={(event) => setStatusValue(event.target.value)}
                    >
                      <option value="">Избери…</option>
                      {statusSeries.states.map((state) => (
                        <option key={state.value} value={String(state.value)}>
                          {state.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="trend-status-field trend-status-comment">
                    <span>Коментар</span>
                    <textarea
                      value={commentDraft}
                      disabled={statusBusy}
                      rows={3}
                      placeholder="прогнозно време за отстраняване"
                      aria-label={`Коментар за ${machine.name}`}
                      onChange={(event) => setCommentDraft(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="trend-status-save"
                    disabled={statusBusy || statusValue === ""}
                    onClick={() => void saveStatusAndComment()}
                  >
                    Запази коментар
                  </button>
                  {statusError ? <p className="trend-status-error">{statusError}</p> : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </article>
  );
}
