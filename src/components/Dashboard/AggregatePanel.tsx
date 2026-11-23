import { useEffect, useMemo, useState } from "react";
import { aggregateChartParamsStorageKey } from "../../config/dashboard";
import {
  buildAggregateSeries,
  type AggregateParamInput,
} from "../../domain/aggregateAcrossMachines";
import { AGGREGATE_METHOD_LABELS } from "../../domain/aggregateMethod";
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
import type { DashboardMachine, DashboardSeries } from "../../server/blondina";

const AGGREGATE_VIEW = { w: TREND_VIEW.w, h: 48 };
/** Axes meet at bottom-left origin (pre-scale TREND_VIEW coords). */
const AXIS_ORIGIN_X = 2;
const AXIS_ORIGIN_Y = TREND_VIEW.h - 0.35;
const AXIS_TOP_Y = 2;
const AXIS_RIGHT_X = TREND_VIEW.w - 2;
const X_TICK_LEN = 1.1;
const Y_TICK_LEN = 1.1;

function pointsOf(segment: TrendPoint[]): string {
  return segment.map((point) => `${point.x},${point.y}`).join(" ");
}

function isNumericMetric(series: DashboardSeries): boolean {
  if (series.role === "status") return false;
  return (
    typeof series.rangeMin === "number" &&
    Number.isFinite(series.rangeMin) &&
    typeof series.rangeMax === "number" &&
    Number.isFinite(series.rangeMax)
  );
}

function readStoredSelection(): string[] | null {
  try {
    const raw = window.localStorage.getItem(aggregateChartParamsStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

function catalogFromMachines(machines: DashboardMachine[]): DashboardSeries[] {
  const byId = new Map<string, DashboardSeries>();
  for (const machine of machines) {
    for (const series of machine.series) {
      if (!isNumericMetric(series)) continue;
      if (!byId.has(series.parameterId)) byId.set(series.parameterId, series);
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, "bg"));
}

export function AggregatePanel({
  machines,
  orderedIds,
  timeDomain,
}: {
  machines: DashboardMachine[];
  orderedIds: string[];
  timeDomain: { tMin: number; tMax: number };
}) {
  const catalog = useMemo(() => catalogFromMachines(machines), [machines]);
  const catalogIds = useMemo(() => catalog.map((item) => item.parameterId), [catalog]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [hover, setHover] = useState<{ point: TrendPoint; label: string; unit: string } | null>(
    null,
  );

  useEffect(() => {
    const stored = readStoredSelection();
    if (stored && stored.length > 0) {
      setSelectedIds(stored);
    } else if (catalogIds.length > 0) {
      setSelectedIds(catalogIds.slice(0, Math.min(2, catalogIds.length)));
    }
    setHydrated(true);
    // Hydrate once from localStorage / first catalog snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const allowed = new Set(catalogIds);
    setSelectedIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [catalogIds, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(aggregateChartParamsStorageKey, JSON.stringify(selectedIds));
    } catch {
      /* ignore quota / private mode */
    }
  }, [selectedIds, hydrated]);

  const aggregateInputs: AggregateParamInput[] = useMemo(() => {
    const selected = new Set(selectedIds);
    return catalog
      .filter((item) => selected.has(item.parameterId))
      .map((item) => ({
        parameterId: item.parameterId,
        label: item.label,
        unit: item.unit,
        rangeMin: item.rangeMin,
        rangeMax: item.rangeMax,
        color: item.color,
        role: item.role,
        aggregateMethod: item.aggregateMethod,
        sampleIntervalSeconds: item.sampleIntervalSeconds,
        machines: machines.map((machine) => {
          const series = machine.series.find((row) => row.parameterId === item.parameterId);
          return {
            machineId: machine.id,
            points: series?.points ?? [],
          };
        }),
      }));
  }, [catalog, machines, selectedIds]);

  const aggregateSeries = useMemo(
    () => buildAggregateSeries(aggregateInputs, timeDomain),
    [aggregateInputs, timeDomain],
  );

  const { lines, frameMin, frameMax } = useMemo(
    () => buildMachineTrend(aggregateSeries, orderedIds, timeDomain),
    [aggregateSeries, orderedIds, timeDomain],
  );

  const plotted = lines.some((line) => line.plotted);
  const y0 = guideY(0, frameMin, frameMax);
  const y100 = guideY(100, frameMin, frameMax);
  const xTicks = useMemo(
    () => chartTimeTicks(timeDomain.tMin, timeDomain.tMax),
    [timeDomain.tMin, timeDomain.tMax],
  );
  const scaleY = AGGREGATE_VIEW.h / TREND_VIEW.h;
  /** One selected param → Y shows real range values, not %. */
  const valueAxis = aggregateSeries.length === 1 ? aggregateSeries[0] : null;
  const yTopLabel =
    valueAxis && valueAxis.rangeMax != null
      ? `${formatNumber(valueAxis.rangeMax)}${valueAxis.unit ? ` ${valueAxis.unit}` : ""}`
      : "100%";
  const yBottomLabel =
    valueAxis && valueAxis.rangeMin != null
      ? `${formatNumber(valueAxis.rangeMin)}${valueAxis.unit ? ` ${valueAxis.unit}` : ""}`
      : "0%";

  function toggle(parameterId: string): void {
    setSelectedIds((prev) =>
      prev.includes(parameterId)
        ? prev.filter((id) => id !== parameterId)
        : [...prev, parameterId],
    );
  }

  return (
    <section className="agg-panel" aria-label="Обща графика по параметри">
      <header className="agg-head">
        <h2>Общо през машините</h2>
        <p>Избраните параметри се комбинират по метода от администрацията (aggregate_method).</p>
      </header>
      <div className="agg-body">
        <aside className="agg-params">
          <p className="agg-params-label">Параметри</p>
          {catalog.length === 0 ? (
            <p className="agg-empty">Няма числови параметри с граници.</p>
          ) : (
            <ul className="agg-param-list">
              {catalog.map((item) => (
                <li key={item.parameterId}>
                  <label className="agg-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.parameterId)}
                      onChange={() => toggle(item.parameterId)}
                    />
                    <span className="agg-check-text">
                      <span className="agg-check-name">{item.label}</span>
                      <span className="agg-check-meta">
                        {item.parameterId}
                        {" · "}
                        {AGGREGATE_METHOD_LABELS[item.aggregateMethod]}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="agg-chart">
          {selectedIds.length === 0 ? (
            <p className="agg-empty">Маркирайте параметър отляво.</p>
          ) : !plotted ? (
            <p className="agg-empty">Няма данни за избраните параметри в прозореца.</p>
          ) : (
            <>
              <div className={`agg-plot${valueAxis ? " agg-plot-values" : ""}`}>
                <div className="agg-yaxis" aria-hidden="true">
                  <span style={{ top: `${(y100 / TREND_VIEW.h) * 100}%` }}>{yTopLabel}</span>
                  <span style={{ top: `${(y0 / TREND_VIEW.h) * 100}%` }}>{yBottomLabel}</span>
                </div>
                <svg
                  className="agg-svg"
                  viewBox={`0 0 ${AGGREGATE_VIEW.w} ${AGGREGATE_VIEW.h}`}
                  role="img"
                  aria-label="Обща линейна графика"
                  preserveAspectRatio="none"
                  onMouseLeave={() => setHover(null)}
                >
                  <g transform={`scale(1 ${scaleY})`}>
                    <line className="trend-guide" x1={AXIS_ORIGIN_X} x2={AXIS_RIGHT_X} y1={y0} y2={y0} />
                    <line className="trend-guide" x1={AXIS_ORIGIN_X} x2={AXIS_RIGHT_X} y1={y100} y2={y100} />
                    <line
                      className="agg-yaxis-line"
                      x1={AXIS_ORIGIN_X}
                      x2={AXIS_ORIGIN_X}
                      y1={AXIS_TOP_Y}
                      y2={AXIS_ORIGIN_Y}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      className="agg-xaxis"
                      x1={AXIS_ORIGIN_X}
                      x2={AXIS_RIGHT_X}
                      y1={AXIS_ORIGIN_Y}
                      y2={AXIS_ORIGIN_Y}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      className="agg-ytick-mark"
                      x1={AXIS_ORIGIN_X}
                      x2={AXIS_ORIGIN_X + Y_TICK_LEN}
                      y1={y100}
                      y2={y100}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      className="agg-ytick-mark"
                      x1={AXIS_ORIGIN_X}
                      x2={AXIS_ORIGIN_X + Y_TICK_LEN}
                      y1={y0}
                      y2={y0}
                      vectorEffect="non-scaling-stroke"
                    />
                    {xTicks.map((tick) => (
                      <line
                        key={`xtick-${tick.t}`}
                        className="agg-xtick-mark"
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
                                strokeWidth="0.9"
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
                              r="0.6"
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
                          onMouseEnter={() =>
                            setHover({ point, label: line.label, unit: line.unit })
                          }
                        >
                          <title>
                            {valueAxis
                              ? `${line.label}: ${formatNumber(point.value)} ${line.unit} · ${formatTime(point.timestamp)}`
                              : `${line.label}: ${formatNumber(point.value)} ${line.unit} · ${formatNumber(point.percent)}% · ${formatTime(point.timestamp)}`}
                          </title>
                        </circle>
                      )),
                    )}
                  </g>
                </svg>
                <div className="agg-xticks" aria-hidden="true">
                  {xTicks.map((tick) => (
                    <span
                      key={`xlabel-${tick.t}`}
                      className="agg-xtick-label"
                      style={{ left: `${(tick.x / TREND_VIEW.w) * 100}%` }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>
              <p className="agg-readout">
                {hover
                  ? hover.point.outside
                    ? `${hover.label}: извън границите`
                    : valueAxis
                      ? `${hover.label}: ${formatNumber(hover.point.value)} ${hover.unit}`
                      : `${hover.label}: ${formatNumber(hover.point.value)} ${hover.unit} · ${formatNumber(hover.point.percent)}%`
                  : "\u00a0"}
              </p>
              <ul className="agg-legend">
                {lines.map((line) => {
                  const method =
                    aggregateInputs.find((item) => item.parameterId === line.parameterId)
                      ?.aggregateMethod ?? "avg";
                  const valueText = !line.hasRange
                    ? "без граници"
                    : valueAxis
                      ? line.lastValue == null
                        ? "няма данни"
                        : `${formatNumber(line.lastValue)}${line.unit ? ` ${line.unit}` : ""}`
                      : line.lastPercent == null
                        ? "няма данни"
                        : `${formatNumber(line.lastPercent)}%`;
                  return (
                    <li key={line.parameterId}>
                      <i style={{ background: line.color }} aria-hidden="true" />
                      <span>{line.label}</span>
                      <span className="trend-legend-value">
                        {AGGREGATE_METHOD_LABELS[method]}
                        {" · "}
                        {valueText}
                        {line.outside ? " · извън" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
