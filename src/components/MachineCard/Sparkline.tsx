import { useMemo, useState } from "react";
import { formatNumber, formatTime, metricCaption } from "../../domain/format";
import { SPARK_VIEW, buildSparkModel, type SparkPoint } from "../../domain/sparkline";
import type { MetricPoint, TrendThresholds } from "../../types/machine";
import "./MachineCard.css";

function triangle(point: SparkPoint): string {
  const size = 2.4;
  return `${point.x},${point.y - size} ${point.x + size},${point.y + size * 0.75} ${point.x - size},${point.y + size * 0.75}`;
}

export function Sparkline({
  points,
  label,
  unit,
  thresholds,
  size = "compact",
}: {
  points: MetricPoint[];
  label: string;
  unit: string;
  thresholds?: TrendThresholds;
  size?: "compact" | "large";
}) {
  const model = useMemo(
    () => buildSparkModel(points, thresholds, label, unit),
    [points, thresholds, label, unit],
  );
  const [hover, setHover] = useState<SparkPoint | null>(null);
  const flat = model.segments.flat();
  const last = [...flat].reverse().find((point) => point.kinds.includes("last"));
  const shown = hover ?? last;
  const peaks = flat.filter((point) => point.kinds.includes("peak"));
  const breaches = flat.filter((point) => point.kinds.includes("breach"));

  return (
    <div className="spark">
      <p className="spark-caption">{metricCaption(label, unit)}</p>
      {model.empty ? (
        <p className="spark-empty">Няма данни</p>
      ) : (
        <svg
          className={size === "large" ? "spark-svg spark-svg-large" : "spark-svg"}
          viewBox={`0 0 ${SPARK_VIEW.w} ${SPARK_VIEW.h}`}
          role="img"
          aria-label={model.summary}
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
        >
          {model.segments.map((segment, index) =>
            segment.length >= 2 ? (
              <polyline
                key={index}
                className="spark-line"
                points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
              />
            ) : (
              <circle key={index} className="spark-line-dot" cx={segment[0].x} cy={segment[0].y} r="1.3" />
            ),
          )}
          {breaches.map((point) => (
            <rect
              key={`breach-${point.timestamp}`}
              className="spark-breach"
              x={point.x - 1.7}
              y={point.y - 1.7}
              width="3.4"
              height="3.4"
            />
          ))}
          {peaks.map((point) => (
            <polygon key={`peak-${point.timestamp}`} className="spark-peak" points={triangle(point)} />
          ))}
          {last && <circle className="spark-last" cx={last.x} cy={last.y} r="1.7" />}
          {flat.map((point) => (
            <circle
              key={`hit-${point.timestamp}`}
              className="spark-hit"
              cx={point.x}
              cy={point.y}
              r="4"
              onMouseEnter={() => setHover(point)}
            >
              <title>{`${formatNumber(point.value)} ${unit} · ${formatTime(point.timestamp)}`}</title>
            </circle>
          ))}
        </svg>
      )}
      {model.windowLabel && <p className="spark-window">{model.windowLabel}</p>}
      {!model.empty && shown && (
        <p className="spark-readout">
          {formatNumber(shown.value)} {unit} · {formatTime(shown.timestamp)}
        </p>
      )}
      {(peaks.length > 0 || breaches.length > 0) && (
        <ul className="spark-legend">
          {peaks.length > 0 && (
            <li>
              <i className="mark-peak" aria-hidden="true" /> Пик
            </li>
          )}
          {breaches.length > 0 && (
            <li>
              <i className="mark-breach" aria-hidden="true" /> Извън праг
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
